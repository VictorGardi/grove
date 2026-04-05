import { useEffect } from "react";
import { useWorkspaceStore } from "../stores/useWorkspaceStore";
import { useNavStore } from "../stores/useNavStore";
import { useDataStore } from "../stores/useDataStore";
import { useFileStore } from "../stores/useFileStore";
import { useBoardStore } from "../stores/useBoardStore";
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

      // Cmd+K: navigate to board and focus search input — works even when input is focused
      if (mod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        const nav = useNavStore.getState();
        if (nav.activeView !== "board") {
          nav.setActiveView("board");
        }
        useBoardStore.getState().requestSearchFocus();
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

      // Check if focus is specifically in the board search input
      const inBoardSearch =
        inInput && target.getAttribute("data-board-search") === "true";

      // Escape: handle search clearing or close task detail panel
      if (e.key === "Escape") {
        const bs = useBoardStore.getState();
        if (bs.searchActive || bs.searchQuery) {
          e.preventDefault();
          bs.clearSearch();
          return;
        }
        const ds = useDataStore.getState();
        if (ds.selectedTaskId) {
          e.preventDefault();
          ds.clearSelectedTask();
        }
        return;
      }

      // Don't process shortcuts when focus is in an input/textarea/select/contenteditable
      // (unless it's the board search input, which handles its own special keys)
      if (inInput && !inBoardSearch) return;

      // Cmd+N: add workspace (existing) — only when not in board search
      if (mod && !inBoardSearch && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        addWorkspace();
        return;
      }

      // Cmd+T: create new task — works from board view
      if (mod && (e.key === "t" || e.key === "T")) {
        const nav = useNavStore.getState();
        if (nav.activeView === "board") {
          e.preventDefault();
          createTask("New task");
          return;
        }
      }

      // Cmd+digit: switch workspace (existing) — only when not in board search
      if (mod && !inBoardSearch) {
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

      // ? (question mark): activate search mode on board — skip when in board search
      if (!inBoardSearch && e.key === "?") {
        e.preventDefault();
        useBoardStore.getState().requestSearchFocus();
        return;
      }

      // If we're in the board search input, handle Enter for task opening
      if (inBoardSearch) {
        if (e.key === "Enter") {
          e.preventDefault();
          const bs = useBoardStore.getState();
          // The Board component handles the actual open logic via a custom event
          const event = new CustomEvent("board-search-enter", {
            detail: { query: bs.searchQuery },
          });
          document.dispatchEvent(event);
        }
        // Don't run B/D/R/F shortcuts from board search input
        return;
      }

      // N: create new task (legacy, kept but not primary) — skip when input focused
      // (Cmd+T is the new primary shortcut; keeping N for backward compat)
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        createTask("New task");
        return;
      }

      // B/D/R/F: move selected task to column — do NOT fire when search input is focused
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
