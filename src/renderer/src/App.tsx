import { useEffect, useRef, useState } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary/ErrorBoundary";
import { TitleBar } from "./components/TitleBar/TitleBar";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { MainArea } from "./components/MainArea/MainArea";
import { TerminalPanel } from "./components/Terminal/TerminalPanel";
import { Toast } from "./components/shared/Toast";
import { ConfirmDialog } from "./components/shared/ConfirmDialog";
import { LaunchModal } from "./components/shared/LaunchModal";
import { useWorkspaceStore } from "./stores/useWorkspaceStore";
import { useDataStore } from "./stores/useDataStore";
import { useFileStore } from "./stores/useFileStore";
import { useNavStore } from "./stores/useNavStore";
import { useWorktreeStore } from "./stores/useWorktreeStore";
import { useTerminalStore } from "./stores/useTerminalStore";
import { usePlanStore } from "./stores/usePlanStore";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";

function AppContent(): React.JSX.Element {
  useKeyboardShortcuts();

  const [platform, setPlatform] = useState<NodeJS.Platform | null>(null);
  const restoredWorkspaces = useRef(new Set<string>());
  const fetchWorkspaces = useWorkspaceStore((s) => s.fetchWorkspaces);
  const activeWorkspacePath = useWorkspaceStore((s) => s.activeWorkspacePath);
  const updateBranch = useWorkspaceStore((s) => s.updateBranch);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const fetchData = useDataStore((s) => s.fetchData);
  const clearData = useDataStore((s) => s.clear);
  const fetched = useDataStore((s) => s.fetched);
  const sidebarVisible = useNavStore((s) => s.sidebarVisible);
  const terminalPanelOpen = useNavStore((s) => s.terminalPanelOpen);

  useEffect(() => {
    // Get platform for titlebar padding
    window.api.app.getPlatform().then(setPlatform);

    // Initial workspace load
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  // Set up branch change listener
  useEffect(() => {
    const unsubscribe = window.api.workspaces.onBranchChanged((data) => {
      updateBranch(data.path, data.branch);
    });
    return unsubscribe;
  }, [updateBranch]);

  // Clear stale data immediately on workspace switch, then fetch fresh
  useEffect(() => {
    clearData();
    useFileStore.getState().clear();
    useWorktreeStore.getState().clear();
    if (activeWorkspacePath) {
      fetchData();
    }
  }, [activeWorkspacePath, clearData, fetchData]);

  // Session restoration: when tasks load for a workspace, auto-create terminal tabs
  // for any doing tasks with worktrees that don't already have terminal tabs
  const tasks = useDataStore((s) => s.tasks);
  useEffect(() => {
    if (!activeWorkspacePath || tasks.length === 0) return;
    if (restoredWorkspaces.current.has(activeWorkspacePath)) return;
    restoredWorkspaces.current.add(activeWorkspacePath);

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
    const unsub = window.api.data.onChanged(() => {
      fetchData(); // debounced in store — safe to call rapidly
    });
    return unsub;
  }, [fetchData]);

  // File tree structural changes (files added/removed on disk)
  useEffect(() => {
    const unsub = window.api.fs.onTreeChanged(() => {
      useFileStore.getState().fetchTree();
    });
    return unsub;
  }, []);

  // Open file content changes (agent modified a file)
  useEffect(() => {
    const unsub = window.api.fs.onFileChanged(() => {
      useFileStore.getState().reloadOpenFile();
    });
    return unsub;
  }, []);

  // Plan chat: route streamed chunks from the main process to the plan store
  useEffect(() => {
    const unsub = window.api.plan.onChunk((taskId, mode, chunk) => {
      const sessionKey = `${mode}:${taskId}`;
      const store = usePlanStore.getState();

      if (chunk.type === "session_id") {
        store.setSessionId(sessionKey, chunk.content);
        // Persist session ID to task frontmatter
        const task = useDataStore.getState().tasks.find((t) => t.id === taskId);
        const wp = useWorkspaceStore.getState().activeWorkspacePath;
        if (task && wp) {
          const session = store.sessions[sessionKey];
          const agent = session?.agent ?? "opencode";
          const model = session?.model ?? null;
          window.api.plan.saveSession({
            workspacePath: wp,
            filePath: task.filePath,
            sessionId: chunk.content,
            agent,
            model,
            mode,
          });
        }
        return;
      }

      // user_message chunk: emitted during log replay from the first line of the
      // log file. Only add the bubble if the store has no messages yet — a fresh
      // run already added the user message via handleSend before this chunk lands.
      if (chunk.type === "user_message") {
        const session = store.sessions[sessionKey];
        if ((session?.messages?.length ?? 0) === 0) {
          store.appendUserMessage(sessionKey, chunk.content);
        }
        return;
      }

      // For content chunks (text / thinking / done / error), ensure an agent
      // bubble exists before applying. During log replay the bubble is NOT
      // pre-created by the reconnect effect (that call was removed); instead we
      // lazily create it here the moment the first content chunk arrives.
      if (
        chunk.type === "text" ||
        chunk.type === "thinking" ||
        chunk.type === "done" ||
        chunk.type === "error"
      ) {
        const session = store.sessions[sessionKey];
        const lastMsg = session?.messages[session.messages.length - 1];
        if (!lastMsg || lastMsg.role !== "agent") {
          store.startAgentMessage(sessionKey);
        }
      }

      store.applyChunk(sessionKey, chunk);
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
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {sidebarVisible && <Sidebar />}
        <MainArea />
      </div>
      <TerminalPanel visible={terminalPanelOpen} />
      <Toast />
      <ConfirmDialog />
      <LaunchModal />
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
