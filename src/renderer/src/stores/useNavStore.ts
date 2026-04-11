import { create } from "zustand";

export type View =
  | "home"
  | "board"
  | "task"
  | "decisions"
  | "files"
  | "settings"
  | "agents";

const STORAGE_KEY = "grove:view";

function getStoredView(): View {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (
      stored === "home" ||
      stored === "board" ||
      stored === "task" ||
      stored === "decisions" ||
      stored === "files" ||
      stored === "settings" ||
      stored === "agents"
    ) {
      return stored;
    }
  } catch {
    // Ignore localStorage errors (e.g., private browsing, quota exceeded)
  }
  return "home";
}

interface NavState {
  activeView: View;
  sidebarVisible: boolean;
  terminalPanelOpen: boolean;
  setActiveView: (view: View) => void;
  toggleSidebar: () => void;
  toggleTerminalPanel: () => void;
  setTerminalPanelOpen: (open: boolean) => void;
}

export const useNavStore = create<NavState>()((set) => ({
  activeView: getStoredView(),
  sidebarVisible: true,
  terminalPanelOpen: false,

  setActiveView: (view: View) => {
    try {
      localStorage.setItem(STORAGE_KEY, view);
    } catch {
      // Ignore localStorage errors
    }
    set({ activeView: view });
  },

  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),

  toggleTerminalPanel: () =>
    set((s) => ({ terminalPanelOpen: !s.terminalPanelOpen })),

  setTerminalPanelOpen: (open: boolean) => set({ terminalPanelOpen: open }),
}));
