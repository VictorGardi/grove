import { create } from "zustand";
import type { TaskInfo } from "@shared/types";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { useDataStore } from "./useDataStore";
import { useTmuxLivenessStore } from "./useTmuxLivenessStore";
import { useNavStore } from "./useNavStore";
import { enrichTaskWithWorkspace, type EnrichedTask } from "./taskEnrichment";
import { useDataStore as useDataStoreRef } from "./useDataStore";

interface TaskSwitcherState {
  isOpen: boolean;
  searchQuery: string;
  recentTaskIds: string[];
  lastTaskId: string | null;
  taskLastViewedAt: Record<string, number>;
  selectedIndex: number;
  includeDoneTasks: boolean;
  createWorkspaceIndex: number;

  open: () => void;
  close: () => void;
  toggle: () => void;
  setSearchQuery: (query: string) => void;
  setSelectedIndex: (index: number) => void;
  moveSelection: (delta: number, max: number) => void;
  recordTaskView: (taskId: string) => void;
  toggleLastTask: (
    workspaces: { path: string; name: string }[],
    allTasksMap: Map<string, TaskInfo[]>,
  ) => string | null;
  removeFromRecent: (taskId: string) => void;
  toggleIncludeDoneTasks: () => void;
  cycleCreateWorkspace: (delta: number, total: number) => void;
  getSortedTasks: (
    workspaces: { path: string; name: string }[],
    allTasksMap: Map<string, TaskInfo[]>,
  ) => SortedTask[];
}

export interface SortedTask extends EnrichedTask {
  task: TaskInfo;
  sortScore: number;
  recentGroup: "recent" | "active" | "other";
  groupSort: number;
}

const MAX_RECENT = 10;

export const useTaskSwitcherStore = create<TaskSwitcherState>()((set, get) => ({
  isOpen: false,
  searchQuery: "",
  recentTaskIds: [],
  lastTaskId: null,
  taskLastViewedAt: {},
  selectedIndex: 0,
  includeDoneTasks: false,
  createWorkspaceIndex: 0,

  open: () =>
    set({
      isOpen: true,
      selectedIndex: 0,
      createWorkspaceIndex: 0,
      includeDoneTasks: false,
    }),
  close: () => set({ isOpen: false, searchQuery: "" }),
  toggle: () =>
    set((state) => ({
      isOpen: !state.isOpen,
      selectedIndex: 0,
      createWorkspaceIndex: 0,
      includeDoneTasks: state.isOpen ? state.includeDoneTasks : false,
    })),
  setSearchQuery: (query) =>
    set({ searchQuery: query, selectedIndex: 0, createWorkspaceIndex: 0 }),
  setSelectedIndex: (index) => set({ selectedIndex: index }),
  moveSelection: (delta, max) =>
    set((state) => {
      if (max === 0) return { selectedIndex: 0 };
      let newIndex = state.selectedIndex + delta;
      if (newIndex < 0) newIndex = max - 1;
      if (newIndex >= max) newIndex = 0;
      return { selectedIndex: newIndex };
    }),

  recordTaskView: (taskId) => {
    set((state) => {
      const newRecent = [
        taskId,
        ...state.recentTaskIds.filter((id) => id !== taskId),
      ].slice(0, MAX_RECENT);
      return {
        recentTaskIds: newRecent,
        lastTaskId: state.lastTaskId === taskId ? state.lastTaskId : taskId,
        taskLastViewedAt: { ...state.taskLastViewedAt, [taskId]: Date.now() },
      };
    });
  },

  toggleLastTask: (workspaces, allTasksMap) => {
    const state = get();
    const prevTaskId = state.recentTaskIds.find(
      (id) => id !== state.lastTaskId,
    );
    if (!prevTaskId) return null;

    for (const ws of workspaces) {
      const tasks = allTasksMap.get(ws.path) || [];
      const found = tasks.find((t) => t.id === prevTaskId);
      if (found) {
        set({
          lastTaskId: state.lastTaskId,
          recentTaskIds: [
            state.lastTaskId!,
            ...state.recentTaskIds.filter((id) => id !== state.lastTaskId),
          ].slice(0, MAX_RECENT),
        });
        return prevTaskId;
      }
    }

    const newRecent = state.recentTaskIds.filter((id) => id !== prevTaskId);
    set({ recentTaskIds: newRecent });
    return null;
  },

  removeFromRecent: (taskId) =>
    set((state) => ({
      recentTaskIds: state.recentTaskIds.filter((id) => id !== taskId),
    })),

  toggleIncludeDoneTasks: () =>
    set((state) => ({
      includeDoneTasks: !state.includeDoneTasks,
      selectedIndex: 0,
    })),

  cycleCreateWorkspace: (delta, total) =>
    set((state) => {
      if (total === 0) return { createWorkspaceIndex: 0 };
      let newIndex = state.createWorkspaceIndex + delta;
      if (newIndex < 0) newIndex = total - 1;
      if (newIndex >= total) newIndex = 0;
      return { createWorkspaceIndex: newIndex };
    }),

  getSortedTasks: (workspaces, allTasksMap) => {
    const state = get();
    const liveness = useTmuxLivenessStore.getState().liveness;
    const currentTaskId = useDataStoreRef.getState().selectedTaskId;
    const tasksWithWs: SortedTask[] = [];
    const seen = new Set<string>();

    for (const ws of workspaces) {
      const tasks = allTasksMap.get(ws.path) || [];
      for (const task of tasks) {
        const dedupeKey = `${ws.path}:${task.id}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        if (task.status === "done" && !state.includeDoneTasks) {
          continue;
        }

        const lastViewedAt = state.taskLastViewedAt[task.id] || 0;

        const enriched = enrichTaskWithWorkspace(
          task,
          ws.path,
          ws.name,
          liveness,
          lastViewedAt,
        );

        const isAgentActive =
          enriched.execAgentState === "active" ||
          enriched.planAgentState === "active";
        const isWaitingForInput = enriched.isRunning && !isAgentActive;

        const tier = enriched.isRunning ? 3 : lastViewedAt > 0 ? 2 : 0;

        const priorityBonus = isWaitingForInput
          ? 500_000_000
          : isAgentActive
            ? 0
            : 0;

        const secondaryScore =
          lastViewedAt > 0
            ? lastViewedAt
            : task.created
              ? new Date(task.created).getTime()
              : 0;
        const sortScore =
          tier * 1_000_000_000_000_000 + priorityBonus + secondaryScore;

        tasksWithWs.push({
          ...enriched,
          task,
          sortScore,
          recentGroup: enriched.isRunning
            ? "active"
            : lastViewedAt > 0
              ? "recent"
              : "other",
          groupSort: enriched.isRunning ? 1 : lastViewedAt > 0 ? 2 : 0,
        });
      }
    }

    const query = state.searchQuery.toLowerCase();
    let filtered = tasksWithWs;
    if (query) {
      filtered = tasksWithWs.filter(
        (t) =>
          t.task.title.toLowerCase().includes(query) ||
          t.task.id.toLowerCase().includes(query) ||
          t.workspaceName.toLowerCase().includes(query),
      );
    } else {
      filtered = filtered.filter(
        (t) =>
          t.task.status !== "done" &&
          (t.isRunning || (state.taskLastViewedAt[t.task.id] || 0) > 0),
      );
    }

    const others = filtered.filter((t) => t.task.id !== currentTaskId);
    const current = filtered.filter((t) => t.task.id === currentTaskId);

    const sorted = others.sort((a, b) => {
      if (a.groupSort !== b.groupSort) {
        return b.groupSort - a.groupSort;
      }
      return b.sortScore - a.sortScore;
    });
    return [...sorted, ...current];
  },
}));

export async function switchToTask(
  sortedTask: SortedTask,
): Promise<{ success: boolean; error?: string }> {
  const { recordTaskView } = useTaskSwitcherStore.getState();
  const workspaceStore = useWorkspaceStore.getState();
  const dataStore = useDataStore.getState();

  const activeWs = workspaceStore.activeWorkspacePath;

  if (sortedTask.workspacePath !== activeWs) {
    const exists = workspaceStore.workspaces.some(
      (ws) => ws.path === sortedTask.workspacePath,
    );
    if (!exists) {
      return { success: false, error: "Workspace no longer exists" };
    }

    const cachedTasks = dataStore.getCachedTasks(sortedTask.workspacePath);

    try {
      await workspaceStore.setActiveWorkspace(sortedTask.workspacePath);

      if (cachedTasks) {
        dataStore.setTasks(cachedTasks);
      } else {
        const result = await window.api.data.fetch(sortedTask.workspacePath);
        if (result.ok && result.data) {
          dataStore.setTasks(result.data.tasks);
        }
      }
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to switch workspace",
      };
    }
  }

  recordTaskView(sortedTask.task.id);
  dataStore.setSelectedTask(
    sortedTask.task.id,
    sortedTask.task.filePath,
    sortedTask.workspacePath,
  );
  useNavStore.getState().setActiveView("task");

  return { success: true };
}
