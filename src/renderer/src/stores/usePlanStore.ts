import { create } from "zustand";
import type {
  PlanMessage,
  PlanAgent,
  PlanChunk,
  MessageContentBlock,
} from "@shared/types";

// ── RAF-based streaming throttle ──────────────────────────────────────────────
// Content chunks (text, thinking, tool_use) are buffered here and flushed to
// Zustand state in a single set() call per animation frame (~60 fps). Control-
// flow chunks (done, session_id, replay_done, user_message, stderr, error,
// tokens) are NOT buffered — they are applied synchronously via applyChunk.

interface BufferedChunk {
  sessionKey: string;
  chunk: PlanChunk;
}

const CONTENT_CHUNK_TYPES = new Set(["text", "thinking", "tool_use"]);

let rafPending = false;
const chunkQueue: BufferedChunk[] = [];

function scheduleFlush(): void {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    const toFlush = chunkQueue.splice(0); // drain atomically
    if (toFlush.length === 0) return;
    // Apply all buffered chunks in arrival order via a single store update loop.
    // Each chunk is still applied through applyChunk so all existing logic is
    // preserved — we just batch multiple Zustand set() calls into one rAF.
    for (const { sessionKey, chunk } of toFlush) {
      usePlanStore.getState().applyChunk(sessionKey, chunk);
    }
  });
}

/**
 * Queue a content chunk for batched delivery at ~60 fps.
 * Control-flow chunks are not buffered and are applied synchronously.
 */
export function queueChunk(sessionKey: string, chunk: PlanChunk): void {
  if (CONTENT_CHUNK_TYPES.has(chunk.type)) {
    chunkQueue.push({ sessionKey, chunk });
    scheduleFlush();
  } else {
    usePlanStore.getState().applyChunk(sessionKey, chunk);
  }
}

interface PlanSession {
  sessionKey: string; // `${mode}:${taskId}`
  agent: PlanAgent;
  model: string | null;
  sessionId: string | null;
  messages: PlanMessage[];
  isRunning: boolean;
  lastExitCode: number | null;
  /** Stderr output from the last agent run, shown in the exit warning area. */
  lastStderr: string | null;
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
    lastExitCode?: number | null,
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

  initSession: (sessionKey, agent, model, existingSessionId, lastExitCode) => {
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

      // If the conversation is already in progress (has messages) and only the
      // agent changed (model is the same), patch the agent field in-place so
      // the /agent slash command works mid-conversation without wiping history.
      if (
        existing &&
        existing.messages.length > 0 &&
        existing.model === model
      ) {
        return {
          sessions: {
            ...s.sessions,
            [sessionKey]: { ...existing, agent },
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
            lastExitCode: lastExitCode ?? null,
            lastStderr: null,
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
        model: session.model ?? undefined,
      };
      return {
        sessions: {
          ...s.sessions,
          [sessionKey]: {
            ...session,
            isRunning: true,
            lastStderr: null,
            lastExitCode: null,
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
      // Reuse the same array reference if messages haven't changed yet.
      // We build a new array only for control-flow chunks that need to add/prepend
      // messages. For content chunks, we only replace the last element in-place.
      const messages = session.messages;
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
        // Only rebuild the last message; all previous messages keep their
        // existing object references so React.memo on ChatMessage works correctly.
        const updatedLast = {
          ...last,
          text: last.text + chunk.content,
          content: newContent,
        };
        const newMessages = [...messages.slice(0, -1), updatedLast];
        return {
          sessions: {
            ...s.sessions,
            [sessionKey]: {
              ...session,
              messages: newMessages,
              ...(!session.isReplaying ? { isRunning: true } : {}),
            },
          },
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
        const updatedLast = {
          ...last,
          thinking: (last.thinking ?? "") + chunk.content,
          content: newContent,
        };
        const newMessages = [...messages.slice(0, -1), updatedLast];
        return {
          sessions: {
            ...s.sessions,
            [sessionKey]: {
              ...session,
              messages: newMessages,
              ...(!session.isReplaying ? { isRunning: true } : {}),
            },
          },
        };
      } else if (chunk.type === "tool_use") {
        // Always append a new tool_use block (each is a discrete completed call)
        const newBlock: MessageContentBlock = {
          kind: "tool_use",
          content: chunk.content,
          data: chunk.data,
        };
        const updatedLast = {
          ...last,
          content: [...(last.content ?? []), newBlock],
        };
        const newMessages = [...messages.slice(0, -1), updatedLast];
        return {
          sessions: {
            ...s.sessions,
            [sessionKey]: {
              ...session,
              messages: newMessages,
              ...(!session.isReplaying ? { isRunning: true } : {}),
            },
          },
        };
      } else if (chunk.type === "done") {
        const updatedLast = { ...last, isStreaming: false };
        const exitCode = parseInt(chunk.content, 10);

        let newMessages: PlanMessage[] = [
          ...messages.slice(0, -1),
          updatedLast,
        ];

        // If we replayed a log that predates history tracking, no
        // grove_user_message lines exist → no user bubbles in messages.
        // Prepend a placeholder so the user knows context is missing.
        const noUserMessages = !newMessages.some((m) => m.role === "user");
        if (session.isReplaying && noUserMessages) {
          newMessages = [
            {
              id: nextId(),
              role: "user",
              text: "Previous conversation not available — log predates history tracking",
              isStreaming: false,
              timestamp: newMessages[0]?.timestamp ?? Date.now(),
              isPlaceholder: true,
            },
            ...newMessages,
          ];
        }

        // During log replay an intermediate `done` chunk closes one turn's
        // bubble but the session is still running (more turns follow in the
        // log, or the agent is live and waiting for the next user message).
        // Only the final `done` — which arrives outside of replay, or is
        // immediately followed by `replay_done` — should mark the session idle.
        // We conservatively treat ANY `done` during replay as intermediate;
        // `replay_done` will fire right after the true final sentinel and
        // `setReplaying(false)` is called there. isRunning is managed
        // separately by the reconnect effect and `setRunning`.
        if (session.isReplaying) {
          return {
            sessions: {
              ...s.sessions,
              [sessionKey]: {
                ...session,
                messages: newMessages,
                // Keep isRunning: true — the session continues
                lastExitCode: isNaN(exitCode) ? null : exitCode,
              },
            },
          };
        }

        return {
          sessions: {
            ...s.sessions,
            [sessionKey]: {
              ...session,
              messages: newMessages,
              isRunning: false,
              lastExitCode: isNaN(exitCode) ? null : exitCode,
              // Clear the "Agent running — reconnected" banner now that replay is done
              sessionStatus: "idle",
            },
          },
        };
      } else if (chunk.type === "stderr") {
        // Store stderr for display in the exit warning area (not in the bubble).
        return {
          sessions: {
            ...s.sessions,
            [sessionKey]: {
              ...session,
              messages,
              lastStderr: chunk.content,
            },
          },
        };
      } else if (chunk.type === "error") {
        const errorText = `Error: ${chunk.content}`;
        const prevContent = last.content ?? [];
        const updatedLast = {
          ...last,
          text: last.text + (last.text ? "\n\n" : "") + errorText,
          // Also push to content so it is visible when the agent message already
          // has content blocks (text/thinking/tool_use). Previously only msg.text
          // was updated, which is invisible when msg.content is non-empty.
          content: [
            ...prevContent,
            { kind: "text" as const, content: errorText },
          ],
          isStreaming: false,
        };
        const newMessages = [...messages.slice(0, -1), updatedLast];
        // When replaying a historical log, an error chunk from a previous turn
        // must not force isRunning: false — the live agent may still be running.
        // Mirror the guard used in the "done" handler.
        if (session.isReplaying) {
          return {
            sessions: {
              ...s.sessions,
              [sessionKey]: {
                ...session,
                messages: newMessages,
                lastExitCode: 1,
                // Do not set lastStderr during replay so the exit warning is
                // not shown for errors that belong to a past turn.
              },
            },
          };
        }
        // Live session: set isRunning: false AND lastExitCode: 1 so the
        // board card shows "session failed" rather than "Waiting for input".
        // Also store the error in lastStderr so it appears in the exit warning
        // area, giving the user the actual failure reason.
        return {
          sessions: {
            ...s.sessions,
            [sessionKey]: {
              ...session,
              messages: newMessages,
              isRunning: false,
              lastExitCode: 1,
              lastStderr: chunk.content,
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

      // Fallback for any unhandled chunk types — keep messages stable
      return {
        sessions: {
          ...s.sessions,
          [sessionKey]: {
            ...session,
            messages,
            ...(!session.isReplaying ? { isRunning: true } : {}),
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
