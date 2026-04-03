import { create } from "zustand";
import type { TaskInfo, MilestoneInfo } from "@shared/types";
import { useWorkspaceStore } from "./useWorkspaceStore";

interface DataState {
  tasks: TaskInfo[];
  milestones: MilestoneInfo[];
  loading: boolean;
  fetched: boolean; // true once the first successful fetch for the current workspace completes
  error: string | null;
  milestoneFilter: string | null;
  selectedMilestoneId: string | null;

  // Phase 4: Task detail state
  selectedTaskId: string | null;
  selectedTaskBody: string | null;
  taskDetailLoading: boolean;
  taskDetailDirty: boolean;

  fetchData: () => void;
  // Immediately patch a single task in the store after a confirmed write,
  // avoiding the chokidar round-trip (~350ms) for user-initiated changes.
  patchTask: (updated: TaskInfo) => void;
  setMilestoneFilter: (filter: string | null) => void;
  setSelectedMilestone: (id: string | null) => void;
  setSelectedTask: (id: string | null) => void;
  setTaskDetailDirty: (dirty: boolean) => void;
  clearSelectedTask: () => void;
  clear: () => void;
}

let fetchTimer: ReturnType<typeof setTimeout> | null = null;

export const useDataStore = create<DataState>()((set, get) => ({
  tasks: [],
  milestones: [],
  loading: false,
  fetched: false,
  error: null,
  milestoneFilter: null,
  selectedMilestoneId: null,
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
            milestones: result.data.milestones,
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

  setMilestoneFilter: (filter) => set({ milestoneFilter: filter }),
  setSelectedMilestone: (id) => set({ selectedMilestoneId: id }),

  patchTask: (updated) =>
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === updated.id ? updated : t)),
    })),

  setSelectedTask: (id) => {
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

    // Fetch the full body — use get() fresh, not a stale closure variable
    const workspacePath = useWorkspaceStore.getState().activeWorkspacePath;
    const task = get().tasks.find((t) => t.id === id);
    console.log("[DataStore] setSelectedTask:", {
      id,
      workspacePath,
      filePath: task?.filePath,
      taskFound: !!task,
    });
    if (!workspacePath || !task) {
      set({ taskDetailLoading: false });
      return;
    }

    window.api.tasks
      .readBody(workspacePath, task.filePath)
      .then((result) => {
        // Only update if this task is still selected
        if (get().selectedTaskId !== id) return;
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

  clearSelectedTask: () =>
    set({
      selectedTaskId: null,
      selectedTaskBody: null,
      taskDetailLoading: false,
      taskDetailDirty: false,
    }),

  clear: () =>
    set({
      tasks: [],
      milestones: [],
      loading: false,
      fetched: false,
      error: null,
      milestoneFilter: null,
      selectedMilestoneId: null,
      selectedTaskId: null,
      selectedTaskBody: null,
      taskDetailLoading: false,
      taskDetailDirty: false,
    }),
}));

/** Derived selector: get the currently selected task object */
export const useSelectedTask = (): TaskInfo | null =>
  useDataStore((s) => s.tasks.find((t) => t.id === s.selectedTaskId) ?? null);
