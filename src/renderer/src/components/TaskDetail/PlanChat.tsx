import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Fuse from "fuse.js";
import { usePlanStore } from "../../stores/usePlanStore";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { useFileStore } from "../../stores/useFileStore";
import { updateTask } from "../../actions/taskActions";
import type {
  TaskInfo,
  PlanAgent,
  PlanMessage,
  PlanMode,
  FileTreeNode,
} from "@shared/types";
import styles from "./PlanChat.module.css";

// ── Prompt builders (exported for preview) ────────────────────────────────

export function buildFirstPlanMessage(
  task: TaskInfo,
  userText: string,
  taskRawContent: string,
): string {
  const absolutePath = task.filePath;

  return `You are a planning assistant for a software task.

## Task

ID: ${task.id}
Title: ${task.title}
File: ${absolutePath}

## Current Task Content

${taskRawContent}

## Your Role

You are helping a developer plan and define this task — NOT implement it.

Rules:
- Do NOT write any code.
- Do NOT create, delete, or modify any file except the task markdown at the path above.
- Do NOT run shell commands that read or modify the codebase.
- You may use read-only tools (read file, search) to understand the codebase if needed.
- Only update the "## Description" and "## Definition of Done" sections of the task file when the plan is agreed upon.
- Ask clarifying questions freely. The user will respond in this same session.
- Before writing to the task file, spawn a senior software engineer subagent to critically review the proposed plan. The subagent should verify: Are the DoD items testable and specific? Are there missing edge cases? Is the scope appropriate? Only write to the file if the review passes or the raised issues are addressed.

## User's Request

${userText}`;
}

export function buildFirstExecutionMessage(
  task: TaskInfo,
  taskRawContent: string,
): string {
  return `You are an execution agent for a software task.

## Task

ID: ${task.id}
Title: ${task.title}
File: ${task.filePath}

## Current Task Content

${taskRawContent}

## Your Role

Work through the task's Definition of Done checkboxes systematically:

1. Read the task description carefully and understand the full scope.
2. Implement the required changes in the codebase.
3. After completing each DoD item, update the task file at the path above to check it off.
4. When all items are complete, verify your work against the acceptance criteria.

You have full access to read files, write files, and run shell commands. Work autonomously through the entire Definition of Done without waiting for confirmation unless you encounter a genuine blocker.`;
}

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

  return (
    <div
      className={`${styles.message} ${isAgent ? styles.messageAgent : styles.messageUser}`}
    >
      <span className={styles.messageRole}>
        {isAgent ? "Agent" : "You"}
        {isAgent && model ? (
          <span className={styles.messageModel}>{model}</span>
        ) : null}
      </span>
      {isAgent && msg.thinking && <ThinkingBlock content={msg.thinking} />}
      <div
        className={`${styles.messageBubble} ${isAgent ? styles.bubbleAgent : styles.bubbleUser}`}
      >
        {isAgent ? (
          <div className={styles.agentMarkdown}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {msg.text || " "}
            </ReactMarkdown>
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

  // Use mode-appropriate persisted session info for initial state
  const persistedSessionId =
    mode === "execute" ? task.execSessionId : task.planSessionId;
  const persistedAgent =
    mode === "execute"
      ? (task.execSessionAgent ?? "opencode")
      : (task.planSessionAgent ?? "opencode");
  const persistedModel =
    mode === "execute" ? (task.execModel ?? "") : (task.planModel ?? "");

  const [inputText, setInputText] = useState("");
  const [agent, setAgent] = useState<PlanAgent>(persistedAgent);
  const [model, setModel] = useState<string>(persistedModel);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [defaultPromptPreview, setDefaultPromptPreview] = useState<string>("");

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
          const preview = buildFirstExecutionMessage(task, result.data);
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

  // Load model list whenever agent changes (or on mount)
  useEffect(() => {
    if (!workspacePath) return;
    setModelsLoading(true);
    window.api.plan
      .listModels({ agent, workspacePath })
      .then((result) => {
        setAvailableModels(result.ok ? result.data : []);
      })
      .catch(() => setAvailableModels([]))
      .finally(() => setModelsLoading(false));
  }, [agent, workspacePath]);

  // Initialise session on mount using the composite key.
  // NOTE: persistedSessionId is intentionally excluded from the dep array.
  // When a new session starts, saveSession() writes the session ID to the task
  // frontmatter, which triggers a chokidar re-fetch that updates persistedSessionId
  // from null → a real ID. Including it in deps would re-fire this effect mid-stream,
  // which hits the isRunning guard in initSession and resets isRunning:false on a
  // live session — making the Send button appear and letting the user accidentally
  // cancel the running agent. The value IS captured correctly on first mount and
  // whenever sessionKey / agent / model change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    initSession(sessionKey, agent, model || null, persistedSessionId ?? null);
  }, [sessionKey, agent, model, initSession]);

  // Reset stale isRunning on component mount only. If the agent process
  // crashed or was killed outside of Grove, isRunning can remain true
  // indefinitely. We reset it here — not inside initSession — so that a
  // chokidar-triggered re-fire of the initSession effect cannot clobber a
  // live session. key={task.id} on <PlanChat> ensures this runs fresh for
  // each task; if the task panel closes and reopens for the same task the
  // component remounts and the reset fires again (acceptable: next chunk
  // from a still-running agent sets isRunning back to true).
  useEffect(() => {
    const session = usePlanStore.getState().sessions[sessionKey];
    if (session?.isRunning) {
      setRunning(sessionKey, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — only run on mount

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
  const lastExitCode = session?.lastExitCode ?? null;
  const sessionModel = session?.model ?? null;

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

    // Add user message to store — skip if empty (execute first-send with no extra context)
    if (text) {
      appendUserMessage(sessionKey, text);
    }
    setInputText("");
    // Reset textarea height after clearing
    if (inputRef.current) inputRef.current.style.height = "auto";
    userScrolledRef.current = false;

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
        const base = buildFirstExecutionMessage(task, rawContent);
        message = text
          ? `${base}\n\n## Additional Context from User\n\n${text}`
          : base;
      } else {
        message = buildFirstPlanMessage(task, text, rawContent);
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
    window.api.plan.cancel({ taskId: task.id, mode });
  }

  // ── New session ─────────────────────────────────────────────

  function handleNewSession(): void {
    // Cancel any in-flight run before clearing
    window.api.plan.cancel({ taskId: task.id, mode });
    clearSession(sessionKey);
    // Clear from frontmatter (mode-appropriate fields)
    if (workspacePath) {
      if (mode === "execute") {
        updateTask(task.filePath, {
          execSessionId: null,
          execSessionAgent: null,
          execModel: null,
        });
      } else {
        updateTask(task.filePath, {
          planSessionId: null,
          planSessionAgent: null,
          planModel: null,
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

  // ── Model change (only before session starts) ───────────────

  function handleModelChange(newModel: string): void {
    if (hasSession || isRunning) return;
    setModel(newModel);
  }

  // ── Auto-resize textarea ─────────────────────────────────────

  const resizeTextarea = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);

  // ── File autocomplete ──────────────────────────────────────────

  const tree = useFileStore((s) => s.tree);
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
      setDropdownPosition({
        top: rect.height + 4,
        left: 0,
      });
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

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    const value = e.target.value;
    setInputText(value);
    resizeTextarea();

    const cursorPos = e.target.selectionStart ?? value.length;
    const pos = findAtPosition(value, cursorPos);
    if (pos) {
      setShowDropdown(true);
      setSelectedIndex(0);
    } else {
      setShowDropdown(false);
    }
  }

  function handleInputKeyDown(
    e: React.KeyboardEvent<HTMLTextAreaElement>,
  ): void {
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

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        !inputRef.current?.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ── Check for non-zero exit code in done messages ───────────

  const lastMsg = messages[messages.length - 1];
  const showExitWarning =
    lastMsg?.role === "agent" &&
    !lastMsg.isStreaming &&
    !isRunning &&
    ((lastExitCode != null && lastExitCode !== 0) ||
      (lastMsg.text === "" && messages.length > 0));

  const headerTitle =
    mode === "execute" ? "Execute with agent" : "Plan with agent";
  const emptyStatePlaceholder =
    mode === "execute"
      ? `Send a message to start executing this task with ${agent}...`
      : `Type a message to start planning this task with ${agent}`;
  const inputPlaceholder = isRunning
    ? "Waiting for agent..."
    : hasSession
      ? "Continue the conversation..."
      : mode === "execute"
        ? "Send a message to start executing (or leave blank for default prompt)..."
        : "Describe what you want to plan...";

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
          <select
            className={styles.modelSelect}
            value={model}
            onChange={(e) => handleModelChange(e.target.value)}
            disabled={hasSession || isRunning || modelsLoading}
          >
            <option value="">
              {modelsLoading ? "loading…" : "default model"}
            </option>
            {availableModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {hasSession && (
            <span className={styles.resumeIndicator}>Session active</span>
          )}
        </div>
        <div className={styles.headerRight}>
          {hasSession && (
            <button
              className={styles.newSessionBtn}
              onClick={handleNewSession}
              disabled={isRunning}
            >
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
              model={msg.role === "agent" ? sessionModel : null}
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
            . Is {agent} installed and on PATH?
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
            disabled={isRunning}
            rows={1}
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
