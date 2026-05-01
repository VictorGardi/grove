import { create } from "zustand";
import type { TaskInfo, TaskStatus } from "@shared/types";
import { useTmuxLivenessStore } from "./useTmuxLivenessStore";
import { enrichTaskWithWorkspace, type EnrichedTask } from "./taskEnrichment";

interface AllTasksState {
  allTasks: Map<string, TaskInfo[]>;
  fetchingTasks: Map<string, boolean>;
  fetchTasksForWorkspace: (workspacePath: string) => Promise<void>;
  fetchAllWorkspaceTasks: (
    workspaces: { path: string; name: string }[],
  ) => Promise<void>;
  clear: () => void;
}

export const useAllTasksStore = create<AllTasksState>()((set, get) => ({
  allTasks: new Map(),
  fetchingTasks: new Map(),

  fetchTasksForWorkspace: async (workspacePath: string) => {
    set((state) => {
      const newMap = new Map(state.fetchingTasks);
      newMap.set(workspacePath, true);
      return { fetchingTasks: newMap };
    });
    const result = await window.api.workspaces.fetchTasks(workspacePath);
    set((state) => {
      const newFetchingMap = new Map(state.fetchingTasks);
      newFetchingMap.set(workspacePath, false);
      if (result.ok && result.data) {
        const newAllTasksMap = new Map(state.allTasks);
        newAllTasksMap.set(workspacePath, result.data!);
        return { fetchingTasks: newFetchingMap, allTasks: newAllTasksMap };
      }
      return { fetchingTasks: newFetchingMap };
    });
  },

  fetchAllWorkspaceTasks: async (workspaces) => {
    const fetchPromises = workspaces
      .map((ws) => get().fetchTasksForWorkspace(ws.path));
    await Promise.all(fetchPromises);
  },

  clear: () => set({ allTasks: new Map(), fetchingTasks: new Map() }),
}));

export type TaskWithWorkspace = EnrichedTask;

export function getAllTasksGrouped(
  allTasks: Map<string, TaskInfo[]>,
  workspaces: { path: string; name: string }[],
): Map<string, TaskWithWorkspace[]> {
  const grouped = new Map<string, TaskWithWorkspace[]>();
  const liveness = useTmuxLivenessStore.getState().liveness;

  const statusLabels: Record<TaskStatus, string> = {
    backlog: "Backlog",
    doing: "Doing",
    review: "Review",
    done: "Done",
  };

  for (const ws of workspaces) {
    const tasks = allTasks.get(ws.path) || [];
    for (const task of tasks) {
      const status = task.status as TaskStatus;
      const key = `${ws.name} - ${statusLabels[status]}`;

      const taskWithWs = enrichTaskWithWorkspace(
        task,
        ws.path,
        ws.name,
        liveness,
        0,
      );
      const existing = grouped.get(key) || [];
      existing.push(taskWithWs);
      grouped.set(key, existing);
    }
  }

  const sortedGrouped = new Map<string, TaskWithWorkspace[]>();
  for (const key of grouped.keys()) {
    const sorted = grouped.get(key)!.sort((a, b) => {
      const aDate = a.created ?? "";
      const bDate = b.created ?? "";
      return bDate.localeCompare(aDate);
    });
    sortedGrouped.set(key, sorted);
  }

  return sortedGrouped;
}
