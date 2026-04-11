import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useDataStore, useSelectedTask } from "../../stores/useDataStore";
import { useWorkspaceStore, DetailTab } from "../../stores/useWorkspaceStore";
import { useNavStore } from "../../stores/useNavStore";
import { useFileStore } from "../../stores/useFileStore";
import { usePlanStore } from "../../stores/usePlanStore";
import { updateTask, archiveTask, moveTask } from "../../actions/taskActions";
import {
  showLaunchModalAndExecute,
  completeTask,
} from "../../actions/executionActions";
import { InlineEdit } from "../shared/InlineEdit";
import { formatTimestamp } from "../../utils/date";
import { TagInput } from "../shared/TagInput";
import { ChangesTab } from "./ChangesTab";
import { TaskTerminal } from "./TaskTerminal";
import type { TaskInfo, TaskStatus } from "@shared/types";
import styles from "./TaskDetailPanel.module.css";

// ── Constants ─────────────────────────────────────────────────────

const DEBOUNCE_MS = 500;

// ── Debug panel ───────────────────────────────────────────────────

function DebugPanel({ task }: { task: TaskInfo }): React.JSX.Element {
  const planSessionKey = `plan:${task.id}`;
  const execSessionKey = `execute:${task.id}`;
  const planStoreSession = usePlanStore((s) => s.sessions[planSessionKey]);
  const execStoreSession = usePlanStore((s) => s.sessions[execSessionKey]);

  const [paneCaptures, setPaneCaptures] = useState<Record<string, string>>({});
  const [capturing, setCapturing] = useState<Record<string, boolean>>({});

  async function handleCapture(session: string): Promise<void> {
    setCapturing((c) => ({ ...c, [session]: true }));
    try {
      const result = await window.api.plan.captureTmuxPane({ session });
      if (result.ok && result.data) {
        setPaneCaptures((p) => ({
          ...p,
          [session]: result.data.content || "(empty pane)",
        }));
      } else {
        setPaneCaptures((p) => ({
          ...p,
          [session]: `Error: ${(result as { ok: false; error: string }).error}`,
        }));
      }
    } finally {
      setCapturing((c) => ({ ...c, [session]: false }));
    }
  }

  type DebugRow = {
    label: string;
    value: string | null | undefined;
    session?: string;
  };
  const rows: DebugRow[] = [
    {
      label: "terminalPlanSession",
      value: task.terminalPlanSession,
      session: task.terminalPlanSession ?? undefined,
    },
    {
      label: "terminalExecSession",
      value: task.terminalExecSession,
      session: task.terminalExecSession ?? undefined,
    },
    { label: "execSessionAgent", value: task.execSessionAgent },
    { label: "execModel", value: task.execModel },
    { label: "planSessionAgent", value: task.planSessionAgent },
    { label: "planModel", value: task.planModel },
    {
      label: "store:plan status",
      value: planStoreSession?.sessionStatus ?? null,
    },
    {
      label: "store:plan msgs",
      value: planStoreSession ? String(planStoreSession.messages.length) : null,
    },
    {
      label: "store:plan isRunning",
      value: planStoreSession ? String(planStoreSession.isRunning) : null,
    },
    {
      label: "store:exec status",
      value: execStoreSession?.sessionStatus ?? null,
    },
    {
      label: "store:exec msgs",
      value: execStoreSession ? String(execStoreSession.messages.length) : null,
    },
    {
      label: "store:exec isRunning",
      value: execStoreSession ? String(execStoreSession.isRunning) : null,
    },
  ];

  const capturedSessions = Object.keys(paneCaptures);

  return (
    <div className={styles.debugPanel}>
      <table className={styles.debugTable}>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td className={styles.debugLabel}>{row.label}</td>
              <td className={styles.debugValue}>
                {row.value != null ? (
                  <span className={styles.debugValueWithAction}>
                    {row.value}
                    {row.session && (
                      <button
                        className={styles.debugCaptureBtn}
                        onClick={() => void handleCapture(row.session!)}
                        disabled={capturing[row.session] ?? false}
                        title="Capture current tmux pane contents"
                      >
                        {capturing[row.session] ? "…" : "capture pane"}
                      </button>
                    )}
                  </span>
                ) : (
                  <span className={styles.debugNull}>null</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {capturedSessions.map((session) => (
        <div key={session} className={styles.debugCaptureBlock}>
          <div className={styles.debugCaptureHeader}>
            <span className={styles.debugCaptureTitle}>{session}</span>
            <button
              className={styles.debugCaptureRefreshBtn}
              onClick={() => void handleCapture(session)}
              disabled={capturing[session] ?? false}
              title="Refresh capture"
            >
              {capturing[session] ? "…" : "↻ refresh"}
            </button>
          </div>
          <pre className={styles.debugCaptureOutput}>
            {paneCaptures[session]}
          </pre>
        </div>
      ))}
    </div>
  );
}

// ── Simple markdown preview ───────────────────────────────────────

function renderMarkdownPreview(md: string): string {
  // Minimal markdown-to-HTML for preview. Handles headings, bold,
  // italic, code blocks, inline code, lists, checkboxes, and paragraphs.
  const html = md
    // Fenced code blocks
    .replace(
      /```(\w*)\n([\s\S]*?)```/g,
      (_m, _lang, code) =>
        `<pre><code>${code.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>`,
    )
    // Headings
    .replace(/^#### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Inline code
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // Checkboxes
    .replace(
      /^- \[x\] (.+)$/gm,
      '<div class="checkbox checked"><input type="checkbox" checked disabled /> <s>$1</s></div>',
    )
    .replace(
      /^- \[ \] (.+)$/gm,
      '<div class="checkbox"><input type="checkbox" disabled /> $1</div>',
    )
    // Unordered lists
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    // Horizontal rules
    .replace(/^---$/gm, "<hr />")
    // Paragraphs (double newlines)
    .replace(/\n\n/g, "</p><p>")
    // Single newlines within paragraphs
    .replace(/\n/g, "<br />");

  return `<p>${html}</p>`;
}

// ── Component ─────────────────────────────────────────────────────

export function TaskDetailPanel(): React.JSX.Element {
  const task = useSelectedTask();
  const clearSelectedTask = useDataStore((s) => s.clearSelectedTask);
  const setActiveView = useNavStore((s) => s.setActiveView);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const workspacePath = useWorkspaceStore((s) => s.activeWorkspacePath);
  const workspaceBoardStates = useWorkspaceStore((s) => s.workspaceBoardStates);
  const updateBoardTab = useWorkspaceStore((s) => s.updateBoardTab);
  const workspaceDefaults =
    useWorkspaceStore((s) =>
      workspacePath ? (s.workspaceDefaults[workspacePath] ?? null) : null,
    ) ?? {};
  const [loading, setLoading] = useState(true);
  console.log("[TaskDetailPanel] render, task:", task?.id, "loading:", loading);
  const activeWorkspaceName = useMemo(() => {
    if (!workspacePath || workspaces.length === 0) return null;
    const active = workspaces.find((w) => w.path === workspacePath);
    return active?.name ?? null;
  }, [workspacePath, workspaces]);

  const activeTab: DetailTab =
    workspacePath && workspaceBoardStates[workspacePath]?.taskDetailTab
      ? workspaceBoardStates[workspacePath].taskDetailTab
      : "edit";

  function setActiveTab(tab: DetailTab): void {
    updateBoardTab(tab);
  }

  // Raw markdown content
  const [rawContent, setRawContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  // Debounce timer
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Scroll sync refs
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const isSyncingRef = useRef(false);

  // Track whether we have unsaved changes
  const isDirty = rawContent !== savedContent;

  // Keep a ref so the external-change listener below can read the latest
  // isDirty without needing to re-subscribe on every keystroke.
  const isDirtyRef = useRef(isDirty);
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  // Memoize the expensive 15-regex markdown preview so it only re-runs when
  // rawContent actually changes, not on every re-render.
  const renderedMarkdownPreview = useMemo(
    () => renderMarkdownPreview(rawContent),
    [rawContent],
  );

  // Default to plan (Agent) tab for all tasks
  // Only set when a task is present to avoid updating state when no task is selected
  useEffect(() => {
    if (!task) return;
    setActiveTab("plan");
  }, [task?.id]);

  // ── Load raw file content ─────────────────────────────────────

  useEffect(() => {
    if (!task || !workspacePath) {
      setRawContent("");
      setSavedContent("");
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);
    console.log("[TaskDetailPanel] calling readRaw:", {
      workspacePath,
      filePath: task.filePath,
    });
    window.api.tasks
      .readRaw(workspacePath, task.filePath)
      .then((result) => {
        console.log("[TaskDetailPanel] readRaw result:", {
          ok: result.ok,
          len: result.ok ? result.data?.length : undefined,
          error: result.ok ? undefined : result.error,
        });
        if (result.ok) {
          setRawContent(result.data);
          setSavedContent(result.data);
        } else {
          setLoadError(result.error ?? "Failed to read file");
        }
        setLoading(false);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[TaskDetailPanel] readRaw threw:", msg);
        setLoadError(msg);
        setLoading(false);
      });
  }, [task?.id, task?.filePath, workspacePath]);

  // ── Cleanup timer ─────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // ── Refresh on external file change ───────────────────────────
  // Re-read the raw file whenever the workspace data changes (e.g. the
  // planning agent writes to the task markdown). Skip the re-read if the
  // user has unsaved edits so we never clobber in-progress work.

  useEffect(() => {
    if (!task || !workspacePath) return;
    const unsub = window.api.data.onChanged(() => {
      if (isDirtyRef.current) return;
      window.api.tasks
        .readRaw(workspacePath, task.filePath)
        .then((result) => {
          if (result.ok) {
            setRawContent(result.data);
            setSavedContent(result.data);
          }
        })
        .catch(() => {
          /* ignore read errors on external changes */
        });
    });
    return unsub;
  }, [task?.id, task?.filePath, workspacePath]);

  // ── Save raw content ──────────────────────────────────────────

  const saveRaw = useCallback(
    (content: string) => {
      if (!task || !workspacePath) return;
      window.api.tasks
        .writeRaw(workspacePath, task.filePath, content)
        .then((result) => {
          if (result.ok) {
            setSavedContent(content);
            useDataStore.getState().patchTask(result.data);
          }
        })
        .catch((err) => {
          console.error("[TaskDetailPanel] save failed:", err);
        });
    },
    [task, workspacePath],
  );

  // ── Handle editor change with debounce ────────────────────────

  function handleEditorChange(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    const value = e.target.value;
    setRawContent(value);

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveRaw(value);
    }, DEBOUNCE_MS);
  }

  // ── Frontmatter field handlers ────────────────────────────────

  function handleTitleSave(title: string): void {
    updateTask(task!.filePath, { title });
  }

  function handleTagsChange(tags: string[]): void {
    updateTask(task!.filePath, { tags });
  }

  // ── Scroll sync ───────────────────────────────────────────────

  function handleEditorScroll(): void {
    if (isSyncingRef.current) return;
    const editor = editorRef.current;
    const preview = previewRef.current;
    if (!editor || !preview) return;
    const scrollable = editor.scrollHeight - editor.clientHeight;
    if (scrollable <= 0) return;
    isSyncingRef.current = true;
    preview.scrollTop =
      (editor.scrollTop / scrollable) *
      (preview.scrollHeight - preview.clientHeight);
    requestAnimationFrame(() => {
      isSyncingRef.current = false;
    });
  }

  function handlePreviewScroll(): void {
    if (isSyncingRef.current) return;
    const editor = editorRef.current;
    const preview = previewRef.current;
    if (!editor || !preview) return;
    const scrollable = preview.scrollHeight - preview.clientHeight;
    if (scrollable <= 0) return;
    isSyncingRef.current = true;
    editor.scrollTop =
      (preview.scrollTop / scrollable) *
      (editor.scrollHeight - editor.clientHeight);
    requestAnimationFrame(() => {
      isSyncingRef.current = false;
    });
  }

  // ── Status change handler ───────────────────────────────────────

  const handleStatusChange = useCallback(
    async (newStatus: TaskStatus) => {
      if (!task || !workspacePath) return;

      if (newStatus === "doing" && task.status !== "doing") {
        if (task.terminalExecSession) return;
        void showLaunchModalAndExecute(task);
      } else if (newStatus === "done") {
        void completeTask(task);
      } else if (newStatus !== task.status) {
        await moveTask(task.filePath, newStatus);
      }
    },
    [task, workspacePath],
  );

  // ── Archive handler ───────────────────────────────────────────

  function handleArchive(): void {
    if (
      window.confirm("Archive this task? It will be moved to .tasks/archive/")
    ) {
      archiveTask(task!.filePath);
    }
  }

  // ── View files handler ────────────────────────────────────────

  function handleViewFiles(): void {
    if (!task || !workspacePath) return;

    let root: import("../../stores/useFileStore").FileRoot;

    if (task.worktree) {
      // Has worktree — resolve absolute path and use filesystem mode
      const absoluteWorktreePath = task.worktree.startsWith("/")
        ? task.worktree
        : `${workspacePath}/${task.worktree}`;
      root = {
        label: task.branch ?? task.worktree,
        path: absoluteWorktreePath,
      };
    } else if (task.branch) {
      // Branch only (no worktree) — use git-based reading
      root = {
        label: task.branch,
        path: workspacePath,
        gitBranch: task.branch,
      };
    } else {
      // No branch or worktree — navigate to repo root
      useFileStore.getState().setSelectedRoot(null);
      useNavStore.getState().setActiveView("files");
      setTimeout(() => useFileStore.getState().fetchTree(), 0);
      clearSelectedTask();
      return;
    }

    useFileStore.getState().setSelectedRoot(root);
    useNavStore.getState().setActiveView("files");
    // Fetch tree after navigation
    setTimeout(() => useFileStore.getState().fetchTree(), 0);
    clearSelectedTask();
  }

  // Close and navigate to home view
  function handleClose(): void {
    clearSelectedTask();
    setActiveView("home");
  }

  // ── Loading / empty state ─────────────────────────────────────

  if (!task) return <></>;

  if (loading) {
    return (
      <div className={styles.loading} style={{ flex: 1 }}>
        Loading...
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        className={styles.loading}
        style={{ flex: 1, color: "var(--status-red)" }}
      >
        {loadError}
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className={styles.page}>
      {/* Top bar: metadata */}
      <div className={styles.topBar}>
        {activeWorkspaceName && (
          <span className={styles.workspaceName}>{activeWorkspaceName}</span>
        )}
        <div className={styles.topBarLeft}>
          <span className={styles.idBadge}>{task.id}</span>
          <select
            className={styles.statusSelect}
            value={task.status}
            onChange={(e) => handleStatusChange(e.target.value as TaskStatus)}
          >
            <option value="backlog">Backlog</option>
            <option value="doing">Doing</option>
            <option value="review">Review</option>
            <option value="done">Done</option>
          </select>

          {/* Tags */}
          <div className={styles.tagsInline}>
            <TagInput
              tags={task.tags || []}
              onChange={handleTagsChange}
              placeholder="Add tag..."
            />
          </div>

          {/* Worktree toggle — backlog and doing */}
          {(task.status === "backlog" || task.status === "doing") && (
            <button
              className={`${styles.worktreeBtn} ${task.useWorktree ? styles.worktreeBtnActive : ""}`}
              onClick={() =>
                updateTask(task.filePath, { useWorktree: !task.useWorktree })
              }
              title={
                task.useWorktree
                  ? "Running in git worktree — click to switch to root repo"
                  : "Running in root repo — click to switch to git worktree"
              }
            >
              {task.useWorktree ? "worktree" : "root repo"}
            </button>
          )}
        </div>

        <div className={styles.topBarRight}>
          {isDirty && <span className={styles.dirtyIndicator}>Unsaved</span>}
          {task.created && (
            <span className={styles.metaCreated}>
              {formatTimestamp(task.created)}
            </span>
          )}
          {/* View files button — always shown */}
          <button className={styles.viewFilesBtn} onClick={handleViewFiles}>
            View files
          </button>
          <button className={styles.archiveBtn} onClick={handleArchive}>
            Archive
          </button>
          <button
            className={styles.closeBtn}
            onClick={handleClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>
      </div>

      {/* Title */}
      <div className={styles.titleBar}>
        <InlineEdit
          value={task.title}
          onSave={handleTitleSave}
          className={styles.titleEdit}
          tag="h2"
          placeholder="Task title..."
          startEditing={task.title === "New task"}
        />
      </div>

      {/* Tab bar */}
      <div className={styles.tabBar}>
        <button
          className={`${styles.tab} ${activeTab === "edit" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("edit")}
        >
          Edit
        </button>
        <button
          className={`${styles.tab} ${activeTab === "plan" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("plan")}
        >
          Agent
        </button>
        <button
          className={`${styles.tab} ${activeTab === "changes" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("changes")}
        >
          Changes
        </button>
        <button
          className={`${styles.tab} ${activeTab === "debug" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("debug")}
        >
          Debug
        </button>
        <span className={styles.filePathHint}>{task.filePath}</span>
      </div>

      {/* Content area */}
      {/* TaskTerminal stays mounted so the running agent isn't killed
            when the user temporarily switches to Edit/Changes tab. */}
      {(() => {
        const effectiveCwd =
          task.useWorktree && task.worktree
            ? task.worktree.startsWith("/")
              ? task.worktree
              : `${workspacePath}/${task.worktree}`
            : (workspacePath ?? "");
        const effectiveAgent =
          task.agent ??
          (task.status === "doing"
            ? workspaceDefaults.defaultExecutionAgent
            : workspaceDefaults.defaultPlanningAgent) ??
          "opencode";
        const effectiveModel =
          task.status === "doing"
            ? (workspaceDefaults.defaultExecutionModel ?? null)
            : (workspaceDefaults.defaultPlanningModel ?? null);
        // Plan session for backlog; exec session for doing/review
        const sessionMode: "plan" | "exec" =
          task.status === "doing" || task.status === "review" ? "exec" : "plan";
        const initialSessionName =
          sessionMode === "plan"
            ? (task.terminalPlanSession ?? null)
            : (task.terminalExecSession ?? null);
        return (
          <div
            style={
              activeTab === "plan"
                ? {
                    display: "flex",
                    flex: 1,
                    overflow: "hidden",
                    flexDirection: "column",
                  }
                : { display: "none" }
            }
          >
            <TaskTerminal
              key={task.id}
              task={task}
              visible={activeTab === "plan"}
              workspacePath={workspacePath ?? ""}
              cwd={effectiveCwd}
              agent={effectiveAgent}
              model={effectiveModel}
              sessionMode={sessionMode}
              initialSessionName={initialSessionName}
              promptConfig={{
                planPersona: workspaceDefaults.planPersona,
                planReviewPersona: workspaceDefaults.planReviewPersona,
                executePersona: workspaceDefaults.executePersona,
                executeReviewPersona: workspaceDefaults.executeReviewPersona,
                executeReviewInstructions:
                  workspaceDefaults.executeReviewInstructions,
              }}
            />
          </div>
        );
      })()}
      {activeTab === "changes" && (
        <div className={styles.changesWrapper}>
          <ChangesTab task={task} />
        </div>
      )}
      {activeTab === "debug" && <DebugPanel task={task} />}
      {activeTab === "edit" && (
        <div className={styles.splitView}>
          {/* Left: raw markdown editor */}
          <div className={styles.editorPane}>
            <textarea
              ref={editorRef}
              className={styles.editor}
              value={rawContent}
              onChange={handleEditorChange}
              onScroll={handleEditorScroll}
              spellCheck={false}
            />
          </div>

          {/* Right: markdown preview */}
          <div
            ref={previewRef}
            className={styles.previewPane}
            onScroll={handlePreviewScroll}
          >
            <div
              className={styles.preview}
              dangerouslySetInnerHTML={{
                __html: renderedMarkdownPreview,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
