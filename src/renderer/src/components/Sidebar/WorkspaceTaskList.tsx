import { useEffect, useMemo } from "react";
import type { TaskInfo } from "@shared/types";
import {
  useAllTasksStore,
  type TaskWithWorkspace,
} from "../../stores/useAllTasksStore";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { useDataStore } from "../../stores/useDataStore";
import {
  switchToTask,
  type SortedTask,
} from "../../stores/useTaskSwitcherStore";
import styles from "./WorkspaceTaskList.module.css";
import { useTmuxLivenessStore } from "../../stores/useTmuxLivenessStore";

const STATUS_COLORS: Record<string, string> = {
  backlog: "var(--status-backlog)",
  doing: "var(--status-green)",
  review: "var(--status-amber)",
  done: "var(--status-done)",
};

interface WorkspaceTaskListProps {
  workspacePath: string;
  workspaceName: string;
}

export function WorkspaceTaskList({
  workspacePath,
  workspaceName,
}: WorkspaceTaskListProps): React.JSX.Element {
  const allTasks = useAllTasksStore((s) => s.allTasks);
  const fetchTasksForWorkspace = useAllTasksStore(
    (s) => s.fetchTasksForWorkspace,
  );
  const liveness = useTmuxLivenessStore((s) => s.liveness);
  const activeWorkspacePath = useWorkspaceStore((s) => s.activeWorkspacePath);
  const selectedTaskId = useDataStore((s) => s.selectedTaskId);

  useEffect(() => {
    if (!allTasks.has(workspacePath)) {
      void fetchTasksForWorkspace(workspacePath);
    }
  }, [workspacePath, allTasks, fetchTasksForWorkspace]);

  const tasks = useMemo(
    () => allTasks.get(workspacePath) || [],
    [allTasks, workspacePath],
  );

  const tasksByStatus = useMemo(() => {
    const grouped: Record<string, TaskWithWorkspace[]> = {
      backlog: [],
      doing: [],
      review: [],
      done: [],
    };
    for (const task of tasks) {
      const status = task.status as string;
      if (!grouped[status] || status === "done") continue;

      const hasPlanSession = !!task.terminalPlanSession;
      const hasExecSession = !!task.terminalExecSession;
      const planAlive = hasPlanSession
        ? (liveness[`${workspacePath}:plan:${task.id}`]?.alive ?? false)
        : false;
      const execAlive = hasExecSession
        ? (liveness[`${workspacePath}:execute:${task.id}`]?.alive ?? false)
        : false;
      const isActiveTmux =
        (hasPlanSession && planAlive) || (hasExecSession && execAlive);
      const execAgentState =
        liveness[`${workspacePath}:execute:${task.id}`]?.state ?? null;
      const planAgentState =
        liveness[`${workspacePath}:plan:${task.id}`]?.state ?? null;
      const lastViewedAt = 0;

      grouped[status].push({
        ...task,
        workspacePath,
        workspaceName,
        isRunning: isActiveTmux,
        execTmuxAlive: execAlive,
        planTmuxAlive: planAlive,
        execAgentState,
        planAgentState,
        lastViewedAt,
      });
    }
    return grouped;
  }, [tasks, workspacePath, workspaceName, liveness]);

  const hasTasks = tasks.filter((t) => t.status !== "done").length > 0;

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
      tags: task.tags,
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

  if (!hasTasks) return <></>;

  return (
    <div className={styles.container}>
      <div className={styles.taskGroups}>
        {Object.entries(tasksByStatus).map(([status, statusTasks]) => {
          if (statusTasks.length === 0) return null;
          return (
            <div key={status} className={styles.statusGroup}>
              <div className={styles.statusHeader}>
                <span
                  className={styles.statusDot}
                  style={{ background: STATUS_COLORS[status] }}
                />
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </div>
              {statusTasks.map((task) => {
                const hasPlanSession = !!task.terminalPlanSession;
                const hasExecSession = !!task.terminalExecSession;
                const planKey = `${workspacePath}:plan:${task.id}`;
                const execKey = `${workspacePath}:execute:${task.id}`;
                const planEntry = liveness[planKey];
                const execEntry = liveness[execKey];
                const planAlive = !!planEntry?.alive;
                const execAlive = !!execEntry?.alive;
                const isAgentRunning =
                  (hasExecSession && execAlive) ||
                  (hasPlanSession && planAlive);
                const isAgentActive =
                  execEntry?.state === "active" ||
                  planEntry?.state === "active";

                return (
                  <div
                    key={`${workspacePath}:${task.id}`}
                    className={`${styles.taskItem} ${task.id === selectedTaskId && task.workspacePath === activeWorkspacePath ? styles.taskItemSelected : ""}`}
                    onClick={() => handleTaskClick(task)}
                  >
                    {/* Single unified dot: running overrides status color */}
                    <span
                      className={
                        isAgentRunning
                          ? `${styles.statusDot} ${isAgentActive ? styles.statusDotRunning : styles.statusDotWaiting}`
                          : styles.statusDot
                      }
                      style={{
                        background: isAgentRunning
                          ? isAgentActive
                            ? "var(--status-green)"
                            : "var(--status-yellow, #f0c060)"
                          : STATUS_COLORS[task.status],
                      }}
                    />
                    <span className={styles.taskId}>{task.id}</span>
                    <span className={styles.taskTitle}>{task.title}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
