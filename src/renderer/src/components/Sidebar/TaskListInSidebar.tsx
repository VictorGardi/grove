import { useEffect, useMemo } from "react";
import {
  useAllTasksStore,
  getAllTasksGrouped,
  type TaskWithWorkspace,
} from "../../stores/useAllTasksStore";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { useDataStore } from "../../stores/useDataStore";
import styles from "./TaskListInSidebar.module.css";

const STATUS_COLORS: Record<string, string> = {
  backlog: "var(--text-lo)",
  doing: "var(--status-green)",
  review: "var(--status-amber)",
  done: "var(--status-green)",
};

export function TaskListInSidebar(): React.JSX.Element {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspacePath = useWorkspaceStore((s) => s.activeWorkspacePath);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);
  const allTasks = useAllTasksStore((s) => s.allTasks);
  const fetchTasksForWorkspace = useAllTasksStore(
    (s) => s.fetchTasksForWorkspace,
  );
  const selectedTaskId = useDataStore((s) => s.selectedTaskId);
  const setSelectedTask = useDataStore((s) => s.setSelectedTask);
  const setTasks = useDataStore((s) => s.setTasks);

  // Fetch tasks on initial load
  useEffect(() => {
    for (const ws of workspaces) {
      if (!allTasks.has(ws.path)) {
        void fetchTasksForWorkspace(ws.path);
      }
    }
  }, [workspaces, allTasks, fetchTasksForWorkspace]);

  const groupedTasks = useMemo(
    () => getAllTasksGrouped(allTasks, workspaces),
    [allTasks, workspaces],
  );

  async function handleTaskClick(task: TaskWithWorkspace): Promise<void> {
    if (task.workspacePath !== activeWorkspacePath) {
      await setActiveWorkspace(task.workspacePath);
      const result = await window.api.data.fetch(task.workspacePath);
      if (result.ok) {
        setTasks(result.data.tasks);
      }
      setSelectedTask(task.id, task.filePath);
    } else {
      setSelectedTask(task.id);
    }
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
                  key={task.id}
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
