import React from "react";
import { createPortal } from "react-dom";
import { useEffect, useRef, useMemo } from "react";
import {
  useTaskSwitcherStore,
  switchToTask,
  type SortedTask,
} from "../../stores/useTaskSwitcherStore";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { useAllTasksStore } from "../../stores/useAllTasksStore";
import { useNavStore } from "../../stores/useNavStore";
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
  const includeDoneTasks = useTaskSwitcherStore((s) => s.includeDoneTasks);
  const toggleIncludeDoneTasks = useTaskSwitcherStore(
    (s) => s.toggleIncludeDoneTasks,
  );

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const hiddenWorkspaces = useWorkspaceStore((s) => s.hiddenWorkspaces);
  const allTasks = useAllTasksStore((s) => s.allTasks);
  const fetchingTasks = useAllTasksStore((s) => s.fetchingTasks);
  const fetchAllWorkspaceTasks = useAllTasksStore(
    (s) => s.fetchAllWorkspaceTasks,
  );

  const visibleWorkspaces = useMemo(() => {
    return workspaces.filter((ws) => !hiddenWorkspaces.has(ws.path));
  }, [workspaces, hiddenWorkspaces]);

  type SpecialPage = "settings" | "agents";
  const specialPages: { page: SpecialPage; name: string }[] = [
    { page: "settings", name: "Settings" },
    { page: "agents", name: "Agents" },
  ];

  const matchingSpecialPages = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return [];
    return specialPages.filter((sp) => sp.name.toLowerCase().startsWith(query));
  }, [searchQuery]);

  const isLoading = useMemo(() => {
    for (const ws of visibleWorkspaces) {
      if (fetchingTasks.get(ws.path)) {
        return true;
      }
    }
    return false;
  }, [visibleWorkspaces, fetchingTasks]);

  useEffect(() => {
    if (isOpen) {
      void fetchAllWorkspaceTasks(visibleWorkspaces);
    }
  }, [isOpen, visibleWorkspaces, fetchAllWorkspaceTasks]);

  const sortedTasks = getSortedTasks(visibleWorkspaces, allTasks);
  const totalItems = sortedTasks.length + matchingSpecialPages.length;
  const noResults =
    totalItems === 0 && searchQuery.trim().length > 0 && !isLoading;
  const createWorkspace = visibleWorkspaces[createWorkspaceIndex] ?? null;
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

      if (mod && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        toggleIncludeDoneTasks();
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveSelection(1, totalItems);
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        moveSelection(-1, totalItems);
        return;
      }

      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        if (noResults && visibleWorkspaces.length > 0) {
          e.preventDefault();
          const delta = e.key === "ArrowRight" ? 1 : -1;
          cycleCreateWorkspace(delta, visibleWorkspaces.length);
        }
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        // Check if a special page is selected (Settings or Agents)
        if (selectedIndex < matchingSpecialPages.length) {
          const sp = matchingSpecialPages[selectedIndex];
          useNavStore.getState().setActiveView(sp.page);
          close();
          return;
        }
        if (noResults && createWorkspace) {
          void createTask(searchQuery.trim(), createWorkspace.path).then(() =>
            close(),
          );
          return;
        }
        const task = sortedTasks[selectedIndex - matchingSpecialPages.length];
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
    totalItems,
    selectedIndex,
    close,
    moveSelection,
    toggleIncludeDoneTasks,
  ]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!listRef.current || totalItems === 0) return;
    const index = Math.min(selectedIndex, totalItems - 1);
    const selectedEl = listRef.current.children[index] as HTMLElement;
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedIndex, totalItems]);

  if (!isOpen) return null;

  const renderRunningDot = (task: SortedTask): React.ReactNode => {
    const hasPlanSession = !!task.task.terminalPlanSession;
    const hasExecSession = !!task.task.terminalExecSession;
    const isAgentRunning =
      (hasExecSession && task.execTmuxAlive) ||
      (hasPlanSession && task.planTmuxAlive);
    const isAgentActive =
      task.execAgentState === "active" || task.planAgentState === "active";

    if (!isAgentRunning) return null;

    return (
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
              Press <kbd>Enter</kbd> to create &ldquo;{searchQuery}&rdquo;
              {visibleWorkspaces.length > 1 && (
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
          ) : sortedTasks.length === 0 && matchingSpecialPages.length === 0 ? (
            <div className={styles.empty}>No tasks found</div>
          ) : (
            <>
              {matchingSpecialPages.map((sp, index) => (
                <div
                  key={sp.page}
                  className={`${styles.item} ${
                    index === selectedIndex ? styles.selected : ""
                  }`}
                  onClick={() => {
                    useNavStore.getState().setActiveView(sp.page);
                    close();
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <span className={styles.taskId}>{sp.page}</span>
                  <span className={styles.taskTitle}>{sp.name}</span>
                </div>
              ))}
              {matchingSpecialPages.length > 0 && sortedTasks.length > 0 && (
                <div className={styles.separator} />
              )}
              {sortedTasks.map((task, index) => {
                const taskIndex = matchingSpecialPages.length + index;
                const prevTask = index > 0 ? sortedTasks[index - 1] : null;
                const showSeparator =
                  prevTask && prevTask.groupSort > task.groupSort;
                return (
                  <React.Fragment key={`${task.workspacePath}:${task.task.id}`}>
                    {showSeparator && <div className={styles.separator} />}
                    <div
                      className={`${styles.item} ${
                        taskIndex === selectedIndex ? styles.selected : ""
                      }`}
                      onClick={() => {
                        switchToTask(task).then(() => close());
                      }}
                      onMouseEnter={() => setSelectedIndex(taskIndex)}
                    >
                      {renderRunningDot(task)}
                      <span className={styles.taskId}>{task.task.id}</span>
                      <span className={styles.taskTitle}>
                        {task.task.title}
                      </span>
                      <span className={styles.workspaceName}>
                        {task.workspaceName}
                      </span>
                      <span
                        className={`${styles.statusBadge} ${styles[task.task.status]}`}
                      >
                        {task.task.status}
                      </span>
                    </div>
                  </React.Fragment>
                );
              })}
            </>
          )}
        </div>
        <div className={styles.hint}>
          {noResults && visibleWorkspaces.length > 1 ? (
            <>
              <kbd>←</kbd>
              <kbd>→</kbd> Workspace · <kbd>Enter</kbd> Create · <kbd>Esc</kbd>{" "}
              Close · <kbd>Cmd+Shift+D</kbd>{" "}
              {includeDoneTasks ? "Hide" : "Show"} Done
            </>
          ) : (
            <>
              <kbd>↑↓</kbd> Navigate · <kbd>Enter</kbd> Select · <kbd>Esc</kbd>{" "}
              Close · <kbd>Cmd+Shift+D</kbd>{" "}
              {includeDoneTasks ? "Hide" : "Show"} Done
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
