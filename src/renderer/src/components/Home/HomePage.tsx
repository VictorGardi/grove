import { useMemo } from "react";
import { useAllTasksStore } from "../../stores/useAllTasksStore";
import { useTmuxLivenessStore } from "../../stores/useTmuxLivenessStore";
import { useTaskSwitcherStore } from "../../stores/useTaskSwitcherStore";
import { useNavStore } from "../../stores/useNavStore";
import { switchToTask } from "../../stores/useTaskSwitcherStore";
import type { TaskInfo } from "@shared/types";
import styles from "./HomePage.module.css";

function GroveLogo(): React.JSX.Element {
  return (
    <div className={styles.logo}>
      <svg
        width="20"
        height="20"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ color: "var(--text-secondary)", flexShrink: 0 }}
      >
        <path
          d="M8 14V8M8 8C8 5.5 6 3 3 3C3 6 5 8 8 8ZM8 8C8 5.5 10 3 13 3C13 6 11 8 8 8Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M6 14H10"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      <span className={styles.logoText}>Grove</span>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  backlog: "var(--status-backlog)",
  doing: "var(--status-green)",
  review: "var(--status-amber)",
  done: "var(--status-done)",
};

interface TaskRowProps {
  task: TaskInfo;
  workspaceName: string;
  isRunning?: boolean;
  isAgentActive?: boolean;
}

function TaskRow({
  task,
  workspaceName,
  isRunning,
  isAgentActive,
}: TaskRowProps): React.JSX.Element {
  function handleClick(): void {
    const sortedTask = {
      task,
      workspacePath: task.workspacePath,
      workspaceName,
      isRunning: isRunning ?? false,
      execTmuxAlive: isRunning ?? false,
      planTmuxAlive: isRunning ?? false,
      execAgentState: isAgentActive ? "active" : undefined,
      planAgentState: isAgentActive ? "active" : undefined,
      lastViewedAt: 0,
      sortScore: 0,
    };
    void switchToTask(sortedTask as Parameters<typeof switchToTask>[0]);
  }

  return (
    <div className={styles.taskRow} onClick={handleClick}>
      {/* Running or status dot */}
      <span
        className={
          isRunning
            ? `${styles.dot} ${isAgentActive ? styles.dotRunning : styles.dotWaiting}`
            : styles.dot
        }
        style={{
          background: isRunning ? undefined : STATUS_COLORS[task.status],
        }}
      />
      <span className={styles.taskId}>{task.id}</span>
      <span className={styles.taskTitle}>{task.title}</span>
      <span className={styles.workspaceName}>{workspaceName}</span>
      <span className={`${styles.statusPill} ${styles[task.status]}`}>
        {task.status}
      </span>
    </div>
  );
}

export function HomePage(): React.JSX.Element {
  const allTasks = useAllTasksStore((s) => s.allTasks);
  const liveness = useTmuxLivenessStore((s) => s.liveness);
  const recentTaskIds = useTaskSwitcherStore((s) => s.recentTaskIds);
  const setActiveView = useNavStore((s) => s.setActiveView);

  // Build a flat list of all tasks with workspace info
  const allTasksFlat = useMemo(() => {
    const result: {
      task: TaskInfo;
      workspacePath: string;
      workspaceName: string;
    }[] = [];
    for (const [workspacePath, tasks] of allTasks) {
      for (const task of tasks) {
        const workspaceName = workspacePath.split("/").pop() ?? workspacePath;
        result.push({ task, workspacePath, workspaceName });
      }
    }
    return result;
  }, [allTasks]);

  // Active tasks: tasks with alive plan or exec session
  const activeTasks = useMemo(() => {
    return allTasksFlat
      .filter(({ task }) => {
        if (task.status === "done") return false;
        const planAlive = liveness[`plan:${task.id}`]?.alive ?? false;
        const execAlive = liveness[`execute:${task.id}`]?.alive ?? false;
        return planAlive || execAlive;
      })
      .map(({ task, workspacePath, workspaceName }) => {
        const planAlive = liveness[`plan:${task.id}`]?.alive ?? false;
        const execAlive = liveness[`execute:${task.id}`]?.alive ?? false;
        const isRunning = planAlive || execAlive;
        const isAgentActive =
          liveness[`execute:${task.id}`]?.state === "active" ||
          liveness[`plan:${task.id}`]?.state === "active";
        return { task, workspacePath, workspaceName, isRunning, isAgentActive };
      });
  }, [allTasksFlat, liveness]);

  // Recent tasks: top 5 recent task IDs (not done, not already in active)
  const recentTasks = useMemo(() => {
    const activeIds = new Set(activeTasks.map((t) => t.task.id));
    return recentTaskIds
      .filter((id) => !activeIds.has(id))
      .slice(0, 5)
      .map((id) => allTasksFlat.find((t) => t.task.id === id))
      .filter(
        (t): t is NonNullable<typeof t> =>
          t !== undefined && t.task.status !== "done",
      )
      .map(({ task, workspacePath, workspaceName }) => ({
        task,
        workspacePath,
        workspaceName,
        isRunning: false,
        isAgentActive: false,
      }));
  }, [recentTaskIds, activeTasks, allTasksFlat]);

  const hasActive = activeTasks.length > 0;
  const hasRecent = recentTasks.length > 0;

  return (
    <div className={styles.container}>
      <GroveLogo />
      <div className={styles.content}>
        {hasActive && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Active now</h2>
            <div className={styles.taskList}>
              {activeTasks.map(
                ({ task, workspaceName, isRunning, isAgentActive }) => (
                  <TaskRow
                    key={`${task.workspacePath}:${task.id}`}
                    task={task}
                    workspaceName={workspaceName}
                    isRunning={isRunning}
                    isAgentActive={isAgentActive}
                  />
                ),
              )}
            </div>
          </section>
        )}

        {hasRecent && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Recent</h2>
            <div className={styles.taskList}>
              {recentTasks.map(({ task, workspaceName }) => (
                <TaskRow
                  key={`${task.workspacePath}:${task.id}`}
                  task={task}
                  workspaceName={workspaceName}
                />
              ))}
            </div>
          </section>
        )}

        {!hasActive && !hasRecent && (
          <div className={styles.empty}>
            <p>No recent activity.</p>
            <p>
              Select a task from the sidebar or press <kbd>⌘⇧K</kbd> to get
              started.
            </p>
          </div>
        )}

        <div className={styles.footer}>
          <button
            className={styles.boardLink}
            onClick={() => setActiveView("board")}
          >
            View board →
          </button>
        </div>
      </div>
    </div>
  );
}
