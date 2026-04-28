import { useEffect, useMemo } from "react";
import type { TaskInfo } from "@shared/types";
import {
  useAllTasksStore,
  getAllTasksGrouped,
  type TaskWithWorkspace,
} from "../../stores/useAllTasksStore";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { useDataStore } from "../../stores/useDataStore";
import {
  switchToTask,
  type SortedTask,
} from "../../stores/useTaskSwitcherStore";
import styles from "./TaskListInSidebar.module.css";

const STATUS_COLORS: Record<string, string> = {
  backlog: "var(--text-lo)",
  doing: "var(--status-green)",
  review: "var(--status-amber)",
  done: "var(--status-green)",
};

export function TaskListInSidebar(): React.JSX.Element {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const hiddenWorkspaces = useWorkspaceStore((s) => s.hiddenWorkspaces);
  const activeWorkspacePath = useWorkspaceStore((s) => s.activeWorkspacePath);
  const allTasks = useAllTasksStore((s) => s.allTasks);
  const fetchTasksForWorkspace = useAllTasksStore(
    (s) => s.fetchTasksForWorkspace,
  );
  const selectedTaskId = useDataStore((s) => s.selectedTaskId);

  const visibleWorkspaces = useMemo(() => {
    return workspaces.filter((ws) => !hiddenWorkspaces.has(ws.path));
  }, [workspaces, hiddenWorkspaces]);

  useEffect(() => {
    for (const ws of visibleWorkspaces) {
      if (!allTasks.has(ws.path)) {
        void fetchTasksForWorkspace(ws.path);
      }
    }
  }, [visibleWorkspaces, allTasks, fetchTasksForWorkspace]);

  const groupedTasks = useMemo(
    () => getAllTasksGrouped(allTasks, visibleWorkspaces),
    [allTasks, visibleWorkspaces],
  );

  function handleTaskClick(task: TaskWithWorkspace): void {
    const taskInfo: TaskInfo = {
      id: task.id,
      title: task.title,
      status: task.status,
      filePath: task.filePath,
      created: task.created,
      agent: task.agent,
      worktree: task.worktree,
      branch: task.branch,
      decisions: task.decisions,
      description: task.description,
      dodTotal: task.dodTotal,
      dodDone: task.dodDone,
      workspacePath: task.workspacePath,
      useWorktree: task.useWorktree,
      planSessionId: task.planSessionId,
      planSessionAgent: task.planSessionAgent,
      planModel: task.planModel,
      execSessionId: task.execSessionId,
      execSessionAgent: task.execSessionAgent,
      execModel: task.execModel,
      terminalPlanSession: task.terminalPlanSession,
      terminalExecSession: task.terminalExecSession,
      terminalPlanContextSent: task.terminalPlanContextSent ?? false,
      terminalExecContextSent: task.terminalExecContextSent,
      planLastExitCode: task.planLastExitCode,
      execLastExitCode: task.execLastExitCode,
      completed: task.completed,
    };
    const sortedTask: SortedTask = {
      ...task,
      task: taskInfo,
      sortScore: 0,
      recentGroup: "other",
      groupSort: 0,
    };
    void switchToTask(sortedTask);
  }

  return (
    <div className={styles.container}>
      {Array.from(groupedTasks.entries()).map(([groupKey, tasks]) => {
        const [workspaceName, statusLabel] = groupKey.split(" - ");
        const status = statusLabel?.toLowerCase() as keyof typeof STATUS_COLORS;

        return (
          <div key={groupKey} className={styles.workspaceSection}>
            <div className={styles.workspaceHeader}>{workspaceName}</div>
            <div className={styles.statusGroup}>
              <div className={styles.statusHeader}>
                <span
                  className={styles.statusDot}
                  style={{
                    background: STATUS_COLORS[status] || STATUS_COLORS.backlog,
                  }}
                />
                {statusLabel}
              </div>
              {tasks.map((task) => (
                <div
                  key={`${task.workspacePath}:${task.id}`}
                  className={`${styles.taskItem} ${task.id === selectedTaskId && task.workspacePath === activeWorkspacePath ? styles.taskItemSelected : ""}`}
                  onClick={() => handleTaskClick(task)}
                >
                  <span className={styles.taskItemId}>{task.id}</span>
                  <span className={styles.taskItemTitle}>{task.title}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {groupedTasks.size === 0 && (
        <div className={styles.emptyState}>No tasks</div>
      )}
    </div>
  );
}
