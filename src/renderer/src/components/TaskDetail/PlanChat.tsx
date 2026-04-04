import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { usePlanStore } from "../../stores/usePlanStore";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { updateTask } from "../../actions/taskActions";
import type { TaskInfo, PlanAgent, PlanMessage } from "@shared/types";
import styles from "./PlanChat.module.css";

// ── Planning prompt builder ─────────────────────────────────────

function buildFirstMessage(
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

// ── Model placeholder per agent ─────────────────────────────────

// (model list loaded dynamically via IPC)

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
  onClose: () => void;
}

export function PlanChat({ task, onClose }: PlanChatProps): React.JSX.Element {
  const workspacePath = useWorkspaceStore((s) => s.activeWorkspacePath);
  const session = usePlanStore((s) => s.sessions[task.id]);
  const initSession = usePlanStore((s) => s.initSession);
  const appendUserMessage = usePlanStore((s) => s.appendUserMessage);
  const startAgentMessage = usePlanStore((s) => s.startAgentMessage);
  const clearSession = usePlanStore((s) => s.clearSession);

  const [inputText, setInputText] = useState("");
  const [agent, setAgent] = useState<PlanAgent>(
    task.planSessionAgent ?? "opencode",
  );
  const [model, setModel] = useState<string>(task.planModel ?? "");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
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

  // Initialise session on mount
  useEffect(() => {
    initSession(task.id, agent, model || null, task.planSessionId);
  }, [task.id, agent, model, task.planSessionId, initSession]);

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

  // Cancel agent on unmount
  useEffect(() => {
    return () => {
      if (usePlanStore.getState().sessions[task.id]?.isRunning) {
        window.api.plan.cancel(task.id);
      }
    };
  }, [task.id]);

  const isRunning = session?.isRunning ?? false;
  const hasSession = !!session?.sessionId;
  const messages = session?.messages ?? [];
  const lastExitCode = session?.lastExitCode ?? null;
  const sessionModel = session?.model ?? null;

  // ── Send message ────────────────────────────────────────────

  async function handleSend(): Promise<void> {
    const text = inputText.trim();
    if (!text || !workspacePath || isRunning) return;

    // Add user message to store
    appendUserMessage(task.id, text);
    setInputText("");
    // Reset textarea height after clearing
    if (inputRef.current) inputRef.current.style.height = "auto";
    userScrolledRef.current = false;

    // Prepare the agent message slot
    startAgentMessage(task.id);

    // Build the actual prompt
    let message: string;
    const sessionId = session?.sessionId ?? null;

    if (!sessionId) {
      // First message — assemble full planning prompt
      try {
        const rawResult = await window.api.tasks.readRaw(
          workspacePath,
          task.filePath,
        );
        const rawContent = rawResult.ok ? rawResult.data : "";
        message = buildFirstMessage(task, text, rawContent);
      } catch {
        message = buildFirstMessage(task, text, "");
      }
    } else {
      // Follow-up — just send plain text
      message = text;
    }

    const result = await window.api.plan.send({
      taskId: task.id,
      agent,
      model: model || null,
      message,
      sessionId,
      workspacePath,
      taskFilePath: task.filePath,
    });
    if (!result.ok) {
      console.error("[PlanChat] plan.send failed:", result.error);
    }
  }

  // ── Cancel ──────────────────────────────────────────────────

  function handleCancel(): void {
    window.api.plan.cancel(task.id);
  }

  // ── New session ─────────────────────────────────────────────

  function handleNewSession(): void {
    // Cancel any in-flight run before clearing
    window.api.plan.cancel(task.id);
    clearSession(task.id);
    // Clear from frontmatter
    if (workspacePath) {
      updateTask(task.filePath, {
        planSessionId: null,
        planSessionAgent: null,
        planModel: null,
      });
    }
    // Re-init fresh session
    initSession(task.id, agent, model || null, null);
  }

  // ── Agent change (only before session starts) ───────────────

  function handleAgentChange(newAgent: PlanAgent): void {
    if (hasSession || isRunning) return;
    setAgent(newAgent);
    clearSession(task.id);
    initSession(task.id, newAgent, model || null, null);
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

  // ── Key handler ─────────────────────────────────────────────

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  // ── Check for non-zero exit code in done messages ───────────

  const lastMsg = messages[messages.length - 1];
  const showExitWarning =
    lastMsg?.role === "agent" &&
    !lastMsg.isStreaming &&
    !isRunning &&
    ((lastExitCode != null && lastExitCode !== 0) ||
      (lastMsg.text === "" && messages.length > 0));

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.headerTitle}>Plan with agent</span>
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
        {messages.length === 0 ? (
          <div className={styles.emptyState}>
            Type a message to start planning this task with {agent}
          </div>
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
        <textarea
          ref={inputRef}
          className={styles.inputField}
          value={inputText}
          onChange={(e) => {
            setInputText(e.target.value);
            resizeTextarea();
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            isRunning
              ? "Waiting for agent..."
              : hasSession
                ? "Continue the conversation..."
                : "Describe what you want to plan..."
          }
          disabled={isRunning}
          rows={1}
        />
        {isRunning ? (
          <button className={styles.cancelBtn} onClick={handleCancel}>
            Cancel
          </button>
        ) : (
          <button
            className={styles.sendBtn}
            onClick={() => void handleSend()}
            disabled={!inputText.trim()}
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
