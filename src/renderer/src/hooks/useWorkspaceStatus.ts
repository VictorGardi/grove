import { useState, useEffect, useRef, useCallback } from "react";
import type { PlanMode } from "@shared/types";
import {
  useTmuxLivenessStore,
  LIVENESS_TTL_MS,
} from "../stores/useTmuxLivenessStore";
import { useDataStore } from "../stores/useDataStore";
import { useWorkspaceStore } from "../stores/useWorkspaceStore";

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

export function useWorkspaceStatus(
  workspacePath: string,
): WorkspaceStatusResult {
  const dataStoreTasks = useDataStore((s) => s.tasks);
  const activeWorkspacePath = useWorkspaceStore((s) => s.activeWorkspacePath);
  const isActiveWorkspace = workspacePath === activeWorkspacePath;

  const [workspaceTasks, setWorkspaceTasks] = useState<typeof dataStoreTasks>(
    [],
  );

  const tasks = isActiveWorkspace ? dataStoreTasks : workspaceTasks;

  // Sync workspaceTasks when switching to active workspace - defer to next render
  // to avoid calling setState within useEffect
  const prevIsActiveRef = useRef(isActiveWorkspace);
  useEffect(() => {
    if (isActiveWorkspace && !prevIsActiveRef.current) {
      const timer = setTimeout(() => {
        setWorkspaceTasks(dataStoreTasks);
      }, 0);
      prevIsActiveRef.current = isActiveWorkspace;
      return () => clearTimeout(timer);
    }
    prevIsActiveRef.current = isActiveWorkspace;
    return undefined;
  }, [isActiveWorkspace, dataStoreTasks]);

  // Fetch tasks for non-active workspaces
  useEffect(() => {
    if (isActiveWorkspace) return;

    let cancelled = false;
    async function fetchWorkspaceTasks(): Promise<void> {
      try {
        const result = await window.api.workspaces.fetchTasks(workspacePath);
        if (!cancelled && result.ok) {
          setWorkspaceTasks(result.data);
        }
      } catch (err) {
        console.warn("[useWorkspaceStatus] fetchTasks error:", err);
      }
    }

    fetchWorkspaceTasks();
    return () => {
      cancelled = true;
    };
  }, [workspacePath, isActiveWorkspace]);

  // Read liveness from the shared store reactively so derived status updates
  // when the poller writes new values.
  const liveness = useTmuxLivenessStore((s) => s.liveness);

  // Cache lives in a ref — no state update on write, no callback churn.
  // Shape: tmuxSessionName → { alive, checkedAt }
  const tmuxAliveCacheRef = useRef<
    Map<string, { alive: boolean; checkedAt: number }>
  >(new Map());

  // Track ongoing checks to avoid concurrent duplicate IPC calls for the same session.
  const inFlightRef = useRef<Set<string>>(new Set());

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset cache and shared liveness store when workspace changes
  useEffect(() => {
    tmuxAliveCacheRef.current = new Map();
    inFlightRef.current = new Set();
    useTmuxLivenessStore.getState().clearAll();
  }, [workspacePath]);

  const checkTmuxSessions = useCallback(async (): Promise<void> => {
    const relevantTasks = tasks.filter(
      (t) =>
        t.status === "doing" || t.status === "backlog" || t.status === "review",
    );
    const cache = tmuxAliveCacheRef.current;
    const inFlight = inFlightRef.current;
    const now = Date.now();

    const checks: Promise<void>[] = [];

    for (const task of relevantTasks) {
      for (const [mode, tmuxSession] of [
        ["plan" as PlanMode, task.terminalPlanSession],
        ["execute" as PlanMode, task.terminalExecSession],
      ] as [PlanMode, string | null][]) {
        if (!tmuxSession) continue;

        const livenessKey = `${workspacePath}:${mode}:${task.id}`;

        // Skip if entry is fresh (within TTL) - but if we need to force a check, skip cache
        const cached = cache.get(tmuxSession);
        if (
          cached &&
          cached.checkedAt > 0 &&
          now - cached.checkedAt < LIVENESS_TTL_MS
        )
          continue;

        // Skip if a check is already in-flight for this session
        if (inFlight.has(tmuxSession)) continue;

        inFlight.add(tmuxSession);

        // Terminal sessions use taskterm:isalive and taskterm:state
        checks.push(
          window.api.taskterm
            .isAlive(tmuxSession)
            .then((alive) => {
              cache.set(tmuxSession, { alive, checkedAt: Date.now() });
              useTmuxLivenessStore.getState().setLiveness(livenessKey, alive);
            })
            .then(() =>
              window.api.taskterm.state(
                tmuxSession,
                task.execSessionAgent ?? "opencode",
              ),
            )
            .then((state) => {
              const currentEntry =
                useTmuxLivenessStore.getState().liveness[livenessKey];
              if (currentEntry?.state === "starting") {
                return;
              }
              useTmuxLivenessStore.getState().setAgentState(livenessKey, state);
            })
            .finally(() => {
              inFlight.delete(tmuxSession);
            }),
        );
      }
    }

    if (checks.length > 0) {
      await Promise.all(checks);
    }
  }, [tasks]);
  // NOTE: tmuxAliveCacheRef, inFlightRef, and workspacePath are refs — intentionally omitted
  // from deps to avoid recreating this callback on every cache write.

  // Poll tmux sessions when needed; restart interval only when tasks/sessions change.
  useEffect(() => {
    const timer = setTimeout(() => void checkTmuxSessions(), 0);

    const needsPolling = tasks.some((t) => {
      if (
        t.status !== "doing" &&
        t.status !== "backlog" &&
        t.status !== "review"
      )
        return false;
      return t.terminalPlanSession != null || t.terminalExecSession != null;
    });

    if (needsPolling) {
      pollTimerRef.current = setInterval(() => void checkTmuxSessions(), 1_000);
    }

    return () => {
      clearTimeout(timer);
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [tasks, checkTmuxSessions]);

  // Derive aggregate status and count using the shared liveness store
  let aggregateStatus: WorkspaceStatus = "idle";
  let aggregateCount = 0;

  const relevantTasks = tasks.filter(
    (t) =>
      t.status === "doing" || t.status === "backlog" || t.status === "review",
  );

  // Single pass to compute both status and count
  for (const task of relevantTasks) {
    let taskStatus: WorkspaceStatus = "idle";

    for (const [mode, tmuxSession] of [
      ["plan" as PlanMode, task.terminalPlanSession],
      ["execute" as PlanMode, task.terminalExecSession],
    ] as [PlanMode, string | null][]) {
      if (!tmuxSession) continue;
      const livenessKey = `${workspacePath}:${mode}:${task.id}`;
      const entry = liveness[livenessKey];
      const isAlive = entry?.alive ?? false;
      const agentState = entry?.state;

      let status: WorkspaceStatus = "idle";
      if (agentState === "waiting") {
        status = "waiting";
      } else if (isAlive) {
        status = "running";
      }
      taskStatus = higherPriority(taskStatus, status);
    }

    if (taskStatus !== "idle") {
      aggregateStatus = higherPriority(aggregateStatus, taskStatus);
    }

    // Count tasks matching aggregate status in the same pass
    if (taskStatus === aggregateStatus) {
      aggregateCount++;
    }
  }

  // Suppress unused-variable warning — liveness is read to keep this component
  // subscribed so it re-renders when the shared store updates.
  void liveness;

  return { status: aggregateStatus, count: aggregateCount };
}
