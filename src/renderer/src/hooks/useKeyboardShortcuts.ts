import { useEffect, useCallback } from "react";
import { useWorkspaceStore } from "../stores/useWorkspaceStore";
import { useNavStore, type View } from "../stores/useNavStore";
import { useDataStore } from "../stores/useDataStore";
import { useFileStore } from "../stores/useFileStore";
import { useBoardStore } from "../stores/useBoardStore";
import { useAllTasksStore } from "../stores/useAllTasksStore";
import {
  useTaskSwitcherStore,
  switchToTask,
} from "../stores/useTaskSwitcherStore";
import { createTask } from "../actions/taskActions";
import type { TaskStatus } from "@shared/types";

const COLUMNS: TaskStatus[] = ["backlog", "doing", "review", "done"];

export function useKeyboardShortcuts(): void {
  const addWorkspace = useWorkspaceStore((s) => s.addWorkspace);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey;

      // Cmd+Shift+V: toggle between board and task views
      if (mod && e.shiftKey && (e.key === "v" || e.key === "V")) {
        e.preventDefault();
        const nav = useNavStore.getState();
        const newView: View = nav.activeView === "board" ? "task" : "board";
        nav.setActiveView(newView);
        return;
      }

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

      // Cmd+K: open task switcher — works even when input is focused
      if (mod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        useTaskSwitcherStore.getState().open();
        return;
      }

      // Cmd+E: go to previous task
      if (mod && (e.key === "e" || e.key === "E")) {
        e.preventDefault();
        const ts = useTaskSwitcherStore.getState();
        const prevTaskId = ts.recentTaskIds.find((id) => id !== ts.lastTaskId);
        if (prevTaskId) {
          const workspaces = useWorkspaceStore.getState().workspaces;
          const allTasks = useAllTasksStore.getState().allTasks;
          const sortedTasks = ts.getSortedTasks(workspaces, allTasks);
          const task = sortedTasks.find((t) => t.task.id === prevTaskId);
          if (task) {
            switchToTask(task);
          }
        }
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

      // Escape: handle task switcher, search clearing, or close task detail panel
      if (e.key === "Escape") {
        const ts = useTaskSwitcherStore.getState();
        if (ts.isOpen) {
          e.preventDefault();
          ts.close();
          return;
        }
        const bs = useBoardStore.getState();
        if (bs.searchActive || bs.searchQuery) {
          e.preventDefault();
          bs.clearSearch();
          return;
        }
        const ds = useDataStore.getState();
        if (ds.selectedTaskId) {
          e.preventDefault();
          useNavStore.getState().setActiveView("home");
          ds.clearSelectedTask();
          return;
        }
        // Also clear focus when pressing Escape (even if no task is selected)
        useBoardStore.getState().clearFocusedTask();
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

      // Cmd+T: create new task
      if (mod && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        createTask("New task");
        return;
      }

      // Cmd+digit: switch workspace (existing) — only when not in board search
      if (mod && !inBoardSearch) {
        const digit = parseInt(e.key, 10);
        if (digit >= 1 && digit <= 9) {
          e.preventDefault();
          const workspaces = useWorkspaceStore.getState().workspaces;
          const ws = workspaces[digit - 1];
          if (ws) {
            void setActiveWorkspace(ws.path);
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

      // Arrow key navigation: only when detail panel is closed and not in board search
      const bs = useBoardStore.getState();
      const dataStore = useDataStore.getState();
      if (!dataStore.selectedTaskId && !inBoardSearch) {
        const currentFocusId = bs.focusedTaskId;
        const tasks = dataStore.tasks;
        const searchQuery = bs.searchQuery;
        const visibleTasks = searchQuery
          ? tasks.filter((t) =>
              t.title.toLowerCase().includes(searchQuery.toLowerCase()),
            )
          : tasks;

        if (
          e.key === "ArrowDown" ||
          e.key === "ArrowUp" ||
          e.key === "ArrowLeft" ||
          e.key === "ArrowRight" ||
          e.key === "Home" ||
          e.key === "End" ||
          e.key === "Enter"
        ) {
          let newFocusId: string | null = currentFocusId;
          const tasksByStatus: Record<TaskStatus, string[]> = {
            backlog: [],
            doing: [],
            review: [],
            done: [],
          };
          for (const t of visibleTasks) {
            tasksByStatus[t.status].push(t.id);
          }

          const getColumnIndex = (taskId: string | null): number => {
            if (!taskId) return -1;
            for (let col = 0; col < COLUMNS.length; col++) {
              const idx = tasksByStatus[COLUMNS[col]].indexOf(taskId);
              if (idx !== -1) return col;
            }
            return -1;
          };

          const getIndexInColumn = (taskId: string | null): number => {
            if (!taskId) return -1;
            for (const col of COLUMNS) {
              const idx = tasksByStatus[col].indexOf(taskId);
              if (idx !== -1) return idx;
            }
            return -1;
          };

          const getNonEmptyColumns = (): TaskStatus[] => {
            return COLUMNS.filter((col) => tasksByStatus[col].length > 0);
          };

          const getNonEmptyColIndex = (taskId: string | null): number => {
            if (!taskId) return -1;
            const colIdx = getColumnIndex(taskId);
            if (colIdx === -1) return -1;
            const taskStatus = COLUMNS[colIdx];
            return nonEmptyCols.indexOf(taskStatus);
          };

          const nonEmptyCols = getNonEmptyColumns();

          if (e.key === "Enter" && currentFocusId) {
            e.preventDefault();
            dataStore.setSelectedTask(currentFocusId);
            return;
          }

          if (e.key === "Home" || e.key === "End") {
            e.preventDefault();
            const currentColIdx = currentFocusId
              ? getColumnIndex(currentFocusId)
              : 0;
            const targetCol = nonEmptyCols[currentColIdx] || "backlog";
            const targetTasks = tasksByStatus[targetCol];
            if (targetTasks.length > 0) {
              newFocusId =
                e.key === "Home"
                  ? targetTasks[0]
                  : targetTasks[targetTasks.length - 1];
            }
          } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const currentNonEmptyIdx = currentFocusId
              ? getNonEmptyColIndex(currentFocusId)
              : 0;
            const targetCol = nonEmptyCols[currentNonEmptyIdx] || "backlog";
            const targetTasks = tasksByStatus[targetCol];
            const currentIdx = currentFocusId
              ? getIndexInColumn(currentFocusId)
              : -1; // Both start at -1 so ArrowDown goes to 0 and ArrowUp wraps

            let nextIdx: number;
            if (e.key === "ArrowDown") {
              nextIdx = currentIdx + 1;
              if (nextIdx >= targetTasks.length) {
                const nextNonEmptyIdx =
                  (currentNonEmptyIdx + 1) % nonEmptyCols.length;
                const nextCol = nonEmptyCols[nextNonEmptyIdx];
                newFocusId = tasksByStatus[nextCol][0];
              } else {
                newFocusId = targetTasks[nextIdx];
              }
            } else {
              nextIdx = currentIdx - 1;
              if (nextIdx < 0) {
                const prevNonEmptyIdx =
                  (currentNonEmptyIdx - 1 + nonEmptyCols.length) %
                  nonEmptyCols.length;
                const prevCol = nonEmptyCols[prevNonEmptyIdx];
                newFocusId =
                  tasksByStatus[prevCol][tasksByStatus[prevCol].length - 1];
              } else {
                newFocusId = targetTasks[nextIdx];
              }
            }
          } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            let currentColIdx = currentFocusId
              ? getColumnIndex(currentFocusId)
              : 0;
            if (currentColIdx === -1) currentColIdx = 0;
            const currentIdx = currentFocusId
              ? getIndexInColumn(currentFocusId)
              : 0;

            const moveDir = e.key === "ArrowRight" ? 1 : -1;
            let newColIdx = currentColIdx + moveDir;

            while (newColIdx >= 0 && newColIdx < nonEmptyCols.length) {
              const newCol = nonEmptyCols[newColIdx];
              const newColTasks = tasksByStatus[newCol];
              if (newColTasks.length > 0) {
                const clampedIdx = Math.min(currentIdx, newColTasks.length - 1);
                newFocusId = newColTasks[clampedIdx];
                break;
              }
              newColIdx += moveDir;
            }
          }

          // Default to first task in backlog if no focus set
          if (!newFocusId && visibleTasks.length > 0) {
            newFocusId =
              visibleTasks.find((t) => t.status === "backlog")?.id ||
              visibleTasks[0].id;
          }

          // Check if the focused task is still visible (not filtered out)
          if (searchQuery && newFocusId) {
            const focusedTask = tasks.find((t) => t.id === newFocusId);
            if (
              !focusedTask ||
              !focusedTask.title
                .toLowerCase()
                .includes(searchQuery.toLowerCase())
            ) {
              bs.clearFocusedTask();
              return;
            }
          }

          if (newFocusId) {
            bs.setFocusedTask(newFocusId);
          }
          return;
        }
      }
    },
    [addWorkspace, setActiveWorkspace],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
