import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Fuse from "fuse.js";
import { usePlanStore } from "../../stores/usePlanStore";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { useFileStore } from "../../stores/useFileStore";
import { updateTask } from "../../actions/taskActions";
import {
  buildFirstPlanMessage,
  buildFirstExecutionMessage,
  type PromptConfig,
} from "../../utils/planPrompts";
import { ToolUseBlock } from "./ToolUseBlock";
import { TodoListFromMarkdown } from "./TodoListBlock";
import type {
  TaskInfo,
  PlanAgent,
  PlanMessage,
  PlanMode,
  FileTreeNode,
} from "@shared/types";
import styles from "./PlanChat.module.css";

// Re-export for consumers that imported these from PlanChat before the refactor
export { buildFirstPlanMessage, buildFirstExecutionMessage };

// ── Thinking block ──────────────────────────────────────────────

function ThinkingBlock({ content }: { content: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);

  if (!content) return <></>;

  return (
    <div className={styles.thinkingBlock}>
      <button className={styles.thinkingToggle} onClick={() => setOpen(!open)}>
        <span
          className={`${styles.thinkingArrow} ${open ? styles.thinkingArrowOpen : ""}`}
        >
          &#9654;
        </span>
        Thinking...
      </button>
      {open && <div className={styles.thinkingContent}>{content}</div>}
    </div>
  );
}

// ── Single message ──────────────────────────────────────────────

function ChatMessage({
  msg,
  model,
}: {
  msg: PlanMessage;
  model?: string | null;
}): React.JSX.Element {
  const isAgent = msg.role === "agent";

  // Placeholder messages get a distinct muted treatment
  if (msg.isPlaceholder) {
    return (
      <div className={styles.messagePlaceholder}>
        <span className={styles.messagePlaceholderText}>{msg.text}</span>
      </div>
    );
  }

  const timeStr = msg.timestamp
    ? new Date(msg.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : null;

  // Count tool_use blocks for the badge in the message header
  const toolCallCount =
    isAgent && msg.content
      ? msg.content.filter((b) => b.kind === "tool_use").length
      : 0;

  // Determine whether to use new ordered content rendering or legacy fallback
  const hasContent = isAgent && msg.content && msg.content.length > 0;

  return (
    <div
      className={`${styles.message} ${isAgent ? styles.messageAgent : styles.messageUser}`}
      role="article"
      aria-label={`${isAgent ? "Agent" : "You"}${isAgent && model ? ` (${model})` : ""}${timeStr ? ` — ${timeStr}` : ""}`}
    >
      <span className={styles.messageRole}>
        {isAgent ? "Agent" : "You"}
        {isAgent && model ? (
          <span className={styles.messageModel}>{model}</span>
        ) : null}
        {toolCallCount > 0 && (
          <span className={styles.toolCallBadge}>
            {toolCallCount} {toolCallCount === 1 ? "tool call" : "tool calls"}
          </span>
        )}
        {timeStr && <span className={styles.messageTime}>{timeStr}</span>}
      </span>
      {/* Legacy rendering path: no content array (old messages / backward compat) */}
      {isAgent && !hasContent && msg.thinking && (
        <ThinkingBlock content={msg.thinking} />
      )}
      {/* "Thinking..." indicator while waiting for first response */}
      {isAgent && msg.isStreaming && !hasContent && !msg.thinking && (
        <div className={styles.thinkingBlock}>
          <span className={styles.thinkingToggle}>Thinking...</span>
        </div>
      )}
      <div
        className={`${styles.messageBubble} ${isAgent ? styles.bubbleAgent : styles.bubbleUser}`}
      >
        {isAgent ? (
          <div className={styles.agentMarkdown}>
            {hasContent ? (
              // New ordered content array rendering
              <>
                {msg.content!.map((block, i) => {
                  if (block.kind === "thinking") {
                    return <ThinkingBlock key={i} content={block.content} />;
                  }
                  if (block.kind === "tool_use") {
                    return <ToolUseBlock key={i} block={block} />;
                  }
                  if (block.kind === "todo_list") {
                    return (
                      <TodoListFromMarkdown key={i} content={block.content} />
                    );
                  }
                  // kind === "text"
                  return (
                    <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>
                      {block.content || " "}
                    </ReactMarkdown>
                  );
                })}
              </>
            ) : (
              // Legacy: render flat text field
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {msg.text || " "}
              </ReactMarkdown>
            )}
            {msg.isStreaming && <span className={styles.streamingCursor} />}
          </div>
        ) : (
          <span>{msg.text}</span>
        )}
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────

interface PlanChatProps {
  task: TaskInfo;
  mode: PlanMode;
  /** Absolute path to the worktree — required when mode === "execute" */
  worktreePath?: string;
  onClose: () => void;
}

export function PlanChat({
  task,
  mode,
  worktreePath,
  onClose,
}: PlanChatProps): React.JSX.Element {
  const workspacePath = useWorkspaceStore((s) => s.activeWorkspacePath);

  // Composite session key scopes plan and execute sessions independently
  const sessionKey = `${mode}:${task.id}`;

  const session = usePlanStore((s) => s.sessions[sessionKey]);
  const initSession = usePlanStore((s) => s.initSession);
  const appendUserMessage = usePlanStore((s) => s.appendUserMessage);
  const startAgentMessage = usePlanStore((s) => s.startAgentMessage);
  const applyChunk = usePlanStore((s) => s.applyChunk);
  const clearSession = usePlanStore((s) => s.clearSession);
  const setRunning = usePlanStore((s) => s.setRunning);
  const setSessionStatus = usePlanStore((s) => s.setSessionStatus);
  const setReplaying = usePlanStore((s) => s.setReplaying);

  // Use mode-appropriate persisted session info for initial state
  const persistedSessionId =
    mode === "execute" ? task.execSessionId : task.planSessionId;
  const persistedAgent =
    mode === "execute"
      ? (task.execSessionAgent ?? "opencode")
      : (task.planSessionAgent ?? "opencode");
  const persistedModel =
    mode === "execute" ? (task.execModel ?? "") : (task.planModel ?? "");

  const workspaceDefaults = useWorkspaceStore((s) => s.workspaceDefaults);
  const fetchDefaults = useWorkspaceStore((s) => s.fetchDefaults);

  const isExecute = mode === "execute";

  const defaultAgent = isExecute
    ? (workspaceDefaults[workspacePath ?? ""]?.defaultExecutionAgent ??
      "opencode")
    : (workspaceDefaults[workspacePath ?? ""]?.defaultPlanningAgent ??
      "opencode");
  const defaultModel = isExecute
    ? (workspaceDefaults[workspacePath ?? ""]?.defaultExecutionModel ?? "")
    : (workspaceDefaults[workspacePath ?? ""]?.defaultPlanningModel ?? "");

  const promptConfig: PromptConfig = {
    planPersona: workspaceDefaults[workspacePath ?? ""]?.planPersona,
    planReviewPersona:
      workspaceDefaults[workspacePath ?? ""]?.planReviewPersona,
    executePersona: workspaceDefaults[workspacePath ?? ""]?.executePersona,
    executeReviewPersona:
      workspaceDefaults[workspacePath ?? ""]?.executeReviewPersona,
    executeReviewInstructions:
      workspaceDefaults[workspacePath ?? ""]?.executeReviewInstructions,
  };

  const initialAgent =
    persistedAgent !== "opencode" || persistedModel !== ""
      ? persistedAgent
      : defaultAgent;
  const initialModel = persistedModel !== "" ? persistedModel : defaultModel;

  const [inputText, setInputText] = useState("");
  const [agent, setAgent] = useState<PlanAgent>(initialAgent);
  const [model, setModel] = useState<string>(initialModel);

  // Chat history navigation state
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  // Use cached models from usePlanStore
  const ensureModels = usePlanStore((s) => s.ensureModels);
  const modelsCacheEntry = usePlanStore(
    (s) => s.modelsCache[`${workspacePath ?? ""}:${agent}`],
  );

  const [availableModels, setAvailableModels] = useState<string[]>(() =>
    Array.isArray(modelsCacheEntry) ? modelsCacheEntry : [],
  );
  const [modelsLoading, setModelsLoading] = useState<boolean>(
    () => modelsCacheEntry === null,
  );
  const [defaultPromptPreview, setDefaultPromptPreview] = useState<string>("");
  const [tmuxAvailable, setTmuxAvailable] = useState<boolean | null>(null);
  const [defaultsLoaded, setDefaultsLoaded] = useState(false);

  const isRunning = session?.isRunning ?? false;
  const hasSession = !!session?.sessionId;

  // Compute default prompt preview on mount (for execute mode, show what will be sent)
  useEffect(() => {
    if (!workspacePath || hasSession || mode !== "execute") {
      setDefaultPromptPreview("");
      return;
    }

    window.api.tasks
      .readRaw(workspacePath, task.filePath)
      .then((result) => {
        if (result.ok) {
          const preview = buildFirstExecutionMessage(
            task,
            result.data,
            promptConfig,
          );
          // Truncate for display
          setDefaultPromptPreview(
            preview.length > 300 ? preview.slice(0, 300) + "..." : preview,
          );
        }
      })
      .catch(() => setDefaultPromptPreview(""));
  }, [workspacePath, task.filePath, task.id, task.title, mode, hasSession]);

  const messageListRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const userScrolledRef = useRef(false);

  // Ensure models are cached for this (workspacePath, agent) combination
  useEffect(() => {
    if (workspacePath) {
      void ensureModels(workspacePath, agent);
    }
  }, [workspacePath, agent, ensureModels]);

  // Sync from cache to local state, preserving model validation logic
  useEffect(() => {
    const cached = modelsCacheEntry;
    if (Array.isArray(cached)) {
      setAvailableModels(cached);
      setModelsLoading(false);
      if (model && cached.length > 0 && !cached.includes(model)) {
        console.warn(
          `[PlanChat] Invalid model "${model}" for agent "${agent}". Clearing.`,
        );
        setModel("");
      }
    } else if (cached === null) {
      setModelsLoading(true);
    }
  }, [modelsCacheEntry, model, agent]);

  // Fetch workspace defaults on mount
  useEffect(() => {
    if (workspacePath && !defaultsLoaded) {
      fetchDefaults(workspacePath).then(() => setDefaultsLoaded(true));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath]);

  // One-time check on mount: is tmux available at all?
  // This drives the "tmux unavailable" warning in the header independently of
  // whether there is an active session to reconnect to.
  useEffect(() => {
    window.api.plan
      .isTmuxAvailable()
      .then((result) => setTmuxAvailable(result.ok && result.data))
      .catch(() => setTmuxAvailable(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // only on mount

  // Initialise session on mount using the composite key.
  // NOTE: persistedSessionId is intentionally excluded from the dep array.
  // When a new session starts, saveSession() writes the session ID to the task
  // frontmatter, which triggers a chokidar re-fetch that updates persistedSessionId
  // from null → a real ID. Including it in deps would re-fire this effect mid-stream,
  // which hits the isRunning guard in initSession and resets isRunning:false on a
  // live session — making the Send button appear and letting the user accidentally
  // cancel the running agent. The value IS captured correctly on first mount and
  // whenever sessionKey / agent / model change.

  useEffect(() => {
    initSession(sessionKey, agent, model || null, persistedSessionId ?? null);
  }, [sessionKey, agent, model, initSession]);

  // Reset stale isRunning on component mount only — but ONLY when there is no
  // stored tmux session that a live agent could be attached to.
  //
  // If storedSession is non-null the reconnect effect below is responsible for
  // determining the correct isRunning value:
  //   • reconnected === true  → setRunning(true) so the board card shows
  //     "agent running" throughout replay without a flicker window
  //   • reconnected === false → setRunning(false) to clear any stale flag
  //
  // If storedSession is null there is definitively no live agent; reset any
  // stale flag left behind by a crash or external kill.
  //
  // key={task.id} on <PlanChat> ensures this runs fresh for each task.
  useEffect(() => {
    const storedSession =
      mode === "execute" ? task.execTmuxSession : task.planTmuxSession;
    if (!storedSession) {
      const s = usePlanStore.getState().sessions[sessionKey];
      if (s?.isRunning) setRunning(sessionKey, false);
    }
    // If storedSession exists: the reconnect effect below handles isRunning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — only run on mount

  // Reconnect to an existing tmux session on mount only.
  // Reads the stored session name from frontmatter at mount time:
  //   - non-null → a prior run exists, replay its log (live or finished)
  //   - null     → nothing to reconnect, skip
  //
  // IMPORTANT: this must use an empty dep array (mount-only) so it does NOT
  // re-fire when task.planTmuxSession changes.  plan:send writes planTmuxSession
  // to frontmatter after the tmux session starts; chokidar picks that up and
  // updates task.planTmuxSession from null → a value.  If this effect ran
  // reactively on that change it would call startAgentMessage() again, creating
  // a duplicate agent bubble alongside the one handleSend() already created.
  //
  // Duplicate-bubble prevention:
  //   1. startAgentMessage is called AFTER plan:reconnect confirms the log file
  //      exists, not before.  This avoids adding an empty bubble when the log is
  //      missing (e.g. deleted), which would otherwise persist on every open.
  //   2. A `cancelled` flag is returned as the cleanup function so that React
  //      StrictMode's double-invocation of effects does not fire two concurrent
  //      reconnect attempts — the first invocation is cancelled before its async
  //      code runs past the guard, and only the second proceeds.
  useEffect(() => {
    if (!workspacePath) return;

    // Capture storedSession at mount time — don't react to later changes
    const storedSession =
      mode === "execute" ? task.execTmuxSession : task.planTmuxSession;
    if (!storedSession) return;

    // If the store already has messages for this session the tailer is either
    // already running (plan:send path) or the session was fully replayed in an
    // earlier mount.  Either way another reconnect would duplicate every bubble.
    const existingSession = usePlanStore.getState().sessions[sessionKey];
    if ((existingSession?.messages?.length ?? 0) > 0) return;

    let cancelled = false;

    const checkTmux = async () => {
      try {
        const availableResult = await window.api.plan.isTmuxAvailable();
        if (cancelled) return;
        setTmuxAvailable(availableResult.ok && availableResult.data);

        if (!availableResult.ok || !availableResult.data) {
          return;
        }

        setSessionStatus(sessionKey, "reconnecting");

        // Call plan:reconnect BEFORE creating the agent bubble.
        // The main process starts the log tailer synchronously inside the IPC
        // handler, then returns.  Chunks are flushed via setImmediate — which
        // fires after the handler returns — so the IPC response always arrives
        // in the renderer before the first plan:chunks message.  This means the
        // bubble created below is guaranteed to exist before any chunks land.
        const reconnectResult = await window.api.plan.reconnect({
          taskId: task.id,
          mode,
          agent,
          workspacePath,
          taskFilePath: task.filePath,
        });
        if (cancelled) return;

        if (reconnectResult.ok && reconnectResult.data.reconnected) {
          // Log file found, tailer is running. The agent bubble will be
          // created lazily in App.tsx when the first content chunk arrives.
          //
          // Only set isRunning: true and show the "reconnected" banner when
          // the tmux session itself is still alive — i.e. the agent is still
          // running. For dead sessions (agent finished while the app was
          // closed) we just replay the log for history display without
          // blocking the input.
          if (reconnectResult.data.sessionAlive) {
            setRunning(sessionKey, true);
            setSessionStatus(sessionKey, "running");
          } else {
            setSessionStatus(sessionKey, "idle");
          }
          // Mark as replaying so user_message chunks create user bubbles.
          setReplaying(sessionKey, true);
        } else {
          // No log file found — nothing to replay.  Clear any stale
          // isRunning flag left by a previous crashed run, then let the
          // user resume with Send.
          setRunning(sessionKey, false);
          setSessionStatus(sessionKey, "paused");
        }
      } catch {
        // Ignore errors - tmux may not be available
      }
    };

    checkTmux();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally mount-only — must not re-fire when planTmuxSession changes

  // Auto-scroll to bottom on new messages/chunks, unless user scrolled up
  useEffect(() => {
    const list = messageListRef.current;
    if (!list || userScrolledRef.current) return;
    list.scrollTop = list.scrollHeight;
  }, [session?.messages.length]);

  // Track user scroll position
  const handleScroll = useCallback(() => {
    const list = messageListRef.current;
    if (!list) return;
    const atBottom =
      list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    userScrolledRef.current = !atBottom;
  }, []);

  const messages = session?.messages ?? [];

  // Extract user messages for history navigation (only user messages, newest first)
  const userMessages = useMemo(
    () => messages.filter((m) => m.role === "user").map((m) => m.text),
    [messages],
  );
  const lastExitCode = session?.lastExitCode ?? null;
  const lastStderr = session?.lastStderr ?? null;
  const totalTokens = session?.totalTokens ?? 0;

  // Format token count for display (e.g., 1234 -> "1.2k")
  const tokenDisplay =
    totalTokens > 0
      ? totalTokens >= 1000
        ? `${(totalTokens / 1000).toFixed(1)}k`
        : totalTokens.toString()
      : null;

  // ── Send message ────────────────────────────────────────────

  async function handleSend(): Promise<void> {
    const text = inputText.trim();
    if (!workspacePath || isRunning) return;

    const sessionId = session?.sessionId ?? null;
    const isFirstMessage = !sessionId;

    // Plan mode always requires text.
    // Execute mode allows empty text on the first message — the full execution
    // prompt is built from the task content, no user text needed to kick it off.
    if (!text && (mode === "plan" || !isFirstMessage)) return;

    // In execute mode: first send auto-builds the execution prompt; user text
    // is only included in the initial prompt (the input box just triggers it).
    // In plan mode: first send assembles planning prompt; follow-ups are plain.

    // Stop replaying — fresh send shouldn't process log user_message chunks as bubbles
    setReplaying(sessionKey, false);

    // Add user message to store.
    // For execute mode first-send with no user text, show a minimal "Executing..."
    // placeholder so the user always sees their send was received, rather than
    // just the agent bubble appearing out of nowhere.
    if (text) {
      appendUserMessage(sessionKey, text);
    } else if (mode === "execute" && isFirstMessage) {
      appendUserMessage(sessionKey, `Execute: ${task.title}`);
    }
    setInputText("");
    // Reset textarea height after clearing
    if (inputRef.current) inputRef.current.style.height = "auto";
    userScrolledRef.current = false;

    // Reset history navigation state after sending
    setHistoryIndex(null);

    // Prepare the agent message slot
    startAgentMessage(sessionKey);

    // Build the actual prompt
    let message: string;

    if (!sessionId) {
      // First message — read task content and assemble full prompt
      let rawContent = "";
      try {
        const rawResult = await window.api.tasks.readRaw(
          workspacePath,
          task.filePath,
        );
        rawContent = rawResult.ok ? rawResult.data : "";
      } catch {
        // continue with empty content
      }

      if (mode === "execute") {
        // Execution prompt is fully built — user text is appended as context if provided
        const base = buildFirstExecutionMessage(task, rawContent, promptConfig);
        message = text
          ? `${base}\n\n## Additional Context from User\n\n${text}`
          : base;
      } else {
        message = buildFirstPlanMessage(task, text, rawContent, promptConfig);
      }
    } else {
      // Follow-up — just send plain text
      message = text;
    }

    const result = await window.api.plan.send({
      taskId: task.id,
      mode,
      agent,
      model: model || null,
      message,
      displayMessage: text,
      sessionId,
      workspacePath,
      taskFilePath: task.filePath,
      ...(mode === "execute" && worktreePath ? { worktreePath } : {}),
    });
    if (!result.ok) {
      console.error("[PlanChat] plan.send failed:", result.error);
      // IPC failed — no done chunk will arrive, so manually reset the running
      // state to prevent Send being permanently replaced by Cancel.
      applyChunk(sessionKey, { type: "error", content: result.error });
    }
  }

  // ── Cancel ──────────────────────────────────────────────────

  function handleCancel(): void {
    if (!workspacePath) return;
    // Optimistically unblock the UI immediately — don't wait for the IPC
    // round-trip or for a synthetic done chunk from the backend.  This is
    // especially important for reconnected-but-dead sessions where
    // TmuxPlanRunner.cancel() returns early (no activeKey) and never emits
    // a synthetic done chunk.
    setRunning(sessionKey, false);
    setReplaying(sessionKey, false);
    window.api.plan.cancel({
      taskId: task.id,
      mode,
      workspacePath,
      taskFilePath: task.filePath,
    });
  }

  // ── New session ─────────────────────────────────────────────

  function handleNewSession(): void {
    // Cancel any in-flight run before clearing
    if (workspacePath) {
      window.api.plan.cancel({
        taskId: task.id,
        mode,
        workspacePath,
        taskFilePath: task.filePath,
      });
    }
    clearSession(sessionKey);
    // Clear from frontmatter (mode-appropriate fields).
    // Also clear the tmux session name so the old log is not replayed the
    // next time this task is opened — plan:cancel no longer clears it (to
    // preserve history for cancel + reload), so New Session must do it.
    if (workspacePath) {
      if (mode === "execute") {
        updateTask(task.filePath, {
          execSessionId: null,
          execSessionAgent: null,
          execModel: null,
          execTmuxSession: null,
        });
      } else {
        updateTask(task.filePath, {
          planSessionId: null,
          planSessionAgent: null,
          planModel: null,
          planTmuxSession: null,
        });
      }
    }
    // Re-init fresh session
    initSession(sessionKey, agent, model || null, null);
  }

  // ── Agent change (only before session starts) ───────────────

  function handleAgentChange(newAgent: PlanAgent): void {
    if (hasSession || isRunning) return;
    setAgent(newAgent);
    clearSession(sessionKey);
    initSession(sessionKey, newAgent, model || null, null);
  }

  // ── Model change — allowed mid-session via /model command ──────────────────
  // Only blocked while the agent is actively streaming.

  function handleModelChange(newModel: string): void {
    if (isRunning) return;
    setModel(newModel);
  }

  // ── Auto-resize textarea ─────────────────────────────────────

  const resizeTextarea = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  // ── File autocomplete ──────────────────────────────────────────

  const tree = useFileStore((s) => s.tree);
  const treeLoading = useFileStore((s) => s.treeLoading);
  const fetchTree = useFileStore((s) => s.fetchTree);
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ── Model slash-command dropdown ────────────────────────────────────────────
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [selectedModelIndex, setSelectedModelIndex] = useState(0);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  interface SearchableFile {
    name: string;
    path: string;
  }

  function flattenFiles(nodes: FileTreeNode[]): SearchableFile[] {
    const result: SearchableFile[] = [];
    for (const node of nodes) {
      if (node.type === "file") {
        result.push({ name: node.name, path: node.path });
      }
      if (node.type === "directory" && node.children) {
        result.push(...flattenFiles(node.children));
      }
    }
    return result;
  }

  const flatFiles = useMemo(() => flattenFiles(tree), [tree]);

  const fuse = useMemo(
    () =>
      new Fuse(flatFiles, {
        keys: [
          { name: "name", weight: 0.7 },
          { name: "path", weight: 0.3 },
        ],
        threshold: 0.3,
        distance: 100,
        ignoreLocation: true,
      }),
    [flatFiles],
  );

  function findAtPosition(
    text: string,
    cursorPos: number,
  ): { query: string; start: number } | null {
    const beforeCursor = text.slice(0, cursorPos);
    const atMatch = beforeCursor.match(/@([^ ]*)$/);
    if (!atMatch) return null;
    return {
      query: atMatch[1],
      start: beforeCursor.length - atMatch[0].length,
    };
  }

  const atPosition = useMemo(
    () =>
      findAtPosition(
        inputText,
        inputRef.current?.selectionStart ?? inputText.length,
      ),
    [inputText],
  );
  const atQuery = atPosition?.query ?? "";
  const atStart = atPosition?.start ?? 0;

  const fileResults = useMemo(() => {
    if (!showDropdown) return [];
    if (!atQuery) {
      return flatFiles.slice(0, 50).map((f) => ({ item: f }));
    }
    return fuse.search(atQuery, { limit: 50 });
  }, [showDropdown, atQuery, fuse, flatFiles]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [fileResults.length]);

  useEffect(() => {
    if (!showDropdown || !inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    const parentRect = inputRef.current.parentElement?.getBoundingClientRect();
    if (parentRect) {
      const spaceBelow = window.innerHeight - rect.bottom - 10;
      const spaceAbove = rect.top - 10;
      const dropdownHeight = 250; // max-height from CSS
      if (spaceBelow >= dropdownHeight || spaceBelow >= spaceAbove) {
        setDropdownPosition({
          top: rect.height + 4,
          left: 0,
        });
      } else {
        setDropdownPosition({
          top: -dropdownHeight - 4,
          left: 0,
        });
      }
    }
  }, [showDropdown, inputText]);

  function insertFilePath(filePath: string): void {
    const before = inputText.slice(0, atStart);
    const after = inputText.slice(
      inputRef.current?.selectionStart ?? inputText.length,
    );
    const newText = `${before}@${filePath}${after}`;
    setInputText(newText);
    setShowDropdown(false);
    setTimeout(() => {
      if (inputRef.current) {
        const newCursorPos = atStart + filePath.length + 1;
        inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
        inputRef.current.focus();
      }
    }, 0);
  }

  function handleDropdownKeyDown(e: React.KeyboardEvent): void {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, fileResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (fileResults[selectedIndex]) {
        insertFilePath(fileResults[selectedIndex].item.path);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setShowDropdown(false);
    }
  }

  // ── /model slash-command helpers ────────────────────────────────────────────

  /** Returns the query string and start offset when cursor is inside `/model …` */
  function findSlashModelPosition(
    text: string,
    cursorPos: number,
  ): { query: string; start: number } | null {
    const beforeCursor = text.slice(0, cursorPos);
    // Require /model to be at start-of-input or preceded by whitespace so that
    // file paths like "src/models/user.ts" don't false-positive trigger.
    const match = beforeCursor.match(/(^|\s)(\/model\s*(\S*))$/);
    if (!match) return null;
    // match[2] = the "/model …" fragment; match[3] = the query word after /model
    return {
      query: match[3],
      start: beforeCursor.length - match[2].length,
    };
  }

  const slashModelPosition = useMemo(
    () =>
      findSlashModelPosition(
        inputText,
        inputRef.current?.selectionStart ?? inputText.length,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inputText],
  );
  const slashModelQuery = slashModelPosition?.query ?? "";
  const slashModelStart = slashModelPosition?.start ?? 0;

  /**
   * All available models filtered by the query typed after `/model`.
   * An empty string entry represents "default model" (let the agent decide).
   */
  const modelResults = useMemo(() => {
    if (!showModelDropdown) return [];
    const all: string[] = ["", ...availableModels];
    const query = slashModelQuery.toLowerCase();
    if (!query) return all;
    return all.filter((m) =>
      m === ""
        ? "default model".includes(query)
        : m.toLowerCase().includes(query),
    );
  }, [showModelDropdown, slashModelQuery, availableModels]);

  useEffect(() => {
    setSelectedModelIndex(0);
  }, [modelResults.length]);

  /** Commit a model selection: clear the `/model …` token and update state. */
  function insertModelSelection(modelName: string): void {
    const cursorPos = inputRef.current?.selectionStart ?? inputText.length;
    const before = inputText.slice(0, slashModelStart);
    const after = inputText.slice(cursorPos);
    // When the command sits at the very start, the remaining `after` text may
    // have a leading space (e.g. "/model gpt rest" → after=" rest"). trimStart
    // removes that orphaned space.  When `before` is non-empty (command is
    // mid-input) there is never leading whitespace so trimStart is a no-op.
    const newText = (before + after).trimStart();
    // Cursor lands right where the command started. Because trimStart can only
    // shrink the string from the front (when before=""), the offset into the
    // trimmed result is simply `before.length` – the leading characters of
    // `before` are never trimmed.
    const newCursorPos = before.length;
    setInputText(newText);
    setShowModelDropdown(false);
    handleModelChange(modelName);
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  }

  function handleModelDropdownKeyDown(e: React.KeyboardEvent): void {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedModelIndex((prev) =>
        Math.min(prev + 1, modelResults.length - 1),
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedModelIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (modelResults[selectedModelIndex] !== undefined) {
        insertModelSelection(modelResults[selectedModelIndex]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setShowModelDropdown(false);
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    const value = e.target.value;
    setInputText(value);
    resizeTextarea();

    const cursorPos = e.target.selectionStart ?? value.length;
    const pos = findAtPosition(value, cursorPos);
    if (pos) {
      // Ensure tree is loaded — fetch if empty and not loading
      if (tree.length === 0 && !treeLoading) {
        fetchTree();
      }
      setShowDropdown(true);
      setSelectedIndex(0);
      setShowModelDropdown(false);
    } else {
      setShowDropdown(false);

      // Check for /model slash command
      const modelPos = findSlashModelPosition(value, cursorPos);
      if (modelPos !== null) {
        setShowModelDropdown(true);
        setSelectedModelIndex(0);
      } else {
        setShowModelDropdown(false);
      }
    }
  }

  function handleInputKeyDown(
    e: React.KeyboardEvent<HTMLTextAreaElement>,
  ): void {
    // Only handle history navigation when no dropdown is open
    const noDropdownOpen = !showDropdown && !showModelDropdown;

    if (noDropdownOpen && e.key === "ArrowUp") {
      e.preventDefault();
      // If no history yet, or already at the oldest, do nothing
      if (userMessages.length === 0) return;

      // If not currently browsing history, start at newest message
      if (historyIndex === null) {
        setHistoryIndex(userMessages.length - 1);
        setInputText(userMessages[userMessages.length - 1] || "");
      } else if (historyIndex > 0) {
        // Move to older message
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInputText(userMessages[newIndex] || "");
      }
      // At index 0, do nothing (already at oldest)
      resizeTextarea();
      return;
    }

    if (noDropdownOpen && e.key === "ArrowDown") {
      e.preventDefault();
      // If not browsing history, do nothing
      if (historyIndex === null) return;

      if (historyIndex < userMessages.length - 1) {
        // Move to newer message
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        setInputText(userMessages[newIndex] || "");
      } else {
        // At newest, clear to return to fresh input
        setHistoryIndex(null);
        setInputText("");
      }
      resizeTextarea();
      return;
    }

    if (
      showDropdown &&
      (e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "Enter" ||
        e.key === "Escape")
    ) {
      handleDropdownKeyDown(e);
      return;
    }

    if (
      showModelDropdown &&
      (e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "Enter" ||
        e.key === "Escape")
    ) {
      handleModelDropdownKeyDown(e);
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      const target = e.target as Node;
      if (
        !inputRef.current?.contains(target) &&
        !dropdownRef.current?.contains(target)
      ) {
        setShowDropdown(false);
      }
      if (
        !inputRef.current?.contains(target) &&
        !modelDropdownRef.current?.contains(target)
      ) {
        setShowModelDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ── Check for non-zero exit code in done messages ───────────

  const lastMsg = messages[messages.length - 1];
  // "No output" means the agent produced neither text nor any content blocks
  // (tool_use blocks count as real output — don't warn in that case).
  const lastMsgHasNoOutput =
    lastMsg?.role === "agent" &&
    lastMsg.text === "" &&
    (!lastMsg.content || lastMsg.content.length === 0);
  const showExitWarning =
    lastMsg?.role === "agent" &&
    !lastMsg.isStreaming &&
    !isRunning &&
    ((lastExitCode != null && lastExitCode !== 0) ||
      (lastMsgHasNoOutput && messages.length > 0));

  const headerTitle =
    mode === "execute" ? "Execute with agent" : "Plan with agent";
  const emptyStatePlaceholder =
    mode === "execute"
      ? `Send a message to start executing. Type @ to mention files, /model to choose model...`
      : `Describe what you want. Type @ to mention files, /model to choose model...`;
  const inputPlaceholder = isRunning
    ? "Waiting for agent..."
    : hasSession
      ? "Continue the conversation..."
      : mode === "execute"
        ? "Send a message to start executing (or leave blank for default prompt). Type @ to mention files, /model to choose model"
        : "Describe what you want. Type @ to mention files, /model to choose model";

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.headerTitle}>{headerTitle}</span>
          <select
            className={styles.agentSelect}
            value={agent}
            onChange={(e) => handleAgentChange(e.target.value as PlanAgent)}
            disabled={hasSession || isRunning}
          >
            <option value="opencode">opencode</option>
            <option value="copilot">copilot</option>
          </select>
          <span
            className={styles.modelIndicator}
            title="Type /model in the chat input to change"
          >
            {modelsLoading ? "…" : model || "default"}
          </span>
          {hasSession && (
            <span className={styles.resumeIndicator}>Session active</span>
          )}
          {tokenDisplay && (
            <span
              className={styles.tokenIndicator}
              title={`${totalTokens.toLocaleString()} total tokens`}
            >
              🪙 {tokenDisplay}
            </span>
          )}
          {tmuxAvailable === false && (
            <span className={styles.exitWarning} style={{ fontSize: "12px" }}>
              tmux unavailable — agents will not survive app restart
            </span>
          )}
        </div>
        <div className={styles.headerRight}>
          {hasSession && (
            <button className={styles.newSessionBtn} onClick={handleNewSession}>
              New session
            </button>
          )}
          <button
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close plan chat"
          >
            &times;
          </button>
        </div>
      </div>

      {/* Message list */}
      <div
        ref={messageListRef}
        className={styles.messageList}
        onScroll={handleScroll}
      >
        {/* Session status banner */}
        {session?.sessionStatus === "reconnecting" && (
          <div className={styles.runningIndicator}>
            Reconnecting to running agent...
          </div>
        )}
        {session?.sessionStatus === "running" && (
          <div className={styles.runningIndicator}>
            <span className={styles.runningDot} />
            Agent running — reconnected
          </div>
        )}
        {session?.sessionStatus === "paused" && (
          <div className={styles.exitWarning}>
            Session paused — send a message to resume
          </div>
        )}
        {/* Default prompt preview for execute mode when no session */}
        {messages.length === 0 &&
          mode === "execute" &&
          defaultPromptPreview && (
            <div className={styles.defaultPromptPreview}>
              <div className={styles.defaultPromptLabel}>
                Default execution prompt (will be sent on Send):
              </div>
              <pre className={styles.defaultPromptContent}>
                {defaultPromptPreview}
              </pre>
            </div>
          )}
        {messages.length === 0 ? (
          <div className={styles.emptyState}>{emptyStatePlaceholder}</div>
        ) : (
          messages.map((msg) => (
            <ChatMessage
              key={msg.id}
              msg={msg}
              model={msg.role === "agent" ? msg.model : null}
            />
          ))
        )}
        {isRunning && (
          <div className={styles.runningIndicator}>
            <span className={styles.runningDot} />
            running
          </div>
        )}
        {showExitWarning && (
          <div className={styles.exitWarning}>
            Agent exited
            {lastExitCode != null && lastExitCode !== 0
              ? ` with code ${lastExitCode}`
              : " without output"}
            .{" "}
            {lastExitCode === 0 || lastExitCode == null
              ? "The session may have expired — try "
              : lastStderr
                ? "Try "
                : `Is ${agent} installed and on PATH? If so, try `}
            <button
              className={styles.exitWarningNewSession}
              onClick={handleNewSession}
            >
              New session
            </button>
            .
            {lastStderr && (
              <pre className={styles.exitWarningStderr}>{lastStderr}</pre>
            )}
          </div>
        )}
      </div>

      {/* Input area */}
      <div className={styles.inputArea}>
        <div className={styles.inputWrapper}>
          <textarea
            ref={inputRef}
            className={styles.inputField}
            value={inputText}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            placeholder={inputPlaceholder}
            rows={2}
          />
          {showDropdown && (
            <div
              ref={dropdownRef}
              className={styles.fileDropdown}
              style={{
                top: dropdownPosition.top,
                left: dropdownPosition.left,
              }}
            >
              {fileResults.length === 0 ? (
                <div className={styles.fileDropdownNoResults}>
                  {atQuery ? "No matching files" : "No files in workspace"}
                </div>
              ) : (
                fileResults.map((result, index) => (
                  <div
                    key={result.item.path}
                    className={`${styles.fileDropdownItem} ${index === selectedIndex ? styles.fileDropdownItemSelected : ""}`}
                    onClick={() => insertFilePath(result.item.path)}
                  >
                    <span className={styles.fileDropdownItemName}>
                      {result.item.name}
                    </span>
                    <span className={styles.fileDropdownItemPath}>
                      {result.item.path}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
          {showModelDropdown && (
            <div ref={modelDropdownRef} className={styles.modelDropdown}>
              {modelsLoading ? (
                <div className={styles.modelDropdownNoResults}>
                  Loading models…
                </div>
              ) : modelResults.length === 0 ? (
                <div className={styles.modelDropdownNoResults}>
                  No matching models
                </div>
              ) : (
                modelResults.map((m, index) => (
                  <div
                    key={m || "__default__"}
                    className={`${styles.modelDropdownItem} ${
                      index === selectedModelIndex
                        ? styles.modelDropdownItemSelected
                        : ""
                    }`}
                    // Use onMouseDown + preventDefault so the textarea keeps focus
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertModelSelection(m);
                    }}
                  >
                    <span className={styles.modelDropdownItemName}>
                      {m || "default model"}
                    </span>
                    {m === model && (
                      <span className={styles.modelDropdownCurrentMark}>✓</span>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        {isRunning ? (
          <button className={styles.cancelBtn} onClick={handleCancel}>
            Cancel
          </button>
        ) : (
          <button
            className={styles.sendBtn}
            onClick={() => void handleSend()}
            disabled={mode === "plan" && !inputText.trim()}
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
