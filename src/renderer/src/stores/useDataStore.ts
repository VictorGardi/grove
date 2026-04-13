import { create } from "zustand";
import type { TaskInfo } from "@shared/types";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { useBoardStore } from "./useBoardStore";

interface DataState {
  tasks: TaskInfo[];
  loading: boolean;
  fetched: boolean; // true once the first successful fetch for the current workspace completes
  error: string | null;

  // Phase 4: Task detail state
  selectedTaskId: string | null;
  selectedTaskBody: string | null;
  taskDetailLoading: boolean;
  taskDetailDirty: boolean;

  // Cache for task metadata across workspaces - avoids disk re-fetch on switch
  workspaceTasksCache: Map<string, TaskInfo[]>;

  fetchData: () => void;
  // Immediately patch a single task in the store after a confirmed write,
  // avoiding the chokidar round-trip (~350ms) for user-initiated changes.
  patchTask: (updated: TaskInfo) => void;
  setTasks: (tasks: TaskInfo[]) => void;
  getCachedTasks: (workspacePath: string) => TaskInfo[] | undefined;
  setCachedTasks: (workspacePath: string, tasks: TaskInfo[]) => void;
  setSelectedTask: (
    id: string | null,
    filePathOverride?: string,
    workspacePathOverride?: string,
  ) => void;
  setTaskDetailDirty: (dirty: boolean) => void;
  clearSelectedTask: () => void;
  clear: () => void;
}

let fetchTimer: ReturnType<typeof setTimeout> | null = null;

export const useDataStore = create<DataState>()((set, get) => ({
  tasks: [],
  loading: false,
  fetched: false,
  error: null,
  selectedTaskId: null,
  selectedTaskBody: null,
  taskDetailLoading: false,
  taskDetailDirty: false,
  workspaceTasksCache: new Map(),

  getCachedTasks: (workspacePath: string) => {
    return get().workspaceTasksCache.get(workspacePath);
  },

  setCachedTasks: (workspacePath: string, tasks: TaskInfo[]) => {
    set((state) => {
      const newCache = new Map(state.workspaceTasksCache);
      newCache.set(workspacePath, tasks);
      return { workspaceTasksCache: newCache };
    });
  },

  fetchData: () => {
    // Debounce: wait 200ms before executing. If called again within that
    // window, restart the timer. This coalesces rapid chokidar events.
    // Do NOT set loading=true until the debounce fires — prevents UI flicker.
    if (fetchTimer) clearTimeout(fetchTimer);
    fetchTimer = setTimeout(async () => {
      const workspacePath = useWorkspaceStore.getState().activeWorkspacePath;
      if (!workspacePath) return;
      set({ loading: true });
      try {
        const result = await window.api.data.fetch(workspacePath);
        if (result.ok) {
          const state = get();
          set({
            tasks: result.data.tasks,
            loading: false,
            fetched: true,
            error: null,
          });

          // Re-fetch the selected task body if not dirty (no in-flight edits)
          if (state.selectedTaskId && !state.taskDetailDirty) {
            const task = result.data.tasks.find(
              (t) => t.id === state.selectedTaskId,
            );
            if (task) {
              try {
                const bodyResult = await window.api.tasks.readBody(
                  workspacePath,
                  task.filePath,
                );
                if (bodyResult.ok) {
                  set({ selectedTaskBody: bodyResult.data });
                }
              } catch {
                // Body re-fetch is best-effort
              }
            }
          }
        } else {
          set({ loading: false, error: result.error });
        }
      } catch (err) {
        set({
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, 200);
  },

  patchTask: (updated) =>
    set((state) => {
      const exists = state.tasks.some((t) => t.id === updated.id);
      if (exists) {
        return {
          tasks: state.tasks.map((t) => (t.id === updated.id ? updated : t)),
        };
      }
      return { tasks: [updated, ...state.tasks] };
    }),

  setTasks: (tasks) => {
    const workspacePath = useWorkspaceStore.getState().activeWorkspacePath;
    set((state) => {
      const newCache = new Map(state.workspaceTasksCache);
      if (workspacePath) {
        newCache.set(workspacePath, tasks);
      }
      return { tasks, workspaceTasksCache: newCache };
    });
  },

  setSelectedTask: (
    id,
    filePathOverride?: string,
    workspacePathOverride?: string,
  ) => {
    if (id === null) {
      set({
        selectedTaskId: null,
        selectedTaskBody: null,
        taskDetailLoading: false,
        taskDetailDirty: false,
      });
      return;
    }

    set({
      selectedTaskId: id,
      taskDetailLoading: true,
      taskDetailDirty: false,
    });

    const workspacePath =
      workspacePathOverride ?? useWorkspaceStore.getState().activeWorkspacePath;
    const task = filePathOverride
      ? undefined
      : get().tasks.find((t) => t.id === id);
    const filePath = filePathOverride ?? task?.filePath;
    if (!workspacePath || !filePath) {
      set({ taskDetailLoading: false });
      return;
    }

    window.api.tasks
      .readBody(workspacePath, filePath)
      .then((result) => {
        // Only update if this task is still selected
        const currentId = get().selectedTaskId;
        if (currentId !== id) {
          return;
        }
        if (result.ok) {
          set({ selectedTaskBody: result.data, taskDetailLoading: false });
        } else {
          set({ selectedTaskBody: null, taskDetailLoading: false });
        }
      })
      .catch(() => {
        if (get().selectedTaskId !== id) return;
        set({ taskDetailLoading: false });
      });
  },

  setTaskDetailDirty: (dirty) => set({ taskDetailDirty: dirty }),

  clearSelectedTask: () => {
    useBoardStore.getState().clearFocusedTask();
    set({
      selectedTaskId: null,
      selectedTaskBody: null,
      taskDetailLoading: false,
      taskDetailDirty: false,
    });
  },

  clear: () => {
    useBoardStore.getState().clearFocusedTask();
    set({
      tasks: [],
      loading: false,
      fetched: false,
      error: null,
      selectedTaskId: null,
      selectedTaskBody: null,
      taskDetailLoading: false,
      taskDetailDirty: false,
      workspaceTasksCache: new Map(),
    });
  },
}));

/** Derived selector: get the currently selected task object */
export const useSelectedTask = (): TaskInfo | null =>
  useDataStore((s) => s.tasks.find((t) => t.id === s.selectedTaskId) ?? null);
