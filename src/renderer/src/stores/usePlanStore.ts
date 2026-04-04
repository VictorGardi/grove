import { create } from "zustand";
import type { PlanMessage, PlanAgent, PlanChunk } from "@shared/types";

interface PlanSession {
  sessionKey: string; // `${mode}:${taskId}`
  agent: PlanAgent;
  model: string | null;
  sessionId: string | null;
  messages: PlanMessage[];
  isRunning: boolean;
  lastExitCode: number | null;
}

interface PlanState {
  sessions: Record<string, PlanSession>; // keyed by `${mode}:${taskId}`

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
  clearSession: (sessionKey: string) => void;
}

function nextId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const usePlanStore = create<PlanState>()((set) => ({
  sessions: {},

  initSession: (sessionKey, agent, model, existingSessionId) => {
    set((s) => {
      // Don't re-initialise if session already exists for this key+agent+model,
      // but DO reset isRunning — a stale true (e.g. from a crashed/aborted run)
      // would permanently hide the Send button after a component remount.
      if (
        s.sessions[sessionKey]?.agent === agent &&
        s.sessions[sessionKey]?.model === model
      ) {
        if (!s.sessions[sessionKey].isRunning) return s;
        return {
          sessions: {
            ...s.sessions,
            [sessionKey]: { ...s.sessions[sessionKey], isRunning: false },
          },
        };
      }
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
      const msg: PlanMessage = {
        id: nextId(),
        role: "agent",
        text: "",
        thinking: "",
        isStreaming: true,
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
        messages[messages.length - 1] = {
          ...last,
          text: last.text + chunk.content,
        };
      } else if (chunk.type === "thinking") {
        messages[messages.length - 1] = {
          ...last,
          thinking: (last.thinking ?? "") + chunk.content,
        };
      } else if (chunk.type === "done") {
        messages[messages.length - 1] = { ...last, isStreaming: false };
        const exitCode = parseInt(chunk.content, 10);
        return {
          sessions: {
            ...s.sessions,
            [sessionKey]: {
              ...session,
              messages,
              isRunning: false,
              lastExitCode: isNaN(exitCode) ? null : exitCode,
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
      }

      return {
        sessions: {
          ...s.sessions,
          [sessionKey]: {
            ...session,
            messages,
            isRunning: chunk.type !== "error",
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

  clearSession: (sessionKey) => {
    set((s) => {
      const next = { ...s.sessions };
      delete next[sessionKey];
      return { sessions: next };
    });
  },
}));
