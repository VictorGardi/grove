import { create } from "zustand";
import type { TaskInfo, PlanAgent } from "@shared/types";

export interface LaunchConfig {
  agent: PlanAgent;
  model: string | null;
  useWorktree: boolean;
}

interface LaunchModalState {
  open: boolean;
  task: TaskInfo | null;
  /** Internal resolver — called by execute() / cancel() */
  _resolve: ((value: LaunchConfig | null) => void) | null;

  /**
   * Show the launch modal for the given task. Returns a Promise:
   * - LaunchConfig if user clicks Execute
   * - null if user clicks Cancel
   */
  show: (task: TaskInfo) => Promise<LaunchConfig | null>;
  execute: (config: LaunchConfig) => void;
  cancel: () => void;
}

export const useLaunchModalStore = create<LaunchModalState>()((set, get) => ({
  open: false,
  task: null,
  _resolve: null,

  show: (task) =>
    new Promise<LaunchConfig | null>((resolve) => {
      set({ open: true, task, _resolve: resolve });
    }),

  execute: (config) => {
    const { _resolve } = get();
    set({ open: false, task: null, _resolve: null });
    _resolve?.(config);
  },

  cancel: () => {
    const { _resolve } = get();
    set({ open: false, task: null, _resolve: null });
    _resolve?.(null);
  },
}));
