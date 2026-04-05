import { create } from "zustand";
import type {
  PlanMessage,
  PlanAgent,
  PlanChunk,
  MessageContentBlock,
} from "@shared/types";

interface PlanSession {
  sessionKey: string; // `${mode}:${taskId}`
  agent: PlanAgent;
  model: string | null;
  sessionId: string | null;
  messages: PlanMessage[];
  isRunning: boolean;
  lastExitCode: number | null;
  /** Accumulated token total across all steps in this session */
  totalTokens: number;
  /** Session status for tmux persistence */
  sessionStatus: "idle" | "running" | "paused" | "reconnecting";
  /**
   * True while replaying a log file from a previous app session.
   * Used to decide whether grove_user_message chunks should create user
   * bubbles (replay: yes) or be skipped (fresh send: handleSend already
   * added the bubble).
   */
  isReplaying: boolean;
}

interface PlanState {
  sessions: Record<string, PlanSession>;

  /**
   * Shared model list cache keyed by `"${workspacePath}:${agent}"`.
   * Cards read from this synchronously; the first card for a given pair fires
   * the IPC fetch. `null` means a fetch is in flight; `string[]` is the result.
   */
  modelsCache: Record<string, string[] | null>;

  // Actions — all take the composite sessionKey
  initSession: (
    sessionKey: string,
    agent: PlanAgent,
    model: string | null,
    existingSessionId: string | null,
  ) => void;
  appendUserMessage: (sessionKey: string, text: string) => void;
  startAgentMessage: (sessionKey: string) => void;
  applyChunk: (sessionKey: string, chunk: PlanChunk) => void;
  setSessionId: (sessionKey: string, sessionId: string) => void;
  setRunning: (sessionKey: string, running: boolean) => void;
  setSessionStatus: (
    sessionKey: string,
    status: "idle" | "running" | "paused" | "reconnecting",
  ) => void;
  setReplaying: (sessionKey: string, isReplaying: boolean) => void;
  clearSession: (sessionKey: string) => void;
  /**
   * Ensure models for `(workspacePath, agent)` are in the cache.
   * - If a result is already cached, resolves immediately (no-op).
   * - If a fetch is in-flight (`null`), resolves immediately (caller reads null as "loading").
   * - Otherwise fires one IPC call and stores the result.
   */
  ensureModels: (workspacePath: string, agent: PlanAgent) => Promise<void>;
}

function nextId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const usePlanStore = create<PlanState>()((set, get) => ({
  sessions: {},
  modelsCache: {},

  initSession: (sessionKey, agent, model, existingSessionId) => {
    set((s) => {
      const existing = s.sessions[sessionKey];

      // Don't re-initialise if session already exists for this key+agent+model.
      // Never touch isRunning here — a live session whose task file was just
      // written (triggering a chokidar re-render) must not have its isRunning
      // flag clobbered. Stale isRunning from a crashed run is reset by the
      // dedicated on-mount effect in PlanChat instead.
      if (existing?.agent === agent && existing?.model === model) {
        return s;
      }

      // If the conversation is already in progress (has messages) and only the
      // model changed (agent is the same), patch the model field in-place so
      // the /model slash command works mid-conversation without wiping history.
      if (
        existing &&
        existing.messages.length > 0 &&
        existing.agent === agent
      ) {
        return {
          sessions: {
            ...s.sessions,
            [sessionKey]: { ...existing, model },
          },
        };
      }

      // Full initialisation — new session, agent switched, or no prior session.
      return {
        sessions: {
          ...s.sessions,
          [sessionKey]: {
            sessionKey,
            agent,
            model,
            sessionId: existingSessionId,
            messages: [],
            isRunning: false,
            lastExitCode: null,
            totalTokens: 0,
            sessionStatus: existingSessionId ? "paused" : "idle",
            isReplaying: false,
          },
        },
      };
    });
  },

  appendUserMessage: (sessionKey, text) => {
    set((s) => {
      const session = s.sessions[sessionKey];
      if (!session) return s;
      const msg: PlanMessage = {
        id: nextId(),
        role: "user",
        text,
        isStreaming: false,
        timestamp: Date.now(),
      };
      return {
        sessions: {
          ...s.sessions,
          [sessionKey]: { ...session, messages: [...session.messages, msg] },
        },
      };
    });
  },

  startAgentMessage: (sessionKey) => {
    set((s) => {
      const session = s.sessions[sessionKey];
      if (!session) return s;

      // Don't add a duplicate agent bubble if the last message is already an
      // agent message (streaming OR completed).  Between agent turns there is
      // always a user message as the last message, so this guard only fires in
      // the double-bubble scenario (reconnect racing with an existing session).
      const lastMsg = session.messages[session.messages.length - 1];
      if (lastMsg?.role === "agent") return s;

      const msg: PlanMessage = {
        id: nextId(),
        role: "agent",
        text: "",
        thinking: "",
        content: [],
        isStreaming: true,
        timestamp: Date.now(),
      };
      return {
        sessions: {
          ...s.sessions,
          [sessionKey]: {
            ...session,
            isRunning: true,
            messages: [...session.messages, msg],
          },
        },
      };
    });
  },

  applyChunk: (sessionKey, chunk) => {
    set((s) => {
      const session = s.sessions[sessionKey];
      if (!session) return s;
      const messages = [...session.messages];
      const last = messages[messages.length - 1];

      if (!last || last.role !== "agent") return s;

      if (chunk.type === "text") {
        // Append to last text block in content array, or start a new one
        const prevContent = last.content ?? [];
        const lastBlock = prevContent[prevContent.length - 1];
        let newContent: MessageContentBlock[];
        if (lastBlock?.kind === "text") {
          newContent = [...prevContent];
          newContent[newContent.length - 1] = {
            ...lastBlock,
            content: lastBlock.content + chunk.content,
          };
        } else {
          newContent = [
            ...prevContent,
            { kind: "text", content: chunk.content },
          ];
        }
        messages[messages.length - 1] = {
          ...last,
          text: last.text + chunk.content,
          content: newContent,
        };
      } else if (chunk.type === "thinking") {
        // Append to last thinking block in content array, or start a new one
        const prevContent = last.content ?? [];
        const lastBlock = prevContent[prevContent.length - 1];
        let newContent: MessageContentBlock[];
        if (lastBlock?.kind === "thinking") {
          newContent = [...prevContent];
          newContent[newContent.length - 1] = {
            ...lastBlock,
            content: lastBlock.content + chunk.content,
          };
        } else {
          newContent = [
            ...prevContent,
            { kind: "thinking", content: chunk.content },
          ];
        }
        messages[messages.length - 1] = {
          ...last,
          thinking: (last.thinking ?? "") + chunk.content,
          content: newContent,
        };
      } else if (chunk.type === "tool_use") {
        // Always append a new tool_use block (each is a discrete completed call)
        const newBlock: MessageContentBlock = {
          kind: "tool_use",
          content: chunk.content,
          data: chunk.data,
        };
        messages[messages.length - 1] = {
          ...last,
          content: [...(last.content ?? []), newBlock],
        };
      } else if (chunk.type === "done") {
        messages[messages.length - 1] = { ...last, isStreaming: false };
        const exitCode = parseInt(chunk.content, 10);

        // If we replayed a log that predates history tracking, no
        // grove_user_message lines exist → no user bubbles in messages.
        // Prepend a placeholder so the user knows context is missing.
        const noUserMessages = !messages.some((m) => m.role === "user");
        if (session.isReplaying && noUserMessages) {
          messages.unshift({
            id: nextId(),
            role: "user",
            text: "Previous conversation not available — log predates history tracking",
            isStreaming: false,
            timestamp: messages[0]?.timestamp ?? Date.now(),
            isPlaceholder: true,
          });
        }

        return {
          sessions: {
            ...s.sessions,
            [sessionKey]: {
              ...session,
              messages,
              isRunning: false,
              lastExitCode: isNaN(exitCode) ? null : exitCode,
              // Clear the "Agent running — reconnected" banner now that replay is done
              sessionStatus: "idle",
            },
          },
        };
      } else if (chunk.type === "error") {
        messages[messages.length - 1] = {
          ...last,
          text:
            last.text + (last.text ? "\n\n" : "") + `Error: ${chunk.content}`,
          isStreaming: false,
        };
        // Explicit return: set isRunning: false AND lastExitCode: 1 so the
        // board card shows "session failed" rather than "Waiting for input".
        // Without this explicit return the fall-through at the end of
        // applyChunk would leave lastExitCode unchanged (null), which causes
        // isExecuteWaiting / isPlanWaiting to evaluate to true instead.
        return {
          sessions: {
            ...s.sessions,
            [sessionKey]: {
              ...session,
              messages,
              isRunning: false,
              lastExitCode: 1,
            },
          },
        };
      } else if (chunk.type === "tokens") {
        const tokenData = chunk.data;
        return {
          sessions: {
            ...s.sessions,
            [sessionKey]: {
              ...session,
              messages,
              totalTokens: session.totalTokens + tokenData.total,
            },
          },
        };
      }

      return {
        sessions: {
          ...s.sessions,
          [sessionKey]: {
            ...session,
            messages,
            // text/thinking/tool_use and any other streaming chunks arrive only
            // while the agent is actively running — re-assert isRunning: true so
            // that a stale false value (e.g. from a mount reset racing with an
            // in-flight chunk) is corrected on the next chunk.
            isRunning: true,
          },
        },
      };
    });
  },

  setSessionId: (sessionKey, sessionId) => {
    set((s) => {
      const session = s.sessions[sessionKey];
      if (!session) return s;
      return {
        sessions: {
          ...s.sessions,
          [sessionKey]: { ...session, sessionId },
        },
      };
    });
  },

  setRunning: (sessionKey, running) => {
    set((s) => {
      const session = s.sessions[sessionKey];
      if (!session) return s;
      return {
        sessions: {
          ...s.sessions,
          [sessionKey]: { ...session, isRunning: running },
        },
      };
    });
  },

  setSessionStatus: (sessionKey, status) => {
    set((s) => {
      const session = s.sessions[sessionKey];
      if (!session) return s;
      return {
        sessions: {
          ...s.sessions,
          [sessionKey]: { ...session, sessionStatus: status },
        },
      };
    });
  },

  clearSession: (sessionKey) => {
    set((s) => {
      const next = { ...s.sessions };
      delete next[sessionKey];
      return { sessions: next };
    });
  },

  setReplaying: (sessionKey, isReplaying) => {
    set((s) => {
      const session = s.sessions[sessionKey];
      if (!session) return s;
      return {
        sessions: {
          ...s.sessions,
          [sessionKey]: { ...session, isReplaying },
        },
      };
    });
  },

  ensureModels: async (workspacePath, agent) => {
    const cacheKey = `${workspacePath}:${agent}`;
    const existing = get().modelsCache[cacheKey];
    // Already cached (string[] result) or in-flight (null) — nothing to do
    if (existing !== undefined) return;

    // Mark as in-flight so concurrent calls don't fire duplicate IPC requests
    set((s) => ({
      modelsCache: { ...s.modelsCache, [cacheKey]: null },
    }));

    try {
      const result = await window.api.plan.listModels({ agent, workspacePath });
      const models = result.ok ? result.data : [];
      set((s) => ({
        modelsCache: { ...s.modelsCache, [cacheKey]: models },
      }));
    } catch {
      set((s) => ({
        modelsCache: { ...s.modelsCache, [cacheKey]: [] },
      }));
    }
  },
}));
