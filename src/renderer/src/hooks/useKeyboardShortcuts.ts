import { useEffect } from "react";
import { useWorkspaceStore } from "../stores/useWorkspaceStore";
import { useNavStore } from "../stores/useNavStore";
import { useDataStore } from "../stores/useDataStore";
import { useFileStore } from "../stores/useFileStore";
import { createTask, moveTask } from "../actions/taskActions";

export function useKeyboardShortcuts(): void {
  const addWorkspace = useWorkspaceStore((s) => s.addWorkspace);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      const mod = e.metaKey || e.ctrlKey;

      // Cmd+P: open file search — works even when input is focused
      if (mod && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        const nav = useNavStore.getState();
        if (nav.activeView !== "files") {
          nav.setActiveView("files");
        }
        useFileStore.getState().requestSearchFocus();
        return;
      }

      // Cmd+, : open settings — works even when input is focused
      if (mod && e.key === ",") {
        e.preventDefault();
        useNavStore.getState().setActiveView("settings");
        return;
      }

      // Cmd+B: toggle sidebar — works even when input is focused
      if (mod && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        useNavStore.getState().toggleSidebar();
        return;
      }

      // Cmd+J: toggle terminal — works even when input is focused
      if (mod && (e.key === "j" || e.key === "J")) {
        e.preventDefault();
        useNavStore.getState().toggleTerminalPanel();
        return;
      }

      // Ctrl+` : toggle terminal — works everywhere including inside xterm
      if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        useNavStore.getState().toggleTerminalPanel();
        return;
      }

      // ` (backtick, no modifier): toggle terminal — skip when xterm is focused
      if (e.key === "`" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const active = document.activeElement;
        const inXterm = active?.closest(".xterm") !== null;
        if (!inXterm) {
          const target = e.target as HTMLElement;
          const inEditable =
            target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.tagName === "SELECT" ||
            target.isContentEditable;
          if (!inEditable) {
            e.preventDefault();
            useNavStore.getState().toggleTerminalPanel();
            return;
          }
        }
      }

      const target = e.target as HTMLElement;
      const inInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable;

      // Escape: close task detail panel — always fires, even in inputs
      if (e.key === "Escape") {
        const ds = useDataStore.getState();
        if (ds.selectedTaskId) {
          e.preventDefault();
          ds.clearSelectedTask();
        }
        return;
      }

      // Don't process shortcuts when focus is in an input/textarea/select/contenteditable
      if (inInput) return;

      // Cmd+N: add workspace (existing)
      if (mod && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        addWorkspace();
        return;
      }

      // Cmd+digit: switch workspace (existing)
      if (mod) {
        const digit = parseInt(e.key, 10);
        if (digit >= 1 && digit <= 9) {
          e.preventDefault();
          const workspaces = useWorkspaceStore.getState().workspaces;
          const ws = workspaces[digit - 1];
          if (ws) {
            setActiveWorkspace(ws.path);
          }
        }
        return;
      }

      // ── Phase 4: Board keyboard shortcuts (no modifier) ──────

      const nav = useNavStore.getState();
      if (nav.activeView !== "board") return;

      // N: create new task
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        createTask("New task");
        return;
      }

      // B/D/R/F: move selected task to column
      const ds = useDataStore.getState();
      if (!ds.selectedTaskId) return;
      const task = ds.tasks.find((t) => t.id === ds.selectedTaskId);
      if (!task) return;

      const keyMap: Record<string, "backlog" | "doing" | "review" | "done"> = {
        b: "backlog",
        B: "backlog",
        d: "doing",
        D: "doing",
        r: "review",
        R: "review",
        f: "done",
        F: "done",
      };

      const toStatus = keyMap[e.key];
      if (toStatus && toStatus !== task.status) {
        e.preventDefault();
        moveTask(task.filePath, toStatus);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [addWorkspace, setActiveWorkspace]);
}
