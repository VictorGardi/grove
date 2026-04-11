import { create } from "zustand";
import type { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

export interface TerminalTab {
  id: string;
  label: string;
  workspacePath: string;
  worktreePath: string | null;
  taskId: string | null;
}

interface TerminalState {
  tabs: TerminalTab[];
  activeTabId: string | null;
  idleMap: Record<string, boolean>;
  deadSet: Record<string, boolean>;

  // Actions
  addTab: (tab: TerminalTab) => void;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  setIdle: (id: string, idle: boolean) => void;
  markDead: (id: string) => void;
  unmarkDead: (id: string) => void;
  restartTab: (id: string) => void;
  getTabsForWorkspace: (workspacePath: string) => TerminalTab[];
  getTaskIdForTab: (tabId: string) => string | null;
}

// Centralized xterm instance registry — outside Zustand to avoid serialization issues
const xtermRefs = new Map<string, Terminal>();
const fitAddonRefs = new Map<string, FitAddon>();

export function registerXterm(id: string, terminal: Terminal): void {
  xtermRefs.set(id, terminal);
}

export function unregisterXterm(id: string): void {
  xtermRefs.delete(id);
}

export function getXterm(id: string): Terminal | undefined {
  return xtermRefs.get(id);
}

export function registerFitAddon(id: string, fitAddon: FitAddon): void {
  fitAddonRefs.set(id, fitAddon);
}

export function getFitAddon(id: string): FitAddon | undefined {
  return fitAddonRefs.get(id);
}

export function unregisterFitAddon(id: string): void {
  fitAddonRefs.delete(id);
}

// Global data listener — registered once
let dataCleanup: (() => void) | null = null;
let exitCleanup: (() => void) | null = null;

// Trailing-edge debounce for setIdle(id, false) — called on every output byte.
// Without debouncing, Zustand set() fires on every character, causing high-frequency
// renders. A ~100ms trailing debounce is acceptable: commands completing in <100ms
// may not show the "running" indicator, which is an accepted trade-off per the DoD.
const idleDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const IDLE_DEBOUNCE_MS = 100;

function debouncedSetNotIdle(id: string): void {
  const existing = idleDebounceTimers.get(id);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    idleDebounceTimers.delete(id);
    useTerminalStore.getState().setIdle(id, false);
  }, IDLE_DEBOUNCE_MS);
  idleDebounceTimers.set(id, timer);
}

export function initTerminalListeners(): void {
  if (dataCleanup) return; // Already initialized

  dataCleanup = window.api.pty.onData((id: string, data: string) => {
    const term = xtermRefs.get(id);
    if (term) {
      term.write(data);
    }
    // Update idle state with trailing-edge debounce to avoid Zustand set() on
    // every output byte — see debouncedSetNotIdle above.
    debouncedSetNotIdle(id);
  });

  exitCleanup = window.api.pty.onExit(async (id: string, exitCode: number) => {
    const term = xtermRefs.get(id);

    if (term) {
      term.write(
        `\r\n\x1b[90mProcess exited (code ${exitCode}). Press any key to restart.\x1b[0m\r\n`,
      );
    }

    useTerminalStore.getState().markDead(id);
  });
}

export function cleanupTerminalListeners(): void {
  dataCleanup?.();
  dataCleanup = null;
  exitCleanup?.();
  exitCleanup = null;
}

export const useTerminalStore = create<TerminalState>()((set, get) => ({
  tabs: [],
  activeTabId: null,
  idleMap: {},
  deadSet: {},

  addTab: (tab: TerminalTab) =>
    set((s) => {
      // Idempotent: don't add duplicate tabs
      if (s.tabs.some((t) => t.id === tab.id)) {
        return { activeTabId: tab.id };
      }
      return {
        tabs: [...s.tabs, tab],
        activeTabId: tab.id,
      };
    }),

  removeTab: (id: string) => {
    // Kill the PTY
    window.api.pty.kill(id);
    // Dispose and unregister xterm
    xtermRefs.get(id)?.dispose();
    unregisterXterm(id);
    // Dispose and unregister FitAddon
    fitAddonRefs.get(id)?.dispose();
    unregisterFitAddon(id);

    set((s) => {
      const newTabs = s.tabs.filter((t) => t.id !== id);
      let newActiveId = s.activeTabId;

      if (s.activeTabId === id) {
        // Select the next or previous tab
        const oldIndex = s.tabs.findIndex((t) => t.id === id);
        if (newTabs.length > 0) {
          const nextIndex = Math.min(oldIndex, newTabs.length - 1);
          newActiveId = newTabs[nextIndex].id;
        } else {
          newActiveId = null;
        }
      }

      const newIdleMap = { ...s.idleMap };
      delete newIdleMap[id];
      const newDeadSet = { ...s.deadSet };
      delete newDeadSet[id];

      return {
        tabs: newTabs,
        activeTabId: newActiveId,
        idleMap: newIdleMap,
        deadSet: newDeadSet,
      };
    });
  },

  setActiveTab: (id: string) => set({ activeTabId: id }),

  setIdle: (id: string, idle: boolean) =>
    set((s) => ({
      idleMap: { ...s.idleMap, [id]: idle },
    })),

  markDead: (id: string) =>
    set((s) => ({
      deadSet: { ...s.deadSet, [id]: true },
    })),

  unmarkDead: (id: string) =>
    set((s) => {
      const newDeadSet = { ...s.deadSet };
      delete newDeadSet[id];
      return { deadSet: newDeadSet };
    }),

  restartTab: (id: string) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return;

    // Dispose old xterm, kill old PTY
    const oldTerm = xtermRefs.get(id);
    if (oldTerm) {
      oldTerm.dispose();
      unregisterXterm(id);
    }
    window.api.pty.kill(id);

    // Remove old tab, mark no longer dead
    set((s) => {
      const newDeadSet = { ...s.deadSet };
      delete newDeadSet[id];
      return { deadSet: newDeadSet };
    });

    // Re-create by removing and re-adding the tab (triggers TerminalTabView remount)
    const newId = tab.taskId ? `wt-${tab.taskId}` : `free-${Date.now()}`;
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, id: newId } : t)),
      activeTabId: newId,
    }));
  },

  getTabsForWorkspace: (workspacePath: string) => {
    return get().tabs.filter((t) => t.workspacePath === workspacePath);
  },

  getTaskIdForTab: (tabId: string) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    return tab?.taskId ?? null;
  },
}));
