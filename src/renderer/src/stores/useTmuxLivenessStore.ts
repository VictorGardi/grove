/**
 * Shared per-task, per-mode tmux liveness and agent state store.
 *
 * Keeps track of interactive terminal session liveness for task cards
 * and terminal indicators.
 *
 * Entry shape:
 *   key  = `${workspacePath}:${mode}:${taskId}`  e.g. "/path:execute:T-42"
 *   value = { alive: boolean; checkedAt: number; state?: AgentState }
 *
 * TTL: entries older than LIVENESS_TTL_MS are considered stale and will be
 * re-checked by the polling cycle (see useWorkspaceStatus.ts).
 */

import { create } from "zustand";

export const LIVENESS_TTL_MS = 10_000; // re-check stale entries after 10 s

export type AgentState =
  | "active"
  | "interrupted"
  | "waiting"
  | "idle"
  | "starting";

export interface LivenessEntry {
  alive: boolean;
  checkedAt: number; // Date.now() timestamp of last check
  state?: AgentState;
}

interface TmuxLivenessState {
  /** Map of `${workspacePath}:${mode}:${taskId}` → liveness entry */
  liveness: Record<string, LivenessEntry>;

  /** Write a liveness result for a given task+mode */
  setLiveness: (key: string, alive: boolean) => void;

  /** Write agent state for a given task+mode */
  setAgentState: (key: string, state: AgentState) => void;

  /** Remove all entries (e.g. on workspace switch) */
  clearAll: () => void;
}

export const useTmuxLivenessStore = create<TmuxLivenessState>()((set) => ({
  liveness: {},

  setLiveness: (key: string, alive: boolean) =>
    set((s) => ({
      liveness: {
        ...s.liveness,
        [key]: { ...s.liveness[key], alive, checkedAt: Date.now() },
      },
    })),

  setAgentState: (key: string, state: AgentState) =>
    set((s) => ({
      liveness: {
        ...s.liveness,
        [key]: { ...s.liveness[key], state, checkedAt: Date.now() },
      },
    })),

  clearAll: () => set({ liveness: {} }),
}));