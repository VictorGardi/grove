import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import type { Part, PermissionRequest, QuestionRequest } from "@opencode-ai/sdk/v2";
import type { TaskInfo } from "@shared/types";
import { useDataStore } from "../../stores/useDataStore";
import { usePlanStore } from "../../stores/usePlanStore";
import { updateTask } from "../../actions/taskActions";
import {
  createClient,
  parseModel,
  getEventSessionId,
  type OpencodeSdkClient,
} from "../../utils/opencodeClient";
import { EventMessage } from "./EventMessage";
import { QuestionCard } from "./QuestionCard";
import {
  CommandAutocomplete,
  ModelSelector,
  SessionSelector,
  type CommandInfo,
} from "./CommandAutocomplete";
import { WorkingPlaceholder } from "./WorkingPlaceholder";
import { groupMessagesIntoTurns } from "./TurnGroup";
import { SessionPicker } from "./SessionPicker";
import styles from "./TaskEventStream.module.css";

interface TaskEventStreamProps {
  taskId: string;
  mode: "plan" | "execute";
}

export interface MessageDisplay {
  id: string;
  role: "user" | "assistant";
  parts: Part[];
  agentMode?: "plan" | "execute";
  agentModel?: string;
}

type SessionStatus = "idle" | "busy" | "retry";

function extractSessionStatus(status: unknown): SessionStatus {
  if (!status || typeof status !== "object") return "idle";
  const s = status as { type?: string };
  if (s.type === "busy" || s.type === "retry") return s.type;
  return "idle";
}

const SLASH_COMMANDS: CommandInfo[] = [
  { name: "model", description: "Select AI model", icon: "M" },
  { name: "session", description: "Switch session", icon: "S" },
];

export function TaskEventStream({
  taskId,
  mode,
}: TaskEventStreamProps): React.JSX.Element {
  const task = useDataStore((s) => s.tasks.find((t) => t.id === taskId));
  const workspacePath = task?.workspacePath ?? "";

  const [activeMode, setActiveMode] = useState<"plan" | "execute">(mode);

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
  const [isWaitingForAgent, setIsWaitingForAgent] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const [slashState, setSlashState] = useState<null | "commands" | "models" | "sessions">(null);
  const [slashQuery, setSlashQuery] = useState("");
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 300 });
  const [showSessionPicker, setShowSessionPicker] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputBoxRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<OpencodeSdkClient | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const streamAbortRef = useRef<(() => void) | null>(null);
  const skippedUserMessageIdsRef = useRef<Set<string>>(new Set());
  // Guard: only attempt reattachment once per task id to prevent double-subscription
  const reattachedForTaskRef = useRef<string | null>(null);

  const [selectedModel, setSelectedModel] = useState<string>(
    (mode === "execute" ? task?.execModel : task?.planModel) ?? "",
  );

  const modelsCache = usePlanStore((s) => s.modelsCache);
  const ensureModels = usePlanStore((s) => s.ensureModels);
  const modelCacheKey = `${workspacePath}:opencode`;
  const availableModels: string[] = Array.isArray(modelsCache[modelCacheKey])
    ? (modelsCache[modelCacheKey] as string[])
    : [];

  useEffect(() => {
    if (workspacePath) {
      void ensureModels(workspacePath, "opencode");
    }
  }, [workspacePath, ensureModels]);

  useEffect(() => {
    if (availableModels.length > 0 && !availableModels.includes(selectedModel)) {
      setSelectedModel(availableModels[0]);
    }
  }, [availableModels, selectedModel]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    return () => {
      streamAbortRef.current?.();
      streamAbortRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 150;
    setShowScrollButton(!isNearBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const handleEvent = useCallback((event: unknown) => {
    const e = event as { type: string; properties: Record<string, unknown> };

    switch (e.type) {
      case "message.part.updated": {
        const { part } = e.properties as { part: Part };
        if (!part?.messageID) break;

        // Skip if this is a user message we already added locally
        if (skippedUserMessageIdsRef.current.has(part.messageID)) break;

        setMessages((prev) => {
          const existingIdx = prev.findIndex((m) => m.id === part.messageID);

          if (existingIdx === -1) {
            return [
              ...prev,
              { id: part.messageID, role: "assistant", parts: [part] },
            ];
          }

          const msg = prev[existingIdx];
          const partIdx = msg.parts.findIndex((p) => p.id === part.id);

          // Skip if this exact part already exists (duplicate during replay)
          if (partIdx !== -1) return prev;

          const newParts = [...msg.parts, part];
          return prev.map((m, i) =>
            i === existingIdx ? { ...m, parts: newParts } : m,
          );
        });

        if (part?.type === "text" && part.text?.trim()) {
          setIsWaitingForAgent(false);
        }
        break;
      }
      case "message.part.delta": {
        const props = e.properties as { messageID: string; partID: string; field: string; delta: string };
        if (!props.messageID || !props.partID || props.field !== "text") break;
        setIsWaitingForAgent(false);
        setMessages((prev) => {
          const msgIdx = prev.findIndex((m) => m.id === props.messageID);
          if (msgIdx === -1) return prev;
          const msg = prev[msgIdx];
          const partIdx = msg.parts.findIndex((p) => p.id === props.partID);
          if (partIdx === -1) return prev;
          const part = msg.parts[partIdx];
          if (part.type !== "text") return prev;
          const newPart = { ...part, text: (part.text || "") + props.delta };
          return prev.map((m, i) =>
            i === msgIdx ? { ...m, parts: msg.parts.map((p, j) => j === partIdx ? newPart : p) } : m,
          );
        });
        break;
      }
      case "message.updated": {
        const info = (e.properties as { info?: Record<string, unknown> })?.info;
        if (!info?.id) break;
        const msgId = String(info.id);
        const role = (info.role as "user" | "assistant") ?? "assistant";

        // Only create assistant messages from server events - user messages are added locally
        if (role === "user") {
          skippedUserMessageIdsRef.current.add(msgId);
          break;
        }

        setMessages((prev) => {
          const exists = prev.some((m) => m.id === msgId);
          if (exists) return prev;
          return [...prev, { id: msgId, role, parts: [], agentMode: activeMode, agentModel: selectedModel }];
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
        setIsWaitingForAgent(false);
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
        setIsWaitingForAgent(false);
        break;
      }
      default:
        break;
    }
  }, [activeMode, selectedModel]);

  // Stable ref to always-current handleEvent — lets startSubscription have no deps
  const handleEventRef = useRef(handleEvent);
  useEffect(() => {
    handleEventRef.current = handleEvent;
  }, [handleEvent]);

  // Stable subscription starter — no deps so the reattachment effect doesn't re-fire
  // when activeMode/selectedModel change
  const startSubscription = useCallback(
    async (
      client: OpencodeSdkClient,
      directory: string,
      targetSessionId: string,
    ) => {
      // Cancel any existing stream before opening a new one
      streamAbortRef.current?.();
      streamAbortRef.current = null;

      const sseResult = await client.event.subscribe({ directory });
      const stream = sseResult.stream;
      let cancelled = false;

      streamAbortRef.current = () => {
        cancelled = true;
        void stream.return(undefined);
      };

      void (async () => {
        try {
          for await (const event of stream) {
            if (cancelled) break;
            const evtSessionId = getEventSessionId(event);
            if (evtSessionId && evtSessionId !== targetSessionId) continue;
            handleEventRef.current(event);
          }
        } catch (err) {
          if (!cancelled) {
            console.error("[TaskEventStream] SSE stream error:", err);
          }
        }
      })();
    },
    [], // stable — no deps
  );

  // Try to reconnect to existing session on mount (once per task id)
  useEffect(() => {
    if (!task) return;

    // Only run once per task — prevents double-subscription when selectedModel
    // updates and causes handleEvent/startSubscription to get new references
    if (reattachedForTaskRef.current === task.id) return;
    reattachedForTaskRef.current = task.id;

    const sessionIds = task.sessionIds || [];
    const lastSessionId = task.lastSessionId;

    if (sessionIds.length === 0) return;

    // Multiple sessions without a clear last-used → show picker for user to choose
    if (sessionIds.length > 1 && !lastSessionId) {
      setShowSessionPicker(true);
      return;
    }

    const sessionToConnect = lastSessionId || sessionIds[0];
    if (!sessionToConnect) return;

    const directory = task.worktree ?? workspacePath;

    const tryReattach = async () => {
      try {
        const serverResult = await window.api.opencodeServer.ensure();
        if ("error" in serverResult) return;

        const client = createClient(serverResult.url);
        // Critical: set clientRef so sendMessage works after reattachment
        clientRef.current = client;

        await startSubscription(client, directory, sessionToConnect);
        setSessionId(sessionToConnect);
        sessionIdRef.current = sessionToConnect;
        console.log("[TaskEventStream] Reattached to session:", sessionToConnect);

        // Load message history from the session
        const historyResult = await client.session.messages({
          sessionID: sessionToConnect,
        });
        console.log("[TaskEventStream] History result:", historyResult);
        if (!historyResult.error && historyResult.data) {
          console.log("[TaskEventStream] Loading", historyResult.data.length, "messages from history");
          const historyMessages: MessageDisplay[] = historyResult.data.map((msg) => ({
            id: msg.info.id,
            role: msg.info.role as "user" | "assistant",
            parts: msg.parts,
          }));
          setMessages(historyMessages);
        }
      } catch (err) {
        console.error("[TaskEventStream] Failed to reattach to session:", err);
      }
    };

    void tryReattach();
  }, [task, workspacePath, startSubscription]);

  const startSession = useCallback(
    async (promptText?: string) => {
      if (!task) return;

      setIsStarting(true);
      setErrorMsg(null);

      try {
        const serverResult = await window.api.opencodeServer.ensure();
        if ("error" in serverResult) {
          throw new Error(serverResult.error);
        }

        const url = serverResult.url;
        const client = createClient(url);
        clientRef.current = client;

        const directory = task.worktree ?? workspacePath;

        const sessionResult = await client.session.create({ directory });
        if (sessionResult.error) {
          throw new Error(
            String(sessionResult.error.data ?? "Session creation failed"),
          );
        }
        const sid = sessionResult.data.id;
        setSessionId(sid);
        sessionIdRef.current = sid;

        // Update task frontmatter with new session
        const currentSessionIds = task.sessionIds || [];
        const frontmatterUpdate: Partial<TaskInfo> = {
          sessionIds: [...currentSessionIds, sid],
          lastSessionId: sid,
        };
        if (activeMode === "execute") {
          frontmatterUpdate.execSessionId = sid;
          frontmatterUpdate.execSessionAgent = "opencode";
          frontmatterUpdate.execModel = selectedModel || null;
        } else {
          frontmatterUpdate.planSessionId = sid;
          frontmatterUpdate.planSessionAgent = "opencode";
          frontmatterUpdate.planModel = selectedModel || null;
        }
        await updateTask(task.filePath, frontmatterUpdate);

        await startSubscription(client, directory, sid);

        const actualPrompt = promptText ?? "";
        if (!actualPrompt) return;

        setMessages((prev) => [
          ...prev,
          {
            id: `user-${Date.now()}`,
            role: "user",
            parts: [
              {
                type: "text",
                id: `utext-${Date.now()}`,
                sessionID: sid,
                messageID: `umsg-${Date.now()}`,
                text: actualPrompt,
              } as Part,
            ],
            agentMode: activeMode,
            agentModel: selectedModel,
          },
        ]);

        const model = parseModel(selectedModel);
        await client.session.promptAsync({
          sessionID: sid,
          directory,
          parts: [{ type: "text", text: actualPrompt }],
          variant: activeMode,
          ...(model ? { model } : {}),
        });
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setSessionStatus("idle");
      } finally {
        setIsStarting(false);
        setIsWaitingForAgent(false);
      }
    },
    [task, workspacePath, activeMode, selectedModel, startSubscription],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      if (!clientRef.current || !sessionIdRef.current) return;
      const sid = sessionIdRef.current;
      const directory = task?.worktree ?? workspacePath;

      setMessages((prev) => [
        ...prev,
        {
          id: `user-${Date.now()}`,
          role: "user",
          parts: [
            {
              type: "text",
              id: `utext-${Date.now()}`,
              sessionID: sid,
              messageID: `umsg-${Date.now()}`,
              text,
            } as Part,
          ],
          agentMode: activeMode,
          agentModel: selectedModel,
        },
      ]);

      try {
        const model = parseModel(selectedModel);
        await clientRef.current.session.promptAsync({
          sessionID: sid,
          directory,
          parts: [{ type: "text", text }],
          variant: activeMode,
          ...(model ? { model } : {}),
        });
      } catch (err) {
        setIsWaitingForAgent(false);
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    },
    [task, workspacePath, activeMode, selectedModel],
  );

  const handleModeSwitch = useCallback(
    (newMode: "plan" | "execute") => {
      if (newMode === activeMode) return;

      const taskData = useDataStore.getState().tasks.find((t) => t.id === taskId);
      if (taskData) {
        setSelectedModel(
          (newMode === "execute" ? taskData.execModel : taskData.planModel) ?? "",
        );
      }

      setActiveMode(newMode);
    },
    [activeMode, taskId],
  );

  const computeDropdownPos = useCallback(() => {
    if (!inputBoxRef.current) return;
    const rect = inputBoxRef.current.getBoundingClientRect();
    setDropdownPos({ top: rect.top - 8, left: rect.left, width: rect.width });
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      setUserInput(val);

      if (val === "/") {
        computeDropdownPos();
        setSlashState("commands");
        setSlashQuery("");
      } else if (val.startsWith("/") && !val.includes(" ") && !val.includes("\n")) {
        computeDropdownPos();
        setSlashState("commands");
        setSlashQuery(val.slice(1));
      } else {
        setSlashState(null);
        setSlashQuery("");
      }
    },
    [computeDropdownPos],
  );

  const handleCommandSelect = useCallback(
    (cmd: string) => {
      if (cmd === "model") {
        computeDropdownPos();
        setSlashState("models");
        setSlashQuery("");
        setUserInput("");
      } else if (cmd === "session") {
        computeDropdownPos();
        const sessionIds = task?.sessionIds ?? [];
        if (sessionIds.length > 0) {
          setSlashState("sessions");
        } else {
          // No sessions yet — start one directly
          void startSession();
        }
        setSlashQuery("");
        setUserInput("");
      }
    },
    [computeDropdownPos, task, startSession],
  );

  const handleSlashModelSelect = useCallback((model: string) => {
    setSelectedModel(model);
    setSlashState(null);
    setSlashQuery("");
    setUserInput("");
    textareaRef.current?.focus();
  }, []);

  const handleSlashClose = useCallback(() => {
    setSlashState(null);
    setSlashQuery("");
    setUserInput("");
  }, []);

  const handleSessionSelect = useCallback(async (selectedSessionId: string) => {
    if (!task) return;

    setShowSessionPicker(false);
    setMessages([]);
    setSessionId(selectedSessionId);
    sessionIdRef.current = selectedSessionId;

    // Update lastSessionId so next mount reconnects here
    await updateTask(task.filePath, { lastSessionId: selectedSessionId });

    const directory = task.worktree ?? workspacePath;
    try {
      const serverResult = await window.api.opencodeServer.ensure();
      if ("error" in serverResult) return;

      const client = createClient(serverResult.url);
      // Critical: set clientRef so sendMessage works after switching sessions
      clientRef.current = client;

      await startSubscription(client, directory, selectedSessionId);
    } catch (err) {
      console.error("[TaskEventStream] Failed to switch session:", err);
    }
  }, [task, workspacePath, startSubscription]);

  const handleNewSessionFromPicker = useCallback(() => {
    setShowSessionPicker(false);
    void startSession();
  }, [startSession]);

  const handleSend = useCallback(() => {
    if (!userInput.trim() || sessionStatus === "busy") return;
    const text = userInput.trim();
    setUserInput("");
    setIsWaitingForAgent(true);

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

  const hasSession = !!sessionId;
  const isBusy = sessionStatus === "busy" || isStarting || isWaitingForAgent;
  const canSend = userInput.trim().length > 0 && !isBusy && !slashState;

  const turns = useMemo(() => groupMessagesIntoTurns(messages), [messages]);

  return (
    <div className={styles.wrapper}>
      {slashState === "commands" && (
        <CommandAutocomplete
          query={slashQuery}
          commands={SLASH_COMMANDS}
          onSelect={handleCommandSelect}
          onClose={handleSlashClose}
          position={dropdownPos}
        />
      )}
      {slashState === "models" && (
        <ModelSelector
          models={availableModels}
          onSelect={handleSlashModelSelect}
          onClose={handleSlashClose}
          position={dropdownPos}
        />
      )}
      {slashState === "sessions" && task && (
        <SessionSelector
          sessionIds={task.sessionIds ?? []}
          directory={task.worktree ?? workspacePath}
          onSelect={(id) => { setSlashState(null); void handleSessionSelect(id); }}
          onNewSession={() => { setSlashState(null); void startSession(); }}
          onClose={handleSlashClose}
          position={dropdownPos}
        />
      )}

      {showSessionPicker && task && (
        <SessionPicker
          sessionIds={task.sessionIds || []}
          directory={task.worktree ?? workspacePath}
          onSelect={handleSessionSelect}
          onNewSession={handleNewSessionFromPicker}
          onClose={() => setShowSessionPicker(false)}
        />
      )}

      <div className={styles.eventContainer} ref={scrollContainerRef} onScroll={handleScroll}>
        {messages.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyText}>
              {activeMode === "execute"
                ? "Ready to execute"
                : "Ask a question or describe what you need help with"}
            </div>
            {activeMode === "execute" && !hasSession && (
              <button
                className={styles.startButton}
                onClick={() => void startSession()}
                disabled={isStarting}
              >
                {isStarting ? "Starting..." : "Start execution"}
              </button>
            )}
          </div>
        ) : (
          <div className={styles.messageList}>
            {turns.map((turn, turnIdx) => (
              <div key={turn.id} className={styles.turnGroup}>
                {turn.userMessage && (
                  <EventMessage
                    message={turn.userMessage}
                    isNew={turnIdx === turns.length - 1}
                  />
                )}
                {turn.assistantMessages.map((msg, msgIdx) => (
                  <EventMessage
                    key={msg.id}
                    message={msg}
                    agentMode={msg.agentMode ?? activeMode}
                    agentModel={msg.agentModel ?? selectedModel}
                    showBusyDots={sessionStatus !== "idle" && msgIdx === turn.assistantMessages.length - 1}
                    isNew={turnIdx === turns.length - 1 && msgIdx === turn.assistantMessages.length - 1}
                  />
                ))}
              </div>
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
            <span className={styles.permissionIcon}>!</span>
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

        {showScrollButton && (
          <button className={styles.scrollFab} onClick={scrollToBottom}>
            Scroll to bottom
          </button>
        )}
      </div>

      <div className={styles.inputArea}>
        <div className={styles.inputBoxWrapper}>
          <div className={styles.inputBox} ref={inputBoxRef}>
            <textarea
              ref={textareaRef}
              className={styles.inputTextarea}
              placeholder={
                activeMode === "execute" && !hasSession
                  ? "Click 'Start execution' to begin..."
                  : "Type a message... (/ for commands, Cmd+Enter to send)"
              }
              value={userInput}
              onChange={handleInputChange}
              onKeyDown={(e) => {
                if (slashState) return;
                if (e.key === "Tab" && e.shiftKey) {
                  e.preventDefault();
                  handleModeSwitch(activeMode === "plan" ? "execute" : "plan");
                  return;
                }
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  handleSend();
                }
              }}
              disabled={isBusy || (activeMode === "execute" && !hasSession && messages.length === 0)}
              autoFocus
              rows={3}
            />

            <div className={styles.inputBoxFooter}>
              <div className={styles.modeToggle}>
                <button
                  className={`${styles.modeSegment} ${activeMode === "plan" ? styles.modeSegmentActive : ""}`}
                  onClick={() => handleModeSwitch("plan")}
                  title="Plan mode (Shift+Tab)"
                >
                  plan
                </button>
                <button
                  className={`${styles.modeSegment} ${activeMode === "execute" ? styles.modeSegmentActive : ""}`}
                  onClick={() => handleModeSwitch("execute")}
                  title="Build mode (Shift+Tab)"
                >
                  build
                </button>
              </div>

              <button
                className={styles.modelDisplay}
                onClick={() => {
                  computeDropdownPos();
                  setSlashState("models");
                }}
                title={selectedModel || "Select model"}
              >
                {selectedModel || (availableModels.length === 0 ? "Loading..." : "Select model")}
              </button>

              <button
                className={styles.modelDisplay}
                onClick={() => {
                  computeDropdownPos();
                  const sessionIds = task?.sessionIds ?? [];
                  if (sessionIds.length > 0) {
                    setSlashState("sessions");
                  } else {
                    void startSession();
                  }
                }}
                title="Switch session"
              >
                Session
              </button>

              <span className={styles.inputBoxSpacer} />

              {questionRequest ? (
                <span className={styles.waitingBadge}>Waiting...</span>
              ) : (
                <WorkingPlaceholder isWorking={isBusy} statusText={null} />
              )}
              {sessionStatus === "retry" && (
                <span className={styles.statusRetry}>Retrying...</span>
              )}

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
        </div>
      </div>

      {errorMsg && (
        <div className={styles.statusBar}>
          <span className={styles.statusError} title={errorMsg}>
            Error:{" "}
            {errorMsg.length > 80 ? errorMsg.slice(0, 80) + "..." : errorMsg}
          </span>
        </div>
      )}
    </div>
  );
}
