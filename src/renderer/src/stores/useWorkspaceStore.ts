import { create } from "zustand";
import type { WorkspaceInfo, PlanAgent } from "../../../shared/types";
import { useDataStore } from "./useDataStore";
import { useNavStore } from "./useNavStore";
import { useBoardStore } from "./useBoardStore";
import { useTerminalStore } from "./useTerminalStore";

export type DetailTab = "edit" | "plan" | "changes" | "debug";

interface BoardState {
  selectedTaskId: string | null;
  selectedTaskBody: string | null;
  taskDetailTab: DetailTab;
  /** Scroll position for editor/preview sync. Best effort - may not sync
   * perfectly with editor/preview sync logic. */
  scrollPosition: number;
}

interface TerminalState {
  terminalPanelOpen: boolean;
  activeTabId: string | null;
}

interface WorkspaceDefaults {
  defaultPlanningAgent?: PlanAgent;
  defaultPlanningModel?: string;
  defaultExecutionAgent?: PlanAgent;
  defaultExecutionModel?: string;
  planPersona?: string;
  planReviewPersona?: string;
  executePersona?: string;
  executeReviewPersona?: string;
  executeReviewInstructions?: string;
}

interface WorkspaceState {
  workspaces: WorkspaceInfo[];
  activeWorkspacePath: string | null;
  loading: boolean;
  error: string | null;
  workspaceDefaults: Record<string, WorkspaceDefaults>;
  workspaceBoardStates: Record<string, BoardState>;
  workspaceTerminalStates: Record<string, TerminalState>;

  // Actions
  fetchWorkspaces: () => Promise<void>;
  addWorkspace: () => Promise<void>;
  removeWorkspace: (path: string) => Promise<void>;
  setActiveWorkspace: (path: string) => Promise<void>;
  saveCurrentBoardState: () => void;
  restoreBoardState: (workspacePath: string, tasks: { id: string }[]) => void;
  saveCurrentTerminalState: () => void;
  restoreTerminalState: (workspacePath: string) => void;
  updateBoardTab: (tab: DetailTab) => void;
  updateScrollPosition: (position: number) => void;
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
  workspaceBoardStates: {},
  workspaceTerminalStates: {},

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
    const state = get();
    const currentPath = state.activeWorkspacePath;

    if (currentPath && currentPath !== path) {
      const dataState = useDataStore.getState();
      const navState = useNavStore.getState();
      const terminalState = useTerminalStore.getState();

      set({
        workspaceBoardStates: {
          ...state.workspaceBoardStates,
          [currentPath]: {
            selectedTaskId: dataState.selectedTaskId,
            selectedTaskBody: dataState.selectedTaskBody,
            taskDetailTab: (state.workspaceBoardStates[currentPath]
              ?.taskDetailTab ?? "edit") as DetailTab,
            scrollPosition:
              state.workspaceBoardStates[currentPath]?.scrollPosition ?? 0,
          },
        },
        workspaceTerminalStates: {
          ...state.workspaceTerminalStates,
          [currentPath]: {
            terminalPanelOpen: navState.terminalPanelOpen,
            activeTabId: terminalState.activeTabId,
          },
        },
      });
      useBoardStore.getState().clearFocusedTask();
    }

    const result = await window.api.workspaces.setActive(path);
    if (!result.ok) {
      set({ error: result.error });
      return;
    }

    set({ activeWorkspacePath: path });
  },

  saveCurrentBoardState: () => {
    const state = get();
    const currentPath = state.activeWorkspacePath;
    if (!currentPath) return;

    const dataState = useDataStore.getState();
    set({
      workspaceBoardStates: {
        ...state.workspaceBoardStates,
        [currentPath]: {
          selectedTaskId: dataState.selectedTaskId,
          selectedTaskBody: dataState.selectedTaskBody,
          taskDetailTab:
            state.workspaceBoardStates[currentPath]?.taskDetailTab ?? "edit",
          scrollPosition:
            state.workspaceBoardStates[currentPath]?.scrollPosition ?? 0,
        },
      },
    });
  },

  restoreBoardState: (workspacePath: string, tasks: { id: string }[]) => {
    const state = get();
    const saved = state.workspaceBoardStates[workspacePath];
    if (!saved) return;

    if (
      saved.selectedTaskId &&
      tasks.some((t) => t.id === saved.selectedTaskId)
    ) {
      useDataStore.getState().setSelectedTask(saved.selectedTaskId);
    }
    // Don't clear selectedTask if there's no saved state - that means the user
    // just selected a task (e.g., via task switcher) and we shouldn't clobber it
  },

  saveCurrentTerminalState: () => {
    const state = get();
    const currentPath = state.activeWorkspacePath;
    if (!currentPath) return;

    const navState = useNavStore.getState();
    const terminalState = useTerminalStore.getState();
    set({
      workspaceTerminalStates: {
        ...state.workspaceTerminalStates,
        [currentPath]: {
          terminalPanelOpen: navState.terminalPanelOpen,
          activeTabId: terminalState.activeTabId,
        },
      },
    });
  },

  restoreTerminalState: (workspacePath: string) => {
    const state = get();
    const saved = state.workspaceTerminalStates[workspacePath];
    if (!saved) return;

    const navState = useNavStore.getState();
    if (saved.terminalPanelOpen && !navState.terminalPanelOpen) {
      navState.toggleTerminalPanel();
    } else if (!saved.terminalPanelOpen && navState.terminalPanelOpen) {
      navState.toggleTerminalPanel();
    }

    const terminalStore = useTerminalStore.getState();
    if (
      saved.activeTabId &&
      terminalStore.tabs.some((t) => t.id === saved.activeTabId)
    ) {
      terminalStore.setActiveTab(saved.activeTabId);
    }
  },

  updateBoardTab: (tab: DetailTab) => {
    const state = get();
    const currentPath = state.activeWorkspacePath;
    if (!currentPath) return;

    set({
      workspaceBoardStates: {
        ...state.workspaceBoardStates,
        [currentPath]: {
          ...(state.workspaceBoardStates[currentPath] ?? {
            selectedTaskId: null,
            selectedTaskBody: null,
            scrollPosition: 0,
          }),
          taskDetailTab: tab,
        },
      },
    });
  },

  updateScrollPosition: (position: number) => {
    const state = get();
    const currentPath = state.activeWorkspacePath;
    if (!currentPath) return;

    set({
      workspaceBoardStates: {
        ...state.workspaceBoardStates,
        [currentPath]: {
          ...(state.workspaceBoardStates[currentPath] ?? {
            selectedTaskId: null,
            selectedTaskBody: null,
            taskDetailTab: "edit" as DetailTab,
          }),
          scrollPosition: position,
        },
      },
    });
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
