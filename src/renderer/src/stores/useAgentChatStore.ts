import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MessageDisplay } from "../components/TaskDetail/TaskEventStream";

interface ChatEntry {
  messages: MessageDisplay[];
  sessionId: string | null;
}

interface AgentChatStore {
  chats: Record<string, ChatEntry>;
  getChat: (key: string) => ChatEntry;
  setMessages: (key: string, messages: MessageDisplay[]) => void;
  setSessionId: (key: string, sessionId: string | null) => void;
}

const EMPTY: ChatEntry = { messages: [], sessionId: null };

export const useAgentChatStore = create<AgentChatStore>()(
  persist(
    (set, get) => ({
      chats: {},

      getChat: (key) => get().chats[key] ?? EMPTY,

      setMessages: (key, messages) =>
        set((s) => ({
          chats: {
            ...s.chats,
            [key]: { ...(s.chats[key] ?? EMPTY), messages },
          },
        })),

      setSessionId: (key, sessionId) =>
        set((s) => ({
          chats: {
            ...s.chats,
            [key]: { ...(s.chats[key] ?? EMPTY), sessionId },
          },
        })),
    }),
    {
      name: "grove:agentChats",
      partialize: (state) => ({ chats: state.chats }),
    },
  ),
);
