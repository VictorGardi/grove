import { create } from "zustand";

interface WorktreeState {
  /** Task IDs currently creating a worktree (shows "Creating worktree…" pulse) */
  creatingIds: Set<string>;
  markCreating: (taskId: string) => void;
  markCreated: (taskId: string) => void;
  /** Called on workspace switch to reset transient state */
  clear: () => void;
}

export const useWorktreeStore = create<WorktreeState>()((set) => ({
  creatingIds: new Set(),

  markCreating: (taskId) =>
    set((state) => {
      const next = new Set(state.creatingIds);
      next.add(taskId);
      return { creatingIds: next };
    }),

  markCreated: (taskId) =>
    set((state) => {
      const next = new Set(state.creatingIds);
      next.delete(taskId);
      return { creatingIds: next };
    }),

  clear: () => set({ creatingIds: new Set() }),
}));
