import { createContext, useContext } from "react";

export const ChatContext = createContext<{ isBusy: boolean }>({ isBusy: false });
export const useChatContext = () => useContext(ChatContext);
