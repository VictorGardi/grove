import { useEffect, useState } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary/ErrorBoundary";
import { TitleBar } from "./components/TitleBar/TitleBar";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { MainArea } from "./components/MainArea/MainArea";
import { TerminalPanel } from "./components/Terminal/TerminalPanel";
import { ConfirmDialog } from "./components/shared/ConfirmDialog";
import { LaunchModal } from "./components/shared/LaunchModal";
import { useWorkspaceStore } from "./stores/useWorkspaceStore";
import { useDataStore } from "./stores/useDataStore";
import { useAllTasksStore } from "./stores/useAllTasksStore";
import { useFileStore } from "./stores/useFileStore";
import { useNavStore } from "./stores/useNavStore";
import { useWorktreeStore } from "./stores/useWorktreeStore";
import { useTerminalStore } from "./stores/useTerminalStore";
import { usePlanStore } from "./stores/usePlanStore";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { ShortcutsModal } from "./components/shared/ShortcutsModal";
import { TaskSwitcherModal } from "./components/shared/TaskSwitcherModal";
import { HelpButton } from "./components/shared/HelpButton";
import { useTmuxLivenessStore } from "./stores/useTmuxLivenessStore";

function AppContent(): React.JSX.Element {
  useKeyboardShortcuts();

  const [platform, setPlatform] = useState<NodeJS.Platform | null>(null);
  const fetchWorkspaces = useWorkspaceStore((s) => s.fetchWorkspaces);
  const activeWorkspacePath = useWorkspaceStore((s) => s.activeWorkspacePath);
  const updateBranch = useWorkspaceStore((s) => s.updateBranch);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const fetchData = useDataStore((s) => s.fetchData);
  const clearData = useDataStore((s) => s.clear);
  const tasks = useDataStore((s) => s.tasks);
  const fetchTasksForWorkspace = useAllTasksStore(
    (s) => s.fetchTasksForWorkspace,
  );
  const allTasks = useAllTasksStore((s) => s.allTasks);
  const fetched = useDataStore((s) => s.fetched);
  const sidebarVisible = useNavStore((s) => s.sidebarVisible);
  const terminalPanelOpen = useNavStore((s) => s.terminalPanelOpen);

  useEffect(() => {
    // Get platform for titlebar padding
    window.api.app.getPlatform().then(setPlatform);

    // Initial workspace load
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  // Fetch all tasks for all workspaces (used by task switcher)
  useEffect(() => {
    for (const ws of workspaces) {
      if (!allTasks.has(ws.path)) {
        void fetchTasksForWorkspace(ws.path);
      }
    }
  }, [workspaces, allTasks, fetchTasksForWorkspace]);

  // Live update listener — re-fetch tasks for all workspaces when files change on disk
  useEffect(() => {
    if (!window.api.data) return;
    const unsub = window.api.data.onChanged(async () => {
      for (const ws of workspaces) {
        await fetchTasksForWorkspace(ws.path);
      }
    });
    return unsub;
  }, [workspaces, fetchTasksForWorkspace]);

  // Set up branch change listener
  useEffect(() => {
    if (!window.api.workspaces) return;
    const unsubscribe = window.api.workspaces.onBranchChanged((data) => {
      updateBranch(data.path, data.branch);
    });
    return unsubscribe;
  }, [updateBranch]);

  // Clear stale data immediately on workspace switch, then fetch fresh
  useEffect(() => {
    console.log(
      "[App] workspace changed, clearing. activeWorkspacePath:",
      activeWorkspacePath,
    );
    clearData();
    useFileStore.getState().clear();
    useWorktreeStore.getState().clear();
    if (activeWorkspacePath) {
      fetchData();
      // Pre-fetch workspace defaults so they're available before any task detail
      // panel opens. Without this, the first open of a task sees an empty
      // workspaceDefaults map, causing PlanChat to fall back to "opencode" as the
      // default agent even when the workspace default is "copilot".
      void useWorkspaceStore.getState().fetchDefaults(activeWorkspacePath);
    }
  }, [activeWorkspacePath, clearData, fetchData]);

  // Restore terminal state after workspace switch (not initial load)
  useEffect(() => {
    if (!activeWorkspacePath) return;
    useWorkspaceStore.getState().restoreTerminalState(activeWorkspacePath);
  }, [activeWorkspacePath]);

  // Initial task validation: on first load (Cmd+R), verify the currently
  // selected task still exists. If not, redirect to home to avoid showing
  // "No task selected" page.
  useEffect(() => {
    if (!activeWorkspacePath || tasks.length === 0) return;
    if (!tasks[0].filePath.startsWith(activeWorkspacePath)) return;

    const saved =
      useWorkspaceStore.getState().workspaceBoardStates[activeWorkspacePath];
    if (!saved?.selectedTaskId) return;
    if (!tasks.some((t) => t.id === saved.selectedTaskId)) {
      useDataStore.getState().clearSelectedTask();
      useNavStore.getState().setActiveView("home");
    }
  }, [activeWorkspacePath, tasks]);

  // Session restoration: when tasks load for a workspace, auto-create terminal tabs
  // for any doing tasks with worktrees that don't already have terminal tabs
  useEffect(() => {
    if (!activeWorkspacePath || tasks.length === 0) return;

    const dashboardTasks = tasks.filter(
      (t) =>
        t.status === "doing" || t.status === "backlog" || t.status === "review",
    );
    for (const task of dashboardTasks) {
      // Initialize plan session if it has a terminal session or session ID
      if (task.terminalPlanSession || task.planSessionId) {
        const key = `plan:${task.id}`;
        usePlanStore
          .getState()
          .initSession(
            key,
            task.planSessionAgent ?? "opencode",
            task.planModel,
            task.planSessionId,
            task.planLastExitCode,
          );
        if (!task.planSessionId && task.terminalPlanSession) {
          usePlanStore.getState().setSessionStatus(key, "paused");
        }
      }
      // Initialize exec session if it has a terminal session or session ID
      if (task.terminalExecSession || task.execSessionId) {
        const key = `execute:${task.id}`;
        usePlanStore
          .getState()
          .initSession(
            key,
            task.execSessionAgent ?? "opencode",
            task.execModel,
            task.execSessionId,
            task.execLastExitCode,
          );
        // For terminal sessions without existingSessionId, set status to "paused" so tmux polling activates
        if (!task.execSessionId && task.terminalExecSession) {
          usePlanStore.getState().setSessionStatus(key, "paused");
        }
      }
    }

    const doingWithWorktree = tasks.filter(
      (t) => t.status === "doing" && t.worktree,
    );
    if (doingWithWorktree.length === 0) return;

    const existingTabs = useTerminalStore.getState().tabs;
    let created = 0;

    for (const task of doingWithWorktree) {
      const tabId = `wt-${task.id}`;
      if (existingTabs.some((t) => t.id === tabId)) continue;

      const worktreeAbsPath = activeWorkspacePath + "/" + task.worktree;
      // Create PTY before adding the tab — same pattern as handleDragToDoing
      window.api.pty.create(tabId, worktreeAbsPath).then(() => {
        useTerminalStore.getState().addTab({
          id: tabId,
          label: task.branch ?? task.id,
          workspacePath: activeWorkspacePath,
          worktreePath: worktreeAbsPath,
          taskId: task.id,
        });
      });
      created++;
    }

    // Auto-open terminal panel if any tabs were restored
    if (created > 0 && !useNavStore.getState().terminalPanelOpen) {
      useNavStore.getState().toggleTerminalPanel();
    }
  }, [activeWorkspacePath, tasks]);

  // Ensure a free terminal tab exists when the panel is open and no task tabs were
  // created by session restoration. Declared AFTER session restoration so React runs
  // this effect second in the same batch — meaning we can read the live Zustand state
  // that session restoration already populated and avoid creating a duplicate tab.
  // Gated on `fetched` so it never fires before the first data load completes.
  useEffect(() => {
    if (!terminalPanelOpen || !activeWorkspacePath || !fetched) return;
    const liveTabs = useTerminalStore.getState().tabs;
    const hasTabsForWorkspace = liveTabs.some(
      (t) => t.workspacePath === activeWorkspacePath,
    );
    if (!hasTabsForWorkspace) {
      const id = `free-${Date.now()}`;
      window.api.pty.create(id, activeWorkspacePath).then(() => {
        useTerminalStore.getState().addTab({
          id,
          label: "Terminal",
          workspacePath: activeWorkspacePath,
          worktreePath: null,
          taskId: null,
        });
      });
    }
  }, [terminalPanelOpen, activeWorkspacePath, fetched]);

  // Live update listener — re-fetch when files change on disk
  useEffect(() => {
    if (!window.api.data) return;
    const unsub = window.api.data.onChanged(() => {
      fetchData(); // debounced in store — safe to call rapidly
    });
    return unsub;
  }, [fetchData]);

  // ── Tmux liveness polling: keep the liveness store updated for all tasks
  // across all workspaces so the running/agent indicators show in the sidebar
  // and task switcher even for tasks not currently open in the task detail page.
  useEffect(() => {
    let cancelled = false;

    async function pollLiveness(): Promise<void> {
      if (cancelled) return;
      const allTasksMap = useAllTasksStore.getState().allTasks;
      const checks: Promise<void>[] = [];

      for (const [workspacePath, tasks] of allTasksMap) {
        for (const task of tasks) {
          if (task.status === "done") continue;
          const relevantModes = [
            ["plan", task.terminalPlanSession] as const,
            ["execute", task.terminalExecSession] as const,
          ];
          for (const [mode, session] of relevantModes) {
            if (!session) continue;
            const livenessKey = `${workspacePath}:${mode}:${task.id}`;
            checks.push(
              window.api.taskterm
                .isAlive(session)
                .then((alive) => {
                  if (cancelled) return;
                  useTmuxLivenessStore
                    .getState()
                    .setLiveness(livenessKey, alive);
                })
                .then(() =>
                  window.api.taskterm.state(
                    session,
                    mode === "execute"
                      ? (task.execSessionAgent ?? "opencode")
                      : (task.planSessionAgent ?? "opencode"),
                  ),
                )
                .then((state) => {
                  if (cancelled) return;
                  useTmuxLivenessStore
                    .getState()
                    .setAgentState(livenessKey, state);
                })
                .catch(() => {}),
            );
          }
        }
      }

      await Promise.all(checks);
    }

    // Poll immediately then every 1s
    void pollLiveness();
    const interval = setInterval(() => void pollLiveness(), 1_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // File tree structural changes (files added/removed on disk)
  useEffect(() => {
    if (!window.api.fs) return;
    const unsub = window.api.fs.onTreeChanged(() => {
      useFileStore.getState().fetchTree();
    });
    return unsub;
  }, []);

  // Open file content changes (agent modified a file)
  useEffect(() => {
    if (!window.api.fs) return;
    const unsub = window.api.fs.onFileChanged(() => {
      useFileStore.getState().reloadOpenFile();
    });
    return unsub;
  }, []);

  // Get active workspace name for title bar
  const activeWorkspace = workspaces.find(
    (w) => w.path === activeWorkspacePath,
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--bg-base)",
        overflow: "hidden",
      }}
    >
      <TitleBar platform={platform} workspaceName={activeWorkspace?.name} />
      <div
        style={{
          position: "relative",
          display: "flex",
          flex: 1,
          overflow: "hidden",
          minHeight: 0,
        }}
      >
        {sidebarVisible && <Sidebar />}
        <MainArea />
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 100,
          }}
        >
          <TerminalPanel visible={terminalPanelOpen} />
        </div>
      </div>
      <ConfirmDialog />
      <LaunchModal />
      <ShortcutsModal />
      <TaskSwitcherModal />
      <HelpButton />
    </div>
  );
}

function App(): React.JSX.Element {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

export default App;
