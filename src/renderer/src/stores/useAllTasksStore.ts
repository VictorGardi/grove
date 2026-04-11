import { create } from "zustand";
import type { TaskInfo, TaskStatus } from "@shared/types";
import { useTmuxLivenessStore } from "./useTmuxLivenessStore";

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
      .filter((ws) => !get().allTasks.has(ws.path))
      .map((ws) => get().fetchTasksForWorkspace(ws.path));
    await Promise.all(fetchPromises);
  },

  clear: () => set({ allTasks: new Map(), fetchingTasks: new Map() }),
}));

export interface TaskWithWorkspace extends TaskInfo {
  workspacePath: string;
  workspaceName: string;
  isRunning: boolean;
  execTmuxAlive: boolean;
  planTmuxAlive: boolean;
  execAgentState: string | null;
  planAgentState: string | null;
  lastViewedAt: number;
}

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

      const hasPlanSession = !!task.terminalPlanSession;
      const hasExecSession = !!task.terminalExecSession;

      const planAlive = hasPlanSession
        ? (liveness[`plan:${task.id}`]?.alive ?? false)
        : false;
      const execAlive = hasExecSession
        ? (liveness[`execute:${task.id}`]?.alive ?? false)
        : false;
      const isActiveTmux =
        (hasPlanSession && planAlive) || (hasExecSession && execAlive);
      const execAgentState = liveness[`execute:${task.id}`]?.state;
      const planAgentState = liveness[`plan:${task.id}`]?.state;
      const lastViewedAt = 0; // This would come from task switcher store

      const taskWithWs: TaskWithWorkspace = {
        ...task,
        workspacePath: ws.path,
        workspaceName: ws.name,
        isRunning: isActiveTmux,
        execTmuxAlive: execAlive,
        planTmuxAlive: planAlive,
        execAgentState: execAgentState ?? null,
        planAgentState: planAgentState ?? null,
        lastViewedAt,
      };
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
