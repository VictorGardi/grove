import { useState, useEffect, useRef, useCallback } from "react";
import { useDataStore, useSelectedTask } from "../../stores/useDataStore";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { useNavStore } from "../../stores/useNavStore";
import { useFileStore } from "../../stores/useFileStore";
import { usePlanStore } from "../../stores/usePlanStore";
import { updateTask, archiveTask } from "../../actions/taskActions";
import { InlineEdit } from "../shared/InlineEdit";
import { TagInput } from "../shared/TagInput";
import { ChangesTab } from "./ChangesTab";
import { PlanChat } from "./PlanChat";
import styles from "./TaskDetailPanel.module.css";

// ── Constants ─────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  backlog: "var(--text-lo)",
  doing: "var(--status-green)",
  review: "var(--status-amber)",
  done: "var(--status-green)",
};

const DEBOUNCE_MS = 500;

type DetailTab = "edit" | "plan" | "changes" | "debug";

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
  const workspacePath = useWorkspaceStore((s) => s.activeWorkspacePath);

  // Tab state
  const [activeTab, setActiveTab] = useState<DetailTab>("edit");

  // Raw markdown content
  const [rawContent, setRawContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [loading, setLoading] = useState(true);
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

  // Default to plan (Agent) tab for all tasks
  // Only set when a task is present to avoid updating state when no task is selected
  useEffect(() => {
    if (!task) return;
    setActiveTab("plan");
  }, [task?.id, task]);

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

  // ── Close on Escape ───────────────────────────────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        clearSelectedTask();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clearSelectedTask]);

  // ── Click-outside to close (backdrop click) ───────────────────

  function handleBackdropClick(e: React.MouseEvent): void {
    if (e.target === e.currentTarget) {
      clearSelectedTask();
    }
  }

  // ── Loading / empty state ─────────────────────────────────────

  if (!task) return <></>;

  if (loading) {
    return (
      <div className={styles.overlay} onClick={handleBackdropClick}>
        <div className={styles.modal}>
          <div className={styles.loading}>Loading...</div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={styles.overlay} onClick={handleBackdropClick}>
        <div className={styles.modal}>
          <div
            className={styles.loading}
            style={{ color: "var(--status-red)" }}
          >
            {loadError}
          </div>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className={styles.overlay} onClick={handleBackdropClick}>
      <div className={styles.modal}>
        {/* Top bar: metadata */}
        <div className={styles.topBar}>
          <div className={styles.topBarLeft}>
            <span className={styles.idBadge}>{task.id}</span>
            <span className={styles.statusTag}>
              <span
                className={styles.statusDot}
                style={{ background: STATUS_COLORS[task.status] }}
              />
              {task.status}
            </span>

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
              <span className={styles.metaCreated}>{task.created}</span>
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
              onClick={clearSelectedTask}
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
        {/* PlanChat stays mounted for all tasks so a running agent
            isn't cancelled when the user temporarily switches to Edit/Changes tab.
            The cancel-on-unmount in PlanChat only fires when the panel closes. */}
        {(() => {
          const planMode = task.status === "doing" ? "execute" : "plan";
          // Only pass a worktree path when useWorktree is enabled AND a
          // worktree has actually been created. When false the agent runs
          // in the workspace root.
          const worktreeAbsPath =
            task.useWorktree && task.worktree
              ? task.worktree.startsWith("/")
                ? task.worktree
                : `${workspacePath}/${task.worktree}`
              : undefined;
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
              <PlanChat
                key={task.id}
                task={task}
                mode={planMode}
                worktreePath={worktreeAbsPath}
                onClose={() => setActiveTab("edit")}
              />
            </div>
          );
        })()}
        {activeTab === "changes" && (
          <div className={styles.changesWrapper}>
            <ChangesTab task={task} />
          </div>
        )}
        {activeTab === "debug" &&
          (() => {
            const planSessionKey = `plan:${task.id}`;
            const execSessionKey = `execute:${task.id}`;
            const planStoreSession =
              usePlanStore.getState().sessions[planSessionKey];
            const execStoreSession =
              usePlanStore.getState().sessions[execSessionKey];
            const groveDir = `${(window as { process?: { env?: { HOME?: string } } }).process?.env?.HOME ?? "~"}/.grove/runs`;
            const planLogPath = task.planTmuxSession
              ? `${groveDir}/${task.planTmuxSession}.log`
              : null;
            const execLogPath = task.execTmuxSession
              ? `${groveDir}/${task.execTmuxSession}.log`
              : null;

            type DebugRow = { label: string; value: string | null | undefined };
            const rows: DebugRow[] = [
              { label: "planTmuxSession", value: task.planTmuxSession },
              { label: "planLogPath", value: planLogPath },
              { label: "execTmuxSession", value: task.execTmuxSession },
              { label: "execLogPath", value: execLogPath },
              { label: "planSessionId", value: task.planSessionId },
              { label: "planSessionAgent", value: task.planSessionAgent },
              { label: "planModel", value: task.planModel },
              { label: "execSessionId", value: task.execSessionId },
              { label: "execSessionAgent", value: task.execSessionAgent },
              { label: "execModel", value: task.execModel },
              {
                label: "store:plan status",
                value: planStoreSession?.sessionStatus ?? null,
              },
              {
                label: "store:plan msgs",
                value: planStoreSession
                  ? String(planStoreSession.messages.length)
                  : null,
              },
              {
                label: "store:plan isRunning",
                value: planStoreSession
                  ? String(planStoreSession.isRunning)
                  : null,
              },
              {
                label: "store:exec status",
                value: execStoreSession?.sessionStatus ?? null,
              },
              {
                label: "store:exec msgs",
                value: execStoreSession
                  ? String(execStoreSession.messages.length)
                  : null,
              },
              {
                label: "store:exec isRunning",
                value: execStoreSession
                  ? String(execStoreSession.isRunning)
                  : null,
              },
            ];

            return (
              <div className={styles.debugPanel}>
                <table className={styles.debugTable}>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.label}>
                        <td className={styles.debugLabel}>{row.label}</td>
                        <td className={styles.debugValue}>
                          {row.value ?? (
                            <span className={styles.debugNull}>null</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}
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
                  __html: renderMarkdownPreview(rawContent),
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
