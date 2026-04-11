import { create } from "zustand";
import type { TaskInfo } from "@shared/types";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { useDataStore } from "./useDataStore";
import { useTmuxLivenessStore } from "./useTmuxLivenessStore";
import { useNavStore } from "./useNavStore";

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

export interface SortedTask {
  task: TaskInfo;
  workspacePath: string;
  workspaceName: string;
  isRunning: boolean;
  execTmuxAlive: boolean;
  planTmuxAlive: boolean;
  execAgentState: string | undefined;
  planAgentState: string | undefined;
  lastViewedAt: number;
  sortScore: number;
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

  open: () => set({ isOpen: true, selectedIndex: 0, createWorkspaceIndex: 0 }),
  close: () => set({ isOpen: false, searchQuery: "" }),
  toggle: () =>
    set((state) => ({
      isOpen: !state.isOpen,
      selectedIndex: 0,
      createWorkspaceIndex: 0,
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
    const now = Date.now();
    set((state) => {
      const newRecent = [
        taskId,
        ...state.recentTaskIds.filter((id) => id !== taskId),
      ].slice(0, MAX_RECENT);
      return {
        recentTaskIds: newRecent,
        lastTaskId: state.lastTaskId === taskId ? state.lastTaskId : taskId,
        taskLastViewedAt: { ...state.taskLastViewedAt, [taskId]: now },
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
    const tasksWithWs: SortedTask[] = [];
    const seen = new Set<string>();

    const now = Date.now();
    const HOUR_MS = 60 * 60 * 1000;
    const TWENTY_FOUR_HOURS = 24 * HOUR_MS;

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
        const isAgentActive =
          execAgentState === "active" || planAgentState === "active";
        const isWaitingForInput = isActiveTmux && !isAgentActive;

        const tier = isActiveTmux
          ? 3
          : lastViewedAt > 0 && now - lastViewedAt < TWENTY_FOUR_HOURS
            ? 2
            : lastViewedAt > 0
              ? 1
              : 0;

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
          task,
          workspacePath: ws.path,
          workspaceName: ws.name,
          isRunning: isActiveTmux,
          execTmuxAlive: execAlive,
          planTmuxAlive: planAlive,
          execAgentState: liveness[`execute:${task.id}`]?.state,
          planAgentState: liveness[`plan:${task.id}`]?.state,
          lastViewedAt,
          sortScore,
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
    }

    return filtered.sort((a, b) => b.sortScore - a.sortScore);
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
    try {
      console.log(
        "[switchToTask] Switching to workspace:",
        sortedTask.workspacePath,
      );
      await workspaceStore.setActiveWorkspace(sortedTask.workspacePath);
      console.log("[switchToTask] Workspace switched, fetching tasks...");
      const result = await window.api.data.fetch(sortedTask.workspacePath);
      console.log("[switchToTask] Tasks fetched, ok:", result.ok);
      if (result.ok && result.data) {
        console.log(
          "[switchToTask] Setting tasks, count:",
          result.data.tasks.length,
        );
        dataStore.setTasks(result.data.tasks);
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
  dataStore.setSelectedTask(sortedTask.task.id, sortedTask.task.filePath);
  useNavStore.getState().setActiveView("task");

  return { success: true };
}
