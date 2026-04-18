import { create } from "zustand";
import type { WorkspaceInfo, PlanAgent } from "../../../shared/types";
import { useDataStore } from "./useDataStore";
import { useNavStore } from "./useNavStore";
import { useBoardStore } from "./useBoardStore";
import { useTerminalStore } from "./useTerminalStore";

export type DetailTab = "edit" | "agent" | "changes" | "debug";

interface TaskDetailState {
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
  containerEnabled?: boolean;
  containerRuntime?: "docker" | "podman";
  containerDefaultImage?: string;
}

interface WorkspaceState {
  workspaces: WorkspaceInfo[];
  activeWorkspacePath: string | null;
  loading: boolean;
  error: string | null;
  workspaceDefaults: Record<string, WorkspaceDefaults>;
  hiddenWorkspaces: Set<string>;
  workspaceBoardStates: Record<string, TaskDetailState>;
  workspaceTerminalStates: Record<string, TerminalState>;

  // Actions
  fetchWorkspaces: () => Promise<void>;
  addWorkspace: () => Promise<void>;
  removeWorkspace: (path: string) => Promise<void>;
  setActiveWorkspace: (path: string) => Promise<void>;
  saveCurrentBoardState: () => void;
  restoreBoardState: (
    workspacePath: string,
    tasks: { id: string }[],
    skipInitialValidation?: boolean,
  ) => void;
  saveCurrentTerminalState: () => void;
  restoreTerminalState: (workspacePath: string) => void;
  updateBoardTab: (tab: DetailTab) => void;
  updateScrollPosition: (position: number) => void;
  updateBranch: (path: string, branch: string) => void;
  fetchDefaults: (path: string) => Promise<void>;
  updateDefaults: (path: string, defaults: WorkspaceDefaults) => Promise<void>;
  toggleWorkspaceHidden: (path: string) => Promise<void>;
  fetchHiddenWorkspaces: () => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  workspaces: [],
  activeWorkspacePath: null,
  loading: false,
  error: null,
  workspaceDefaults: {},
  hiddenWorkspaces: new Set<string>(),
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

      // Load hidden state for each workspace
      for (const ws of listResult.data) {
        const result = await window.api.workspaces.getHidden(ws.path);
        if (result.ok && result.data) {
          set((state) => ({
            hiddenWorkspaces: new Set([...state.hiddenWorkspaces, ws.path]),
          }));
        }
      }
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
              ?.taskDetailTab ?? "agent") as DetailTab,
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

  restoreBoardState: (
    workspacePath: string,
    tasks: { id: string }[],
    skipInitialValidation?: boolean,
  ) => {
    const state = get();

    // When skipInitialValidation is true, don't validate/clear the selected task
    // This is used on workspace switch where user just clicked a task - leave it be
    if (skipInitialValidation) {
      return;
    }

    const saved = state.workspaceBoardStates[workspacePath];
    if (!saved) return;

    if (
      saved.selectedTaskId &&
      tasks.some((t) => t.id === saved.selectedTaskId)
    ) {
      useDataStore.getState().setSelectedTask(saved.selectedTaskId);
    } else if (saved.selectedTaskId) {
      useDataStore.getState().setSelectedTask(null);
      useNavStore.getState().setActiveView("home");
    }
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
            taskDetailTab: "agent" as DetailTab,
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
        workspaces: state.workspaces.map((ws) =>
          ws.path === path
            ? {
                ...ws,
                ...defaults,
              }
            : ws,
        ),
      }));
    }
  },

  isWorkspaceVisible: (path: string): boolean => {
    return !get().hiddenWorkspaces.has(path);
  },

  getVisibleWorkspaces: (): WorkspaceInfo[] => {
    const state = get();
    return state.workspaces.filter(
      (ws) => !state.hiddenWorkspaces.has(ws.path),
    );
  },

  isWorkspaceHidden: (path: string): boolean => {
    return get().hiddenWorkspaces.has(path);
  },

  toggleWorkspaceHidden: async (path: string) => {
    const isHidden = get().hiddenWorkspaces.has(path);
    const result = await window.api.workspaces.setHidden(path, !isHidden);
    if (result.ok) {
      set((state) => {
        const newSet = new Set(state.hiddenWorkspaces);
        if (isHidden) {
          newSet.delete(path);
        } else {
          newSet.add(path);
        }
        return { hiddenWorkspaces: newSet };
      });
    }
  },

  fetchHiddenWorkspaces: async () => {
    const state = get();
    for (const ws of state.workspaces) {
      const result = await window.api.workspaces.getHidden(ws.path);
      if (result.ok && result.data) {
        set((state) => ({
          hiddenWorkspaces: new Set([...state.hiddenWorkspaces, ws.path]),
        }));
      }
    }
  },
}));
