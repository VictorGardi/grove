import { useState, useEffect, useRef, useCallback } from "react";
import type { PlanMode, TaskInfo } from "@shared/types";
import { usePlanStore } from "../stores/usePlanStore";
import {
  useTmuxLivenessStore,
  LIVENESS_TTL_MS,
} from "../stores/useTmuxLivenessStore";

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
  livenessKey: string,
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
      const entry = useTmuxLivenessStore.getState().liveness[livenessKey];
      if (entry?.alive === true) {
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

  // Read liveness from the shared store reactively so derived status updates
  // when the poller writes new values.
  const liveness = useTmuxLivenessStore((s) => s.liveness);

  const [tasks, setTasks] = useState<TaskInfo[]>([]);

  // Render-trigger: increment to force a re-render after cache writes without
  // storing the cache itself in state (avoids the self-reinforcing loop).
  const [, setRenderTick] = useState(0);

  // Cache lives in a ref — no state update on write, no callback churn.
  // Shape: tmuxSessionName → { alive, checkedAt }
  const tmuxAliveCacheRef = useRef<
    Map<string, { alive: boolean; checkedAt: number }>
  >(new Map());

  // Track ongoing checks to avoid concurrent duplicate IPC calls for the same session.
  const inFlightRef = useRef<Set<string>>(new Set());

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Reset cache and shared liveness store when workspace changes
  useEffect(() => {
    tmuxAliveCacheRef.current = new Map();
    inFlightRef.current = new Set();
    useTmuxLivenessStore.getState().clearAll();
  }, [workspacePath]);

  const checkTmuxSessions = useCallback(async () => {
    const doingTasks = tasks.filter((t) => t.status === "doing");
    const cache = tmuxAliveCacheRef.current;
    const inFlight = inFlightRef.current;
    const now = Date.now();
    let changed = false;

    const checks: Promise<void>[] = [];

    for (const task of doingTasks) {
      for (const [mode, tmuxSession] of [
        ["plan" as PlanMode, task.planTmuxSession],
        ["execute" as PlanMode, task.execTmuxSession],
      ] as [PlanMode, string | null][]) {
        if (!tmuxSession) continue;

        const livenessKey = `${mode}:${task.id}`;
        const sessionKey = livenessKey;
        const session = sessions[sessionKey];
        if (!session || session.isRunning) continue;
        if (
          session.sessionStatus === "idle" ||
          session.sessionStatus === "reconnecting"
        )
          continue;

        // Skip if entry is fresh (within TTL) and not in-flight
        const cached = cache.get(tmuxSession);
        if (cached && now - cached.checkedAt < LIVENESS_TTL_MS) continue;

        // Skip if a check is already in-flight for this session
        if (inFlight.has(tmuxSession)) continue;

        inFlight.add(tmuxSession);

        checks.push(
          window.api.plan
            .tmuxCheck({ workspacePath, taskId: task.id, mode })
            .then((result) => {
              const alive = result.ok ? result.data.alive : false;
              if (!result.ok) {
                console.warn(
                  "[useWorkspaceStatus] tmuxCheck failed:",
                  result.error,
                );
              }
              cache.set(tmuxSession, { alive, checkedAt: Date.now() });
              // Write into the shared liveness store so TaskCard reads it reactively
              useTmuxLivenessStore.getState().setLiveness(livenessKey, alive);
              changed = true;
            })
            .catch((err) => {
              console.warn("[useWorkspaceStatus] tmuxCheck error:", err);
              cache.set(tmuxSession, { alive: false, checkedAt: Date.now() });
              useTmuxLivenessStore.getState().setLiveness(livenessKey, false);
              changed = true;
            })
            .finally(() => {
              inFlight.delete(tmuxSession);
            }),
        );
      }
    }

    if (checks.length > 0) {
      await Promise.all(checks);
      if (changed) {
        // Bump the render-trigger so derived status re-evaluates
        setRenderTick((t) => t + 1);
      }
    }
  }, [tasks, sessions, workspacePath]);
  // NOTE: tmuxAliveCacheRef and inFlightRef are refs — intentionally omitted
  // from deps to avoid recreating this callback on every cache write.

  // Poll tmux sessions when needed; restart interval only when tasks/sessions change.
  useEffect(() => {
    void checkTmuxSessions();

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
      pollTimerRef.current = setInterval(() => void checkTmuxSessions(), 5_000);
    }

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [tasks, sessions, checkTmuxSessions]);

  // Derive aggregate status using the shared liveness store (reactive via `liveness` dep)
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
      const livenessKey = sessionKey;
      const status = deriveSessionStatus(sessionKey, tmuxSession, livenessKey);
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
      const livenessKey = sessionKey;
      const status = deriveSessionStatus(sessionKey, tmuxSession, livenessKey);
      taskStatus = higherPriority(taskStatus, status);
    }
    if (taskStatus === aggregateStatus) {
      aggregateCount++;
    }
  }

  // Suppress unused-variable warning — liveness is read to keep this component
  // subscribed so it re-renders when the shared store updates.
  void liveness;

  return { status: aggregateStatus, count: aggregateCount };
}
