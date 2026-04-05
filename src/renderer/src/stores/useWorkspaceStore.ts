import { create } from "zustand";
import type { WorkspaceInfo } from "../../../shared/types";

interface WorkspaceState {
  workspaces: WorkspaceInfo[];
  activeWorkspacePath: string | null;
  loading: boolean;
  error: string | null;

  // Actions
  fetchWorkspaces: () => Promise<void>;
  addWorkspace: () => Promise<void>;
  removeWorkspace: (path: string) => Promise<void>;
  setActiveWorkspace: (path: string) => Promise<void>;
  updateBranch: (path: string, branch: string) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  workspaces: [],
  activeWorkspacePath: null,
  loading: false,
  error: null,

  fetchWorkspaces: async () => {
    set({ loading: true, error: null });
    try {
      const [listResult, activeResult] = await Promise.all([
        window.api.workspaces.list(),
        window.api.workspaces.getActive(),
      ]);

      if (!listResult.ok) {
        set({ loading: false, error: listResult.error });
        return;
      }

      const activeWorkspacePath = activeResult.ok ? activeResult.data : null;

      set({
        workspaces: listResult.data,
        activeWorkspacePath,
        loading: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: msg });
    }
  },

  addWorkspace: async () => {
    const result = await window.api.workspaces.add();
    if (!result.ok) {
      set({ error: result.error });
      return;
    }
    if (result.data !== null) {
      await get().fetchWorkspaces();
    }
  },

  removeWorkspace: async (path: string) => {
    const result = await window.api.workspaces.remove(path);
    if (!result.ok) {
      set({ error: result.error });
      return;
    }
    await get().fetchWorkspaces();
  },

  setActiveWorkspace: async (path: string) => {
    const result = await window.api.workspaces.setActive(path);
    if (!result.ok) {
      set({ error: result.error });
      return;
    }
    set({ activeWorkspacePath: path });
  },

  updateBranch: (path: string, branch: string) => {
    set((state) => ({
      workspaces: state.workspaces.map((w) =>
        w.path === path ? { ...w, branch } : w,
      ),
    }));
  },
}));
