import { create } from "zustand";
import type { FileTreeNode, FileContent } from "@shared/types";
import { useWorkspaceStore } from "./useWorkspaceStore";

interface FileState {
  tree: FileTreeNode[];
  treeLoading: boolean;
  openFilePath: string | null;
  fileContent: FileContent | null;
  fileBinary: boolean;
  fileTooLarge: boolean;
  fileTooLargeSize: number | null;
  fileLoading: boolean;
  searchQuery: string;
  searchActive: boolean;
  expandedDirs: string[];
  searchFocusCounter: number;

  fetchTree: () => void;
  openFile: (relativePath: string) => Promise<void>;
  closeFile: () => void;
  setSearchQuery: (query: string) => void;
  setSearchActive: (active: boolean) => void;
  toggleDir: (dirPath: string) => void;
  expandDir: (dirPath: string) => void;
  collapseDir: (dirPath: string) => void;
  reloadOpenFile: () => Promise<void>;
  requestSearchFocus: () => void;
  clear: () => void;
}

let fetchTreeTimer: ReturnType<typeof setTimeout> | null = null;

function getExpandedDirsKey(workspacePath: string): string {
  return `grove:expandedDirs:${workspacePath}`;
}

function loadExpandedDirs(workspacePath: string): string[] {
  try {
    const raw = localStorage.getItem(getExpandedDirsKey(workspacePath));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

function saveExpandedDirs(workspacePath: string, dirs: string[]): void {
  try {
    localStorage.setItem(
      getExpandedDirsKey(workspacePath),
      JSON.stringify(dirs),
    );
  } catch {
    // ignore
  }
}

export const useFileStore = create<FileState>()((set, get) => ({
  tree: [],
  treeLoading: false,
  openFilePath: null,
  fileContent: null,
  fileBinary: false,
  fileTooLarge: false,
  fileTooLargeSize: null,
  fileLoading: false,
  searchQuery: "",
  searchActive: false,
  expandedDirs: [],
  searchFocusCounter: 0,

  fetchTree: () => {
    if (fetchTreeTimer) clearTimeout(fetchTreeTimer);
    fetchTreeTimer = setTimeout(async () => {
      const workspacePath = useWorkspaceStore.getState().activeWorkspacePath;
      if (!workspacePath) return;
      set({ treeLoading: true });
      try {
        const result = await window.api.fs.tree(workspacePath);
        if (result.ok) {
          // Load persisted expanded dirs on first tree load
          const currentDirs = get().expandedDirs;
          const dirs =
            currentDirs.length > 0
              ? currentDirs
              : loadExpandedDirs(workspacePath);
          set({ tree: result.data, treeLoading: false, expandedDirs: dirs });
        } else {
          console.error("[useFileStore] fetchTree failed:", result.error);
          set({ treeLoading: false });
        }
      } catch (err) {
        console.error("[useFileStore] fetchTree error:", err);
        set({ treeLoading: false });
      }
    }, 200);
  },

  openFile: async (relativePath: string) => {
    const workspacePath = useWorkspaceStore.getState().activeWorkspacePath;
    if (!workspacePath) return;

    set({
      openFilePath: relativePath,
      fileLoading: true,
      fileBinary: false,
      fileTooLarge: false,
      fileTooLargeSize: null,
      fileContent: null,
    });

    try {
      const result = await window.api.fs.readFile(workspacePath, relativePath);
      if (result.ok) {
        const data = result.data;
        if ("binary" in data) {
          set({ fileBinary: true, fileLoading: false });
        } else if ("tooLarge" in data) {
          set({
            fileTooLarge: true,
            fileTooLargeSize: data.size,
            fileLoading: false,
          });
        } else {
          set({ fileContent: data, fileLoading: false });
        }
      } else {
        set({ fileLoading: false });
      }
    } catch {
      set({ fileLoading: false });
    }
  },

  closeFile: () =>
    set({
      openFilePath: null,
      fileContent: null,
      fileBinary: false,
      fileTooLarge: false,
      fileTooLargeSize: null,
      fileLoading: false,
    }),

  setSearchQuery: (query: string) => set({ searchQuery: query }),
  setSearchActive: (active: boolean) => set({ searchActive: active }),

  toggleDir: (dirPath: string) => {
    const { expandedDirs } = get();
    const workspacePath = useWorkspaceStore.getState().activeWorkspacePath;
    let newDirs: string[];
    if (expandedDirs.includes(dirPath)) {
      newDirs = expandedDirs.filter((d) => d !== dirPath);
    } else {
      newDirs = [...expandedDirs, dirPath];
    }
    set({ expandedDirs: newDirs });
    if (workspacePath) saveExpandedDirs(workspacePath, newDirs);
  },

  expandDir: (dirPath: string) => {
    const { expandedDirs } = get();
    if (!expandedDirs.includes(dirPath)) {
      const newDirs = [...expandedDirs, dirPath];
      set({ expandedDirs: newDirs });
      const workspacePath = useWorkspaceStore.getState().activeWorkspacePath;
      if (workspacePath) saveExpandedDirs(workspacePath, newDirs);
    }
  },

  collapseDir: (dirPath: string) => {
    const { expandedDirs } = get();
    if (expandedDirs.includes(dirPath)) {
      const newDirs = expandedDirs.filter((d) => d !== dirPath);
      set({ expandedDirs: newDirs });
      const workspacePath = useWorkspaceStore.getState().activeWorkspacePath;
      if (workspacePath) saveExpandedDirs(workspacePath, newDirs);
    }
  },

  reloadOpenFile: async () => {
    const { openFilePath } = get();
    if (!openFilePath) return;

    const workspacePath = useWorkspaceStore.getState().activeWorkspacePath;
    if (!workspacePath) return;

    try {
      const result = await window.api.fs.readFile(workspacePath, openFilePath);
      if (result.ok) {
        const data = result.data;
        if ("content" in data) {
          set({ fileContent: data });
        }
      }
    } catch {
      // ignore reload errors
    }
  },

  requestSearchFocus: () =>
    set((s) => ({ searchFocusCounter: s.searchFocusCounter + 1 })),

  clear: () => {
    if (fetchTreeTimer) {
      clearTimeout(fetchTreeTimer);
      fetchTreeTimer = null;
    }
    set({
      tree: [],
      treeLoading: false,
      openFilePath: null,
      fileContent: null,
      fileBinary: false,
      fileTooLarge: false,
      fileTooLargeSize: null,
      fileLoading: false,
      searchQuery: "",
      searchActive: false,
      expandedDirs: [],
      searchFocusCounter: 0,
    });
  },
}));
