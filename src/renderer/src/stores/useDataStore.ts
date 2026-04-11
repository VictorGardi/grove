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

  fetchData: () => void;
  // Immediately patch a single task in the store after a confirmed write,
  // avoiding the chokidar round-trip (~350ms) for user-initiated changes.
  patchTask: (updated: TaskInfo) => void;
  setTasks: (tasks: TaskInfo[]) => void;
  setSelectedTask: (id: string | null, filePathOverride?: string) => void;
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

  setTasks: (tasks) => set({ tasks }),

  setSelectedTask: (id, filePathOverride?: string) => {
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

    console.log(
      "[DataStore] setSelectedTask ENTRY, current selectedTaskId:",
      get().selectedTaskId,
    );
    console.log("[DataStore] setSelectedTask state set, id:", id);
    const workspacePath = useWorkspaceStore.getState().activeWorkspacePath;
    const task = filePathOverride
      ? undefined
      : get().tasks.find((t) => t.id === id);
    const filePath = filePathOverride ?? task?.filePath;
    console.log("[DataStore] setSelectedTask:", {
      id,
      workspacePath,
      filePath,
      taskFound: !!task,
    });
    if (!workspacePath || !filePath) {
      set({ taskDetailLoading: false });
      return;
    }

    window.api.tasks
      .readBody(workspacePath, filePath)
      .then((result) => {
        // Only update if this task is still selected
        const currentId = get().selectedTaskId;
        console.log(
          "[DataStore] body fetch resolved, currentId:",
          currentId,
          "expecting:",
          id,
        );
        if (currentId !== id) {
          console.log("[DataStore] SKIPPING - task changed!");
          return;
        }
        if (result.ok) {
          console.log("[DataStore] body fetched OK, len:", result.data.length);
          set({ selectedTaskBody: result.data, taskDetailLoading: false });
        } else {
          console.error("[DataStore] Failed to read task body:", result.error);
          set({ selectedTaskBody: null, taskDetailLoading: false });
        }
      })
      .catch((err) => {
        console.error("[DataStore] body fetch exception:", err);
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
    });
  },
}));

/** Derived selector: get the currently selected task object */
export const useSelectedTask = (): TaskInfo | null =>
  useDataStore((s) => s.tasks.find((t) => t.id === s.selectedTaskId) ?? null);
