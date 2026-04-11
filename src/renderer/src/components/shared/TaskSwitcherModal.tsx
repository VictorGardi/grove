import { createPortal } from "react-dom";
import { useEffect, useRef, useMemo } from "react";
import {
  useTaskSwitcherStore,
  switchToTask,
  type SortedTask,
} from "../../stores/useTaskSwitcherStore";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { useAllTasksStore } from "../../stores/useAllTasksStore";
import { createTask } from "../../actions/taskActions";
import styles from "./TaskSwitcherModal.module.css";

export function TaskSwitcherModal(): React.JSX.Element | null {
  const isOpen = useTaskSwitcherStore((s) => s.isOpen);
  const searchQuery = useTaskSwitcherStore((s) => s.searchQuery);
  const selectedIndex = useTaskSwitcherStore((s) => s.selectedIndex);
  const setSearchQuery = useTaskSwitcherStore((s) => s.setSearchQuery);
  const setSelectedIndex = useTaskSwitcherStore((s) => s.setSelectedIndex);
  const moveSelection = useTaskSwitcherStore((s) => s.moveSelection);
  const close = useTaskSwitcherStore((s) => s.close);
  const getSortedTasks = useTaskSwitcherStore((s) => s.getSortedTasks);
  const createWorkspaceIndex = useTaskSwitcherStore(
    (s) => s.createWorkspaceIndex,
  );
  const cycleCreateWorkspace = useTaskSwitcherStore(
    (s) => s.cycleCreateWorkspace,
  );

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const allTasks = useAllTasksStore((s) => s.allTasks);
  const fetchingTasks = useAllTasksStore((s) => s.fetchingTasks);
  const fetchAllWorkspaceTasks = useAllTasksStore(
    (s) => s.fetchAllWorkspaceTasks,
  );

  const isLoading = useMemo(() => {
    for (const ws of workspaces) {
      if (fetchingTasks.get(ws.path)) {
        return true;
      }
    }
    return false;
  }, [workspaces, fetchingTasks]);

  useEffect(() => {
    if (isOpen) {
      void fetchAllWorkspaceTasks(workspaces);
    }
  }, [isOpen, workspaces, fetchAllWorkspaceTasks]);

  const sortedTasks = getSortedTasks(workspaces, allTasks);
  const noResults =
    sortedTasks.length === 0 && searchQuery.trim().length > 0 && !isLoading;
  const createWorkspace = workspaces[createWorkspaceIndex] ?? null;
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent): void {
      const mod = e.metaKey || e.ctrlKey;

      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }

      if (mod && e.shiftKey && (e.key === "Tab" || e.key === "Tab")) {
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveSelection(1, sortedTasks.length);
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        moveSelection(-1, sortedTasks.length);
        return;
      }

      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        if (noResults && workspaces.length > 0) {
          e.preventDefault();
          const delta = e.key === "ArrowRight" ? 1 : -1;
          cycleCreateWorkspace(delta, workspaces.length);
        }
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        if (noResults && createWorkspace) {
          void createTask(searchQuery.trim(), createWorkspace.path).then(() =>
            close(),
          );
          return;
        }
        const task = sortedTasks[selectedIndex];
        if (task) {
          switchToTask(task).then(() => close());
        }
        return;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    isOpen,
    sortedTasks,
    sortedTasks.length,
    selectedIndex,
    close,
    moveSelection,
  ]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!listRef.current || sortedTasks.length === 0) return;
    const index = Math.min(selectedIndex, sortedTasks.length - 1);
    const selectedEl = listRef.current.children[index] as HTMLElement;
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedIndex, sortedTasks.length]);

  if (!isOpen) return null;

  const renderStatus = (task: SortedTask): React.ReactNode => {
    const hasPlanSession = !!task.task.terminalPlanSession;
    const hasExecSession = !!task.task.terminalExecSession;
    const isAgentRunning =
      (hasExecSession && task.execTmuxAlive) ||
      (hasPlanSession && task.planTmuxAlive);
    const isAgentActive =
      task.execAgentState === "active" || task.planAgentState === "active";

    return (
      <>
        <span className={`${styles.statusBadge} ${styles[task.task.status]}`}>
          {task.task.status}
        </span>
        {isAgentRunning && (
          <span
            className={`${styles.runningDot} ${
              isAgentActive ? styles.runningDotActive : styles.runningDotWaiting
            }`}
            style={{
              background: isAgentActive
                ? "var(--status-green)"
                : "var(--status-yellow, #f0c060)",
            }}
          />
        )}
      </>
    );
  };

  return createPortal(
    <div className={styles.backdrop} onClick={close}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-switcher-title"
        tabIndex={-1}
      >
        <div id="task-switcher-title" className={styles.title}>
          Switch to task
        </div>
        <div className={styles.searchRow}>
          <svg
            className={styles.searchIcon}
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="7" cy="7" r="5" />
            <line x1="11" y1="11" x2="14" y2="14" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className={styles.input}
            placeholder="Search tasks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className={styles.clearBtn}
              onClick={() => setSearchQuery("")}
              title="Clear search"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <line x1="2" y1="2" x2="12" y2="12" />
                <line x1="12" y1="2" x2="2" y2="12" />
              </svg>
            </button>
          )}
        </div>
        <div ref={listRef} className={styles.list}>
          {isLoading ? (
            <div className={styles.empty}>Loading tasks...</div>
          ) : noResults ? (
            <div className={styles.createPrompt}>
              Press <kbd>Enter</kbd> to create "{searchQuery}"
              {workspaces.length > 1 && (
                <span className={styles.workspaceHint}>
                  {" "}
                  in{" "}
                  <span className={styles.workspaceName}>
                    {createWorkspace?.name}
                  </span>
                  <kbd>←</kbd>
                  <kbd>→</kbd> to change
                </span>
              )}
            </div>
          ) : sortedTasks.length === 0 ? (
            <div className={styles.empty}>No tasks found</div>
          ) : (
            sortedTasks.map((task, index) => (
              <div
                key={`${task.workspacePath}:${task.task.id}`}
                className={`${styles.item} ${
                  index === selectedIndex ? styles.selected : ""
                }`}
                onClick={() => {
                  switchToTask(task).then(() => close());
                }}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <div className={styles.itemMain}>
                  <span className={styles.taskTitle}>{task.task.title}</span>
                  <span className={styles.taskId}>
                    #{task.task.id.replace(/^T-/, "")}
                  </span>
                </div>
                <div className={styles.itemMeta}>
                  <div className={styles.statusColumn}>
                    {renderStatus(task)}
                  </div>
                  <div className={styles.workspaceColumn}>
                    <span className={styles.workspace}>
                      {task.workspaceName}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
        <div className={styles.hint}>
          {noResults && workspaces.length > 1 ? (
            <>
              <kbd>←</kbd>
              <kbd>→</kbd> Workspace · <kbd>Enter</kbd> Create · <kbd>Esc</kbd>{" "}
              Close
            </>
          ) : (
            <>
              <kbd>↑↓</kbd> Navigate · <kbd>Enter</kbd> Select · <kbd>Esc</kbd>{" "}
              Close
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
