import { create } from "zustand";
import type { PlanMessage, PlanAgent, PlanChunk } from "@shared/types";

interface PlanSession {
  taskId: string;
  agent: PlanAgent;
  model: string | null;
  sessionId: string | null;
  messages: PlanMessage[];
  isRunning: boolean;
  lastExitCode: number | null;
}

interface PlanState {
  sessions: Record<string, PlanSession>; // keyed by taskId

  // Actions
  initSession: (
    taskId: string,
    agent: PlanAgent,
    model: string | null,
    existingSessionId: string | null,
  ) => void;
  appendUserMessage: (taskId: string, text: string) => void;
  startAgentMessage: (taskId: string) => void;
  applyChunk: (taskId: string, chunk: PlanChunk) => void;
  setSessionId: (taskId: string, sessionId: string) => void;
  setRunning: (taskId: string, running: boolean) => void;
  clearSession: (taskId: string) => void;
}

function nextId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const usePlanStore = create<PlanState>()((set) => ({
  sessions: {},

  initSession: (taskId, agent, model, existingSessionId) => {
    set((s) => {
      // Don't re-initialise if session already exists for this task+agent+model
      if (
        s.sessions[taskId]?.agent === agent &&
        s.sessions[taskId]?.model === model
      )
        return s;
      return {
        sessions: {
          ...s.sessions,
          [taskId]: {
            taskId,
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

  appendUserMessage: (taskId, text) => {
    set((s) => {
      const session = s.sessions[taskId];
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
          [taskId]: { ...session, messages: [...session.messages, msg] },
        },
      };
    });
  },

  startAgentMessage: (taskId) => {
    set((s) => {
      const session = s.sessions[taskId];
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
          [taskId]: {
            ...session,
            isRunning: true,
            messages: [...session.messages, msg],
          },
        },
      };
    });
  },

  applyChunk: (taskId, chunk) => {
    set((s) => {
      const session = s.sessions[taskId];
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
            [taskId]: {
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
          [taskId]: {
            ...session,
            messages,
            isRunning: chunk.type !== "error",
          },
        },
      };
    });
  },

  setSessionId: (taskId, sessionId) => {
    set((s) => {
      const session = s.sessions[taskId];
      if (!session) return s;
      return {
        sessions: {
          ...s.sessions,
          [taskId]: { ...session, sessionId },
        },
      };
    });
  },

  setRunning: (taskId, running) => {
    set((s) => {
      const session = s.sessions[taskId];
      if (!session) return s;
      return {
        sessions: {
          ...s.sessions,
          [taskId]: { ...session, isRunning: running },
        },
      };
    });
  },

  clearSession: (taskId) => {
    set((s) => {
      const next = { ...s.sessions };
      delete next[taskId];
      return { sessions: next };
    });
  },
}));
