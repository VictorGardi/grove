import { create } from "zustand";

export type View = "board" | "milestones" | "decisions" | "files";

interface NavState {
  activeView: View;
  sidebarVisible: boolean;
  terminalPanelOpen: boolean;
  setActiveView: (view: View) => void;
  toggleSidebar: () => void;
  toggleTerminalPanel: () => void;
}

export const useNavStore = create<NavState>()((set) => ({
  activeView: "board",
  sidebarVisible: true,
  terminalPanelOpen: false,

  setActiveView: (view: View) => set({ activeView: view }),

  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),

  toggleTerminalPanel: () =>
    set((s) => ({ terminalPanelOpen: !s.terminalPanelOpen })),
}));
