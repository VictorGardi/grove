import {
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import type { Part, PermissionRequest, QuestionRequest } from "@opencode-ai/sdk/v2";
import type { TaskInfo, PlanAgent } from "@shared/types";
import { useDataStore } from "../../stores/useDataStore";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { usePlanStore } from "../../stores/usePlanStore";
import { updateTask } from "../../actions/taskActions";
import {
  buildFirstExecutionMessage,
  buildFirstPlanMessage,
} from "../../utils/planPrompts";
import {
  createClient,
  parseModel,
  getEventSessionId,
  type OpencodeSdkClient,
} from "../../utils/opencodeClient";
import { EventMessage } from "./EventMessage";
import { QuestionCard } from "./QuestionCard";
import styles from "./TaskEventStream.module.css";

interface TaskEventStreamProps {
  taskId: string;
  mode: "plan" | "execute";
}

export interface MessageDisplay {
  id: string;
  role: "user" | "assistant";
  parts: Part[];
}

type SessionStatus = "idle" | "busy" | "retry";

function extractSessionStatus(status: unknown): SessionStatus {
  if (!status || typeof status !== "object") return "idle";
  const s = status as { type?: string };
  if (s.type === "busy" || s.type === "retry") return s.type;
  return "idle";
}

export function TaskEventStream({
  taskId,
  mode,
}: TaskEventStreamProps): React.JSX.Element {
  const task = useDataStore((s) => s.tasks.find((t) => t.id === taskId));
  const workspacePath = task?.workspacePath ?? "";
  const workspaceDefaults = useWorkspaceStore(
    (s) => s.workspaceDefaults[workspacePath] ?? null,
  );
  void workspaceDefaults; // used for future default agent/model selection

  const [messages, setMessages] = useState<MessageDisplay[]>([]);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("idle");
  const [permissionRequest, setPermissionRequest] =
    useState<PermissionRequest | null>(null);
  const [questionRequest, setQuestionRequest] =
    useState<QuestionRequest | null>(null);
  const [userInput, setUserInput] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const clientRef = useRef<OpencodeSdkClient | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const streamAbortRef = useRef<(() => void) | null>(null);

  // Agent + model selection
  const [selectedAgent, setSelectedAgent] = useState<PlanAgent>(
    ((mode === "execute" ? task?.execSessionAgent : task?.planSessionAgent) ??
      "opencode") as PlanAgent,
  );
  const [selectedModel, setSelectedModel] = useState<string>(
    (mode === "execute" ? task?.execModel : task?.planModel) ?? "",
  );

  const modelsCache = usePlanStore((s) => s.modelsCache);
  const ensureModels = usePlanStore((s) => s.ensureModels);
  const modelCacheKey = `${workspacePath}:${selectedAgent}`;
  const availableModels: string[] = Array.isArray(modelsCache[modelCacheKey])
    ? (modelsCache[modelCacheKey] as string[])
    : [];

  useEffect(() => {
    if (workspacePath && selectedAgent) {
      void ensureModels(workspacePath, selectedAgent);
    }
  }, [workspacePath, selectedAgent, ensureModels]);

  useEffect(() => {
    if (availableModels.length > 0 && !availableModels.includes(selectedModel)) {
      setSelectedModel(availableModels[0]);
    }
  }, [availableModels, selectedModel]);

  // Keep sessionIdRef in sync for use inside async closures
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Cleanup SSE stream on unmount
  useEffect(() => {
    return () => {
      streamAbortRef.current?.();
      streamAbortRef.current = null;
    };
  }, []);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // ── Event handling ────────────────────────────────────────────────

  const handleEvent = useCallback((event: unknown) => {
    const e = event as { type: string; properties: Record<string, unknown> };
    switch (e.type) {
      case "message.part.updated": {
        const { part } = e.properties as { part: Part; delta?: string };
        if (!part?.messageID) break;
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === part.messageID);
          if (idx === -1) {
            // First part for this message — create entry
            return [
              ...prev,
              { id: part.messageID, role: "assistant", parts: [part] },
            ];
          }
          const msg = prev[idx];
          const partIdx = msg.parts.findIndex((p) => p.id === part.id);
          const newParts =
            partIdx === -1
              ? [...msg.parts, part]
              : msg.parts.map((p, i) => (i === partIdx ? part : p));
          return prev.map((m, i) =>
            i === idx ? { ...m, parts: newParts } : m,
          );
        });
        break;
      }
      case "message.updated": {
        const info = (e.properties as { info?: Record<string, unknown> })?.info;
        if (!info?.id) break;
        const msgId = String(info.id);
        const role = (info.role as "user" | "assistant") ?? "assistant";
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === msgId);
          if (idx === -1) {
            return [...prev, { id: msgId, role, parts: [] }];
          }
          return prev.map((m, i) => (i === idx ? { ...m, role } : m));
        });
        break;
      }
      case "session.status": {
        const { status } = e.properties as {
          sessionID: string;
          status: unknown;
        };
        setSessionStatus(extractSessionStatus(status));
        break;
      }
      case "session.idle": {
        setSessionStatus("idle");
        break;
      }
      case "permission.asked": {
        setPermissionRequest(e.properties as unknown as PermissionRequest);
        break;
      }
      case "question.asked": {
        setQuestionRequest(e.properties as unknown as QuestionRequest);
        break;
      }
      case "session.error": {
        const msg =
          (e.properties as { message?: string }).message ?? "Session error";
        setErrorMsg(msg);
        break;
      }
      default: {
        console.log("[TaskEventStream] Unknown event type:", e.type);
      }
    }
  }, []);

  // ── Session start ─────────────────────────────────────────────────

  const startSubscription = useCallback(
    async (
      client: OpencodeSdkClient,
      directory: string,
      targetSessionId: string,
    ) => {
      const sseResult = await client.event.subscribe({ directory });
      const stream = sseResult.stream;
      let cancelled = false;

      streamAbortRef.current = () => {
        cancelled = true;
        void stream.return(undefined);
      };

      // Background event loop — runs until stream ends or cancelled
      void (async () => {
        try {
          for await (const event of stream) {
            if (cancelled) break;
            // Filter by session ID
            const evtSessionId = getEventSessionId(event);
            if (evtSessionId && evtSessionId !== targetSessionId) continue;
            handleEvent(event);
          }
        } catch (err) {
          if (!cancelled) {
            console.error("[TaskEventStream] SSE stream error:", err);
          }
        }
      })();
    },
    [handleEvent],
  );

  const startSession = useCallback(
    async (promptText?: string) => {
      if (!task) return;

      setIsStarting(true);
      setErrorMsg(null);

      try {
        // Get server URL from main process
        const serverResult = await window.api.opencodeServer.ensure();
        if ("error" in serverResult) {
          throw new Error(serverResult.error);
        }

        const url = serverResult.url;
        const client = createClient(url);
        clientRef.current = client;

        const directory = task.worktree ?? workspacePath;

        // Create session
        const sessionResult = await client.session.create({ directory });
        if (sessionResult.error) {
          throw new Error(
            String(sessionResult.error.data ?? "Session creation failed"),
          );
        }
        const sid = sessionResult.data.id;
        setSessionId(sid);
        sessionIdRef.current = sid;

        // Persist session ID + agent/model to task frontmatter
        const frontmatterUpdate: Partial<TaskInfo> = {
          execSessionId: sid,
        };
        if (mode === "execute") {
          frontmatterUpdate.execSessionAgent = selectedAgent;
          frontmatterUpdate.execModel = selectedModel || null;
        } else {
          frontmatterUpdate.planSessionAgent = selectedAgent;
          frontmatterUpdate.planModel = selectedModel || null;
        }
        await updateTask(task.filePath, frontmatterUpdate);

        // Start event subscription BEFORE sending prompt
        await startSubscription(client, directory, sid);

        // Build and send the initial prompt
        let actualPrompt: string;
        if (promptText !== undefined) {
          if (mode === "execute") {
            const rawResult = await window.api.tasks.readRaw(
              workspacePath,
              task.filePath,
            );
            const taskContent = rawResult.ok ? rawResult.data : task.description ?? "";
            actualPrompt = buildFirstExecutionMessage(task, taskContent);
          } else {
            const rawResult = await window.api.tasks.readRaw(
              workspacePath,
              task.filePath,
            );
            const taskContent = rawResult.ok ? rawResult.data : "";
            actualPrompt = buildFirstPlanMessage(task, promptText, taskContent);
          }
        } else if (mode === "execute") {
          // No user text provided — build execution prompt from task content
          const rawResult = await window.api.tasks.readRaw(
            workspacePath,
            task.filePath,
          );
          const taskContent = rawResult.ok ? rawResult.data : task.description ?? "";
          actualPrompt = buildFirstExecutionMessage(task, taskContent);
        } else {
          return; // plan mode with no text — wait for user input
        }

        // Optimistic user message
        if (mode === "plan") {
          setMessages((prev) => [
            ...prev,
            {
              id: `user-opt-${Date.now()}`,
              role: "user",
              parts: [
                {
                  type: "text",
                  id: `upart-${Date.now()}`,
                  sessionID: sid,
                  messageID: `umsg-${Date.now()}`,
                  text: actualPrompt,
                } as Part,
              ],
            },
          ]);
        }

        // Send prompt (async — returns immediately, events arrive via SSE)
        const model = parseModel(selectedModel);
        await client.session.promptAsync({
          sessionID: sid,
          directory,
          parts: [{ type: "text", text: actualPrompt }],
          ...(model ? { model } : {}),
        });

        // Mark context as sent
        const contextField =
          mode === "execute"
            ? "terminalExecContextSent"
            : "terminalPlanContextSent";
        await updateTask(task.filePath, {
          [contextField]: true,
        } as Partial<TaskInfo>);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setSessionStatus("idle");
      } finally {
        setIsStarting(false);
      }
    },
    [
      task,
      workspacePath,
      mode,
      selectedAgent,
      selectedModel,
      startSubscription,
    ],
  );

  // ── Follow-up message (session already running) ───────────────────

  const sendMessage = useCallback(
    async (text: string) => {
      if (!clientRef.current || !sessionIdRef.current) return;
      const sid = sessionIdRef.current;
      const directory = task?.worktree ?? workspacePath;

      // Optimistic user message
      setMessages((prev) => [
        ...prev,
        {
          id: `user-opt-${Date.now()}`,
          role: "user",
          parts: [
            {
              type: "text",
              id: `upart-${Date.now()}`,
              sessionID: sid,
              messageID: `umsg-${Date.now()}`,
              text,
            } as Part,
          ],
        },
      ]);

      try {
        const model = parseModel(selectedModel);
        await clientRef.current.session.promptAsync({
          sessionID: sid,
          directory,
          parts: [{ type: "text", text }],
          ...(model ? { model } : {}),
        });
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    },
    [task, workspacePath, selectedModel],
  );

  // ── UI handlers ───────────────────────────────────────────────────

  const handleSend = useCallback(() => {
    if (!userInput.trim() || sessionStatus === "busy") return;
    const text = userInput.trim();
    setUserInput("");

    if (!sessionId) {
      void startSession(text);
    } else {
      void sendMessage(text);
    }
  }, [userInput, sessionStatus, sessionId, startSession, sendMessage]);

  const handleStop = useCallback(() => {
    if (!clientRef.current || !sessionIdRef.current) return;
    const directory = task?.worktree ?? workspacePath;
    void clientRef.current.session.abort({
      sessionID: sessionIdRef.current,
      directory,
    });
  }, [task, workspacePath]);

  const handlePermissionResponse = useCallback(
    async (decision: "allow" | "deny") => {
      if (!permissionRequest || !clientRef.current) return;
      const directory = task?.worktree ?? workspacePath;
      await clientRef.current.permission.reply({
        requestID: permissionRequest.id,
        directory,
        reply: decision === "allow" ? "once" : "reject",
      });
      setPermissionRequest(null);
    },
    [permissionRequest, task, workspacePath],
  );

  const handleQuestionReply = useCallback(
    async (answers: string[][]) => {
      if (!questionRequest || !clientRef.current) return;
      const directory = task?.worktree ?? workspacePath;
      await clientRef.current.question.reply({
        requestID: questionRequest.id,
        directory,
        answers,
      });
      setQuestionRequest(null);
    },
    [questionRequest, task, workspacePath],
  );

  const handleQuestionReject = useCallback(async () => {
    if (!questionRequest || !clientRef.current) return;
    const directory = task?.worktree ?? workspacePath;
    await clientRef.current.question.reject({
      requestID: questionRequest.id,
      directory,
    });
    setQuestionRequest(null);
  }, [questionRequest, task, workspacePath]);

  // ── Render ────────────────────────────────────────────────────────

  const effectiveAgent = selectedAgent;
  const hasSession = !!sessionId;
  const isBusy = sessionStatus === "busy" || isStarting;
  const canSend = userInput.trim().length > 0 && !isBusy;

  return (
    <div className={styles.wrapper}>
      {/* Messages area */}
      <div className={styles.eventContainer}>
        {messages.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>&#x1F4AC;</div>
            <div className={styles.emptyText}>
              {mode === "execute"
                ? `Ready to execute with ${effectiveAgent}`
                : "Ask a question or describe what you need help with"}
            </div>
            {mode === "execute" && !hasSession && (
              <button
                className={styles.startButton}
                onClick={() => void startSession()}
                disabled={isStarting}
              >
                {isStarting ? "Starting..." : `Start execution with ${effectiveAgent}`}
              </button>
            )}
          </div>
        ) : (
          <div className={styles.messageList}>
            {messages.map((msg) => (
              <EventMessage
                key={msg.id}
                message={msg}
                suppressQuestionJson={!!questionRequest}
              />
            ))}
          </div>
        )}

        {questionRequest && (
          <QuestionCard
            request={questionRequest}
            onReply={handleQuestionReply}
            onReject={handleQuestionReject}
          />
        )}

        {permissionRequest && (
          <div className={styles.permissionDialog}>
            <span className={styles.permissionIcon}>&#x26A0;</span>
            <div className={styles.permissionContent}>
              <span className={styles.permissionText}>
                Permission requested: <strong>{permissionRequest.permission}</strong>
              </span>
              {permissionRequest.patterns.length > 0 && (
                <div className={styles.permissionPatterns}>
                  {permissionRequest.patterns.join(", ")}
                </div>
              )}
            </div>
            <div className={styles.permissionButtons}>
              <button
                className={`${styles.permissionButton} ${styles.permissionAllow}`}
                onClick={() => void handlePermissionResponse("allow")}
              >
                Allow
              </button>
              <button
                className={`${styles.permissionButton} ${styles.permissionDeny}`}
                onClick={() => void handlePermissionResponse("deny")}
              >
                Deny
              </button>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Agent + Model selectors */}
      <div className={styles.controlsBar}>
        <select
          className={styles.controlSelect}
          value={selectedAgent}
          onChange={(e) => setSelectedAgent(e.target.value as PlanAgent)}
          disabled={hasSession}
        >
          <option value="opencode">opencode</option>
          <option value="copilot">copilot</option>
          <option value="claude">claude</option>
        </select>

        <select
          className={styles.controlSelect}
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          disabled={hasSession || availableModels.length === 0}
        >
          {availableModels.length === 0 && (
            <option value="">Loading models...</option>
          )}
          {availableModels.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        {isBusy && (
          <span
            className={
              questionRequest ? styles.waitingBadge : styles.thinkingBadge
            }
          >
            {questionRequest ? "Waiting for your answer…" : "Thinking..."}
          </span>
        )}
        {sessionStatus === "retry" && (
          <span className={styles.statusRetry}>Retrying...</span>
        )}
      </div>

      {/* Input area */}
      <div className={styles.inputArea}>
        <textarea
          ref={textareaRef}
          className={styles.inputTextarea}
          placeholder={
            !hasSession && mode === "execute"
              ? "Click 'Start execution' to begin..."
              : "Type your message... (⌘↵ to send)"
          }
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              handleSend();
            }
          }}
          disabled={isBusy || (!hasSession && mode === "execute")}
          autoFocus
          rows={3}
        />
        <div className={styles.inputFooter}>
          <span className={styles.inputHint}>⌘↵ to send</span>
          {isBusy ? (
            <button className={styles.stopButton} onClick={handleStop}>
              Stop
            </button>
          ) : (
            <button
              className={styles.sendButton}
              onClick={handleSend}
              disabled={!canSend}
            >
              Send
            </button>
          )}
        </div>
      </div>

      {/* Status bar */}
      {errorMsg && (
        <div className={styles.statusBar}>
          <span
            className={styles.statusError}
            title={errorMsg}
          >
            Error:{" "}
            {errorMsg.length > 80 ? errorMsg.slice(0, 80) + "…" : errorMsg}
          </span>
        </div>
      )}
    </div>
  );
}
