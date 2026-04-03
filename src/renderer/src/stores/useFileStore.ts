import { create } from "zustand";
import type { FileTreeNode, FileContent } from "@shared/types";
import { useWorkspaceStore } from "./useWorkspaceStore";

/** Represents the root directory context for the file tree */
export interface FileRoot {
  label: string;
  path: string;
  /** When set, use git-based reading (committed state) for this branch */
  gitBranch?: string;
}

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
  /** Selected root for file browsing. null = workspace root (default) */
  selectedRoot: FileRoot | null;

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
  setSelectedRoot: (root: FileRoot | null) => void;
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
  selectedRoot: null,

  fetchTree: () => {
    if (fetchTreeTimer) clearTimeout(fetchTreeTimer);
    fetchTreeTimer = setTimeout(async () => {
      const { selectedRoot } = get();
      const workspacePath = useWorkspaceStore.getState().activeWorkspacePath;
      if (!workspacePath) return;

      set({ treeLoading: true });
      try {
        let result: {
          ok: boolean;
          data?: import("@shared/types").FileTreeNode[];
          error?: string;
        };

        if (selectedRoot?.gitBranch) {
          // Git-branch mode: fetch committed file tree
          result = await window.api.git.treeForBranch(
            workspacePath,
            selectedRoot.gitBranch,
          );
        } else {
          const effectiveRoot = selectedRoot?.path ?? workspacePath;
          result = await window.api.fs.tree(effectiveRoot);
        }

        if (result.ok) {
          const effectiveRoot = selectedRoot?.gitBranch
            ? `${workspacePath}:${selectedRoot.gitBranch}`
            : (selectedRoot?.path ?? workspacePath);
          const currentDirs = get().expandedDirs;
          const dirs =
            currentDirs.length > 0
              ? currentDirs
              : loadExpandedDirs(effectiveRoot);
          set({ tree: result.data!, treeLoading: false, expandedDirs: dirs });
        } else {
          console.error("[useFileStore] fetchTree failed:", result.error);
          // If using a non-default root that failed, fall back to workspace root
          if (selectedRoot && workspacePath) {
            set({ selectedRoot: null, treeLoading: false });
            get().fetchTree();
          } else {
            set({ treeLoading: false });
          }
        }
      } catch (err) {
        console.error("[useFileStore] fetchTree error:", err);
        set({ treeLoading: false });
      }
    }, 200);
  },

  openFile: async (relativePath: string) => {
    const { selectedRoot } = get();
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
      let result: {
        ok: boolean;
        data?: import("@shared/types").FileReadResult;
        error?: string;
      };

      if (selectedRoot?.gitBranch) {
        result = await window.api.git.readFileAtBranch(
          workspacePath,
          selectedRoot.gitBranch,
          relativePath,
        );
      } else {
        const effectiveRoot = selectedRoot?.path ?? workspacePath;
        result = await window.api.fs.readFile(effectiveRoot, relativePath);
      }

      if (result.ok) {
        const data = result.data!;
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
    const { expandedDirs, selectedRoot } = get();
    const workspacePath = useWorkspaceStore.getState().activeWorkspacePath;
    const effectiveRoot = selectedRoot?.path ?? workspacePath;
    let newDirs: string[];
    if (expandedDirs.includes(dirPath)) {
      newDirs = expandedDirs.filter((d) => d !== dirPath);
    } else {
      newDirs = [...expandedDirs, dirPath];
    }
    set({ expandedDirs: newDirs });
    if (effectiveRoot) saveExpandedDirs(effectiveRoot, newDirs);
  },

  expandDir: (dirPath: string) => {
    const { expandedDirs, selectedRoot } = get();
    if (!expandedDirs.includes(dirPath)) {
      const newDirs = [...expandedDirs, dirPath];
      set({ expandedDirs: newDirs });
      const workspacePath = useWorkspaceStore.getState().activeWorkspacePath;
      const effectiveRoot = selectedRoot?.path ?? workspacePath;
      if (effectiveRoot) saveExpandedDirs(effectiveRoot, newDirs);
    }
  },

  collapseDir: (dirPath: string) => {
    const { expandedDirs, selectedRoot } = get();
    if (expandedDirs.includes(dirPath)) {
      const newDirs = expandedDirs.filter((d) => d !== dirPath);
      set({ expandedDirs: newDirs });
      const workspacePath = useWorkspaceStore.getState().activeWorkspacePath;
      const effectiveRoot = selectedRoot?.path ?? workspacePath;
      if (effectiveRoot) saveExpandedDirs(effectiveRoot, newDirs);
    }
  },

  reloadOpenFile: async () => {
    const { openFilePath, selectedRoot } = get();
    if (!openFilePath) return;

    const workspacePath = useWorkspaceStore.getState().activeWorkspacePath;
    if (!workspacePath) return;

    try {
      let result: {
        ok: boolean;
        data?: import("@shared/types").FileReadResult;
        error?: string;
      };

      if (selectedRoot?.gitBranch) {
        result = await window.api.git.readFileAtBranch(
          workspacePath,
          selectedRoot.gitBranch,
          openFilePath,
        );
      } else {
        const effectiveRoot = selectedRoot?.path ?? workspacePath;
        result = await window.api.fs.readFile(effectiveRoot, openFilePath);
      }

      if (result.ok) {
        const data = result.data!;
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

  setSelectedRoot: (root: FileRoot | null) => {
    const { selectedRoot } = get();
    // Only update if actually changed
    if (
      root?.path === selectedRoot?.path &&
      root?.label === selectedRoot?.label &&
      root?.gitBranch === selectedRoot?.gitBranch
    ) {
      return;
    }
    // Close any open file and reset expanded dirs when switching roots
    set({
      selectedRoot: root,
      openFilePath: null,
      fileContent: null,
      fileBinary: false,
      fileTooLarge: false,
      fileTooLargeSize: null,
      fileLoading: false,
      expandedDirs: [],
    });
  },

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
      selectedRoot: null,
    });
  },
}));
