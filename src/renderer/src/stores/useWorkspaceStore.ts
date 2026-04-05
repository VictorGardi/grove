import { create } from "zustand";
import type { WorkspaceInfo, PlanAgent } from "../../../shared/types";

interface WorkspaceDefaults {
  defaultPlanningAgent?: PlanAgent;
  defaultPlanningModel?: string;
  defaultExecutionAgent?: PlanAgent;
  defaultExecutionModel?: string;
}

interface WorkspaceState {
  workspaces: WorkspaceInfo[];
  activeWorkspacePath: string | null;
  loading: boolean;
  error: string | null;
  workspaceDefaults: Record<string, WorkspaceDefaults>;

  // Actions
  fetchWorkspaces: () => Promise<void>;
  addWorkspace: () => Promise<void>;
  removeWorkspace: (path: string) => Promise<void>;
  setActiveWorkspace: (path: string) => Promise<void>;
  updateBranch: (path: string, branch: string) => void;
  fetchDefaults: (path: string) => Promise<void>;
  updateDefaults: (path: string, defaults: WorkspaceDefaults) => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  workspaces: [],
  activeWorkspacePath: null,
  loading: false,
  error: null,
  workspaceDefaults: {},

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

  fetchDefaults: async (path: string) => {
    const result = await window.api.workspaces.getDefaults(path);
    if (result.ok) {
      set((state) => ({
        workspaceDefaults: {
          ...state.workspaceDefaults,
          [path]: result.data,
        },
      }));
    }
  },

  updateDefaults: async (path: string, defaults: WorkspaceDefaults) => {
    const result = await window.api.workspaces.setDefaults(path, defaults);
    if (result.ok) {
      set((state) => ({
        workspaceDefaults: {
          ...state.workspaceDefaults,
          [path]: defaults,
        },
      }));
    }
  },
}));
