import type { TaskInfo } from "@shared/types";
import type { LivenessEntry } from "./useTmuxLivenessStore";

export interface EnrichedTaskBase {
  workspacePath: string;
  workspaceName: string;
  isRunning: boolean;
  execTmuxAlive: boolean;
  planTmuxAlive: boolean;
  execAgentState: string | null;
  planAgentState: string | null;
  lastViewedAt: number;
}

export type EnrichedTask = EnrichedTaskBase & TaskInfo;

export function enrichTaskWithWorkspace(
  task: TaskInfo,
  workspacePath: string,
  workspaceName: string,
  liveness: Record<string, LivenessEntry>,
  lastViewedAt: number = 0,
): EnrichedTask {
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
  const execAgentState = liveness[`${workspacePath}:execute:${task.id}`]?.state;
  const planAgentState = liveness[`${workspacePath}:plan:${task.id}`]?.state;

  return {
    ...task,
    workspacePath,
    workspaceName,
    isRunning: isActiveTmux,
    execTmuxAlive: execAlive,
    planTmuxAlive: planAlive,
    execAgentState: execAgentState ?? null,
    planAgentState: planAgentState ?? null,
    lastViewedAt,
  };
}
