import { useMemo } from "react";
import { useDataStore } from "../../stores/useDataStore";
import { useNavStore } from "../../stores/useNavStore";
import { useTerminalStore } from "../../stores/useTerminalStore";
import type { WorktreeDisplayItem } from "@shared/types";
import styles from "./WorktreeList.module.css";

export function WorktreeList(): React.JSX.Element | null {
  const tasks = useDataStore((s) => s.tasks);
  const terminalTabs = useTerminalStore((s) => s.tabs);
  const idleMap = useTerminalStore((s) => s.idleMap);
  const setActiveTab = useTerminalStore((s) => s.setActiveTab);

  // Derive worktree display items — useMemo prevents new array reference every render
  const worktrees: WorktreeDisplayItem[] = useMemo(
    () =>
      tasks
        .filter((t) => t.status === "doing" && t.worktree !== null)
        .map((t) => {
          const termTabId = `wt-${t.id}`;
          const hasTerminal = terminalTabs.some((tab) => tab.id === termTabId);
          const isActive = hasTerminal && idleMap[termTabId] === false;
          return {
            taskId: t.id,
            taskTitle: t.title,
            branch: t.branch ?? "(unknown branch)",
            worktreePath: t.worktree!,
            terminalOpen: isActive,
          };
        }),
    [tasks, terminalTabs, idleMap],
  );

  if (worktrees.length === 0) return null;

  function handleClick(taskId: string): void {
    useNavStore.getState().setActiveView("board");
    useDataStore.getState().setSelectedTask(taskId);

    // Activate the worktree's terminal tab (if one exists) and open the panel
    const termTabId = `wt-${taskId}`;
    const hasTab = useTerminalStore
      .getState()
      .tabs.some((t) => t.id === termTabId);
    if (hasTab) {
      setActiveTab(termTabId);
      if (!useNavStore.getState().terminalPanelOpen) {
        useNavStore.getState().toggleTerminalPanel();
      }
    }
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionLabel}>Worktrees</div>
      {worktrees.map((wt) => (
        <div
          key={wt.taskId}
          className={styles.item}
          onClick={() => handleClick(wt.taskId)}
          title={wt.worktreePath}
        >
          <div className={styles.branchLine}>
            <span className={styles.branchIcon}>&#x2387;</span>
            <span className={styles.branchName}>{wt.branch}</span>
          </div>
          <div className={styles.taskLine}>
            <span className={styles.taskId}>{wt.taskId}</span>
            <span className={styles.separator}>·</span>
            <span className={styles.taskTitle}>{wt.taskTitle}</span>
          </div>
          <div className={styles.statusLine}>
            <span
              className={
                wt.terminalOpen ? styles.statusDotActive : styles.statusDot
              }
            >
              ●
            </span>
            <span className={styles.statusLabel}>
              {wt.terminalOpen ? "running" : "idle"}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
