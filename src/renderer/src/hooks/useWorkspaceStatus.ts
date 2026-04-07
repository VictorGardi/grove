import { useState, useEffect, useRef, useCallback } from "react";
import type { PlanMode, TaskInfo } from "@shared/types";
import { usePlanStore } from "../stores/usePlanStore";

export type WorkspaceStatus = "failed" | "waiting" | "running" | "idle";

interface WorkspaceStatusResult {
  status: WorkspaceStatus;
  count: number;
}

const STATUS_PRIORITY: Record<WorkspaceStatus, number> = {
  failed: 4,
  waiting: 3,
  running: 2,
  idle: 1,
};

function higherPriority(
  a: WorkspaceStatus,
  b: WorkspaceStatus,
): WorkspaceStatus {
  return STATUS_PRIORITY[a] >= STATUS_PRIORITY[b] ? a : b;
}

function deriveSessionStatus(
  sessionKey: string,
  tmuxSessionName: string | null,
  _workspacePath: string,
  tmuxAliveCache: Map<string, boolean>,
): WorkspaceStatus {
  const planState = usePlanStore.getState();
  const session = planState.sessions[sessionKey];

  if (!session) return "idle";

  // Failed: lastExitCode !== 0
  if (session.lastExitCode != null && session.lastExitCode !== 0) {
    return "failed";
  }

  // Running: isRunning === true
  if (session.isRunning) {
    return "running";
  }

  // Waiting: isRunning === false, session has previously run, tmux session alive
  if (!session.isRunning && tmuxSessionName) {
    const hasPreviouslyRun =
      session.sessionStatus !== "idle" &&
      session.sessionStatus !== "reconnecting";

    if (hasPreviouslyRun) {
      const alive = tmuxAliveCache.get(tmuxSessionName);
      if (alive === true) {
        return "waiting";
      }
    }
  }

  return "idle";
}

export function useWorkspaceStatus(
  workspacePath: string,
): WorkspaceStatusResult {
  const sessions = usePlanStore((s) => s.sessions);
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [tmuxAliveCache, setTmuxAliveCache] = useState<Map<string, boolean>>(
    new Map(),
  );
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch tasks for this workspace
  useEffect(() => {
    let cancelled = false;

    async function fetchTasks() {
      try {
        const result = await window.api.workspaces.fetchTasks(workspacePath);
        if (!cancelled && result.ok) {
          setTasks(result.data);
        }
      } catch (err) {
        console.warn("[useWorkspaceStatus] fetchTasks error:", err);
      }
    }

    fetchTasks();

    return () => {
      cancelled = true;
    };
  }, [workspacePath]);

  // Reset cache when workspace changes to avoid stale entries
  useEffect(() => {
    setTmuxAliveCache(new Map());
  }, [workspacePath]);

  const checkTmuxSessions = useCallback(async () => {
    const doingTasks = tasks.filter((t) => t.status === "doing");
    const newCache = new Map<string, boolean>(tmuxAliveCache);
    let changed = false;

    const checks: Promise<void>[] = [];

    for (const task of doingTasks) {
      for (const [mode, tmuxSession] of [
        ["plan" as PlanMode, task.planTmuxSession],
        ["execute" as PlanMode, task.execTmuxSession],
      ] as [PlanMode, string | null][]) {
        if (!tmuxSession) continue;
        if (newCache.has(tmuxSession)) continue;

        const sessionKey = `${mode}:${task.id}`;
        const session = sessions[sessionKey];
        if (!session || session.isRunning) continue;
        if (
          session.sessionStatus === "idle" ||
          session.sessionStatus === "reconnecting"
        )
          continue;

        checks.push(
          window.api.plan
            .tmuxCheck({ workspacePath, taskId: task.id, mode })
            .then((result) => {
              if (result.ok) {
                newCache.set(tmuxSession, result.data.alive);
                changed = true;
              } else {
                console.warn(
                  "[useWorkspaceStatus] tmuxCheck failed:",
                  result.error,
                );
                newCache.set(tmuxSession, false);
                changed = true;
              }
            })
            .catch((err) => {
              console.warn("[useWorkspaceStatus] tmuxCheck error:", err);
              newCache.set(tmuxSession, false);
              changed = true;
            }),
        );
      }
    }

    if (checks.length > 0) {
      await Promise.all(checks);
      if (changed) {
        setTmuxAliveCache(new Map(newCache));
      }
    }
  }, [tasks, sessions, workspacePath, tmuxAliveCache]);

  // Poll tmux sessions when needed
  useEffect(() => {
    checkTmuxSessions();

    const needsPolling = tasks.some((t) => {
      if (t.status !== "doing") return false;
      for (const [mode, tmuxSession] of [
        ["plan" as PlanMode, t.planTmuxSession],
        ["execute" as PlanMode, t.execTmuxSession],
      ] as [PlanMode, string | null][]) {
        if (!tmuxSession) continue;
        const sessionKey = `${mode}:${t.id}`;
        const session = sessions[sessionKey];
        if (!session) continue;
        if (!session.isRunning && session.sessionStatus !== "idle") {
          return true;
        }
      }
      return false;
    });

    if (needsPolling) {
      pollTimerRef.current = setInterval(checkTmuxSessions, 2000);
    }

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [tasks, sessions, workspacePath, checkTmuxSessions]);

  // Derive aggregate status
  let aggregateStatus: WorkspaceStatus = "idle";
  let aggregateCount = 0;

  const doingTasks = tasks.filter((t) => t.status === "doing");

  for (const task of doingTasks) {
    let taskStatus: WorkspaceStatus = "idle";

    for (const [mode, tmuxSession] of [
      ["plan" as PlanMode, task.planTmuxSession],
      ["execute" as PlanMode, task.execTmuxSession],
    ] as [PlanMode, string | null][]) {
      const sessionKey = `${mode}:${task.id}`;
      const status = deriveSessionStatus(
        sessionKey,
        tmuxSession,
        workspacePath,
        tmuxAliveCache,
      );
      taskStatus = higherPriority(taskStatus, status);
    }

    if (taskStatus !== "idle") {
      aggregateStatus = higherPriority(aggregateStatus, taskStatus);
    }
  }

  // Count tasks matching the aggregate status
  for (const task of doingTasks) {
    let taskStatus: WorkspaceStatus = "idle";
    for (const [mode, tmuxSession] of [
      ["plan" as PlanMode, task.planTmuxSession],
      ["execute" as PlanMode, task.execTmuxSession],
    ] as [PlanMode, string | null][]) {
      const sessionKey = `${mode}:${task.id}`;
      const status = deriveSessionStatus(
        sessionKey,
        tmuxSession,
        workspacePath,
        tmuxAliveCache,
      );
      taskStatus = higherPriority(taskStatus, status);
    }
    if (taskStatus === aggregateStatus) {
      aggregateCount++;
    }
  }

  return { status: aggregateStatus, count: aggregateCount };
}
