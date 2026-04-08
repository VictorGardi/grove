/**
 * Shared per-task, per-mode tmux liveness store.
 *
 * Replaces the two per-card setInterval timers that previously lived inside
 * TaskCard.tsx. A single polling loop (driven by useWorkspaceStatus or a
 * dedicated hook) writes into this store; TaskCard reads from it reactively
 * with fine-grained selectors.
 *
 * Entry shape:
 *   key  = `${mode}:${taskId}`  e.g. "execute:T-42"
 *   value = { alive: boolean; checkedAt: number }
 *
 * TTL: entries older than LIVENESS_TTL_MS are considered stale and will be
 * re-checked by the next polling cycle (see useWorkspaceStatus.ts).
 */

import { create } from "zustand";

export const LIVENESS_TTL_MS = 10_000; // re-check stale entries after 10 s

export interface LivenessEntry {
  alive: boolean;
  checkedAt: number; // Date.now() timestamp of last check
}

interface TmuxLivenessState {
  /** Map of `${mode}:${taskId}` → liveness entry */
  liveness: Record<string, LivenessEntry>;

  /** Write a liveness result for a given task+mode */
  setLiveness: (key: string, alive: boolean) => void;

  /** Remove all entries (e.g. on workspace switch) */
  clearAll: () => void;
}

export const useTmuxLivenessStore = create<TmuxLivenessState>()((set) => ({
  liveness: {},

  setLiveness: (key: string, alive: boolean) =>
    set((s) => ({
      liveness: {
        ...s.liveness,
        [key]: { alive, checkedAt: Date.now() },
      },
    })),

  clearAll: () => set({ liveness: {} }),
}));
