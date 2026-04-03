# Phase 3 — File Tree + File Viewer: Implementation Plan

## Overview

**Goal:** Browse and read any file in the active workspace. Useful for understanding the codebase while working on tasks, and for inspecting files agents have created or modified.

**New dependencies:** `shiki`, `fuse.js`, `ignore`

**Scope:** File tree panel, fuzzy file search (`Cmd+P`), read-only syntax-highlighted file viewer, live file watching with auto-reload, and a board alignment bug fix.

---

## Pre-requisite: Bug Fix — Board Alignment

**Problem:** `MainArea.module.css` `.mainArea` has `align-items: center; justify-content: center`. This is correct for placeholder views (no workspace, decisions, terminal) but wrong for the Board — it prevents the Board from filling the available space naturally.

**Fix:**

1. **`MainArea.module.css`** — Add a new `.mainAreaContent` class without centering:

   ```css
   .mainAreaContent {
     flex: 1;
     display: flex;
     background: var(--bg-base);
     overflow: hidden;
   }
   ```

   Note: `.mainAreaWithPanel` already exists with similar properties but is semantically different (it's a flex-row container for side-panel layouts). `.mainAreaContent` is for full-bleed content views like Board and Files. Keep both — they serve different layout intents.

2. **`MainArea.tsx`** — Use `.mainAreaContent` for the Board view:
   ```tsx
   if (activeView === "board") {
     return (
       <div className={styles.mainAreaContent}>
         <Board />
       </div>
     );
   }
   ```
   All placeholder views continue using `.mainArea` (centered). The Files view will also use `.mainAreaContent`.

**Files changed:** `MainArea.module.css`, `MainArea.tsx`

---

## Step 0 — Install Dependencies

```bash
npm install shiki fuse.js ignore
```

Note: `fuse.js` ships its own TypeScript types; no `@types` package needed. `shiki` and `ignore` also include types.

**Files changed:** `package.json`, `package-lock.json`

---

## Step 1 — Add `'files'` to the Nav System

### 1a. Update the View type

**`src/renderer/src/stores/useNavStore.ts`**

Add `'files'` to the `View` union:

```ts
export type View = "board" | "milestones" | "decisions" | "terminal" | "files";
```

### 1b. Add "Files" nav item to the sidebar

**`src/renderer/src/components/Sidebar/BottomNav.tsx`**

Add a "Files" nav item with a folder/document SVG icon. Place it after Milestones and before Decisions in the nav order (VISION.md lists it as a primary view alongside Board and Milestones):

```ts
{ id: 'files', label: 'Files', icon: /* folder SVG icon */ }
```

### 1c. Route the Files view in MainArea

**`src/renderer/src/components/MainArea/MainArea.tsx`**

Add a condition for `activeView === 'files'` that renders the file tree + viewer using `.mainAreaContent` (the non-centering class from the bug fix).

**Files changed:** `useNavStore.ts`, `BottomNav.tsx`, `MainArea.tsx`

---

## Step 2 — IPC: `fs:tree` and `fs:readFile` Handlers

### 2a. Add shared types

**`src/shared/types.ts`** — Add:

```ts
export interface FileTreeNode {
  name: string;
  path: string; // relative to workspace root
  type: "file" | "directory";
  children?: FileTreeNode[];
}

export interface FileContent {
  content: string;
  language: string;
  lineCount: number;
}

export type FileReadResult =
  | FileContent
  | { binary: true }
  | { tooLarge: true; size: number };
```

### 2b. Create `src/main/filesystem.ts`

New module exporting two functions:

**`buildFileTree(workspacePath: string): Promise<FileTreeNode[]>`**

- Reads the root `.gitignore` from workspace root using the `ignore` npm package
- **Root `.gitignore` only** for v1 — nested `.gitignore` files are deferred (applying scoped ignore rules per subtree is significantly more complex and most repos only have a root `.gitignore`)
- Always excludes (defined as a shared constant `ALWAYS_EXCLUDED`): `.git/`, `node_modules/`, `.worktrees/`, `.tasks/`, `.milestones/`, `.decisions/`, `.grove/`
- **Symlinks:** Skip symlinks entirely — `dirent.isSymbolicLink()` returns true → skip. This avoids cycle risks and path traversal outside the workspace
- Recursively walks the directory using `fs.readdir` with `withFileTypes: true`
- **Error handling per directory:** Wrap each `readdir` call in try/catch — skip unreadable directories silently (permission errors, etc.)
- Returns a recursive tree structure (see `FileTreeNode` type above)
- Directories are sorted before files at each level; within each group, sorted alphabetically (case-insensitive)

**`readFileContent(workspacePath: string, relativePath: string): Promise<FileReadResult>`**

- **Path validation:** Resolve the full path and verify it starts with `workspacePath + path.sep` to prevent path traversal attacks:
  ```ts
  const resolved = path.resolve(workspacePath, relativePath);
  if (!resolved.startsWith(workspacePath + path.sep)) {
    throw new Error("Path traversal denied");
  }
  ```
- **File size check:** Before reading, check `fs.stat()` — if size exceeds 1MB (1,048,576 bytes), return `{ tooLarge: true, size }` instead of reading content
- Reads file content as UTF-8
- Detects binary content (check for null bytes in first 8KB)
- Maps file extension to language identifier for Shiki, with both extension and filename matching:

  ```ts
  const LANG_MAP: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".jsx": "jsx",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".sql": "sql",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".json": "json",
    ".md": "markdown",
    ".sh": "bash",
    ".bash": "bash",
    ".zsh": "bash",
    ".css": "css",
    ".html": "html",
    ".toml": "toml",
    ".xml": "xml",
    ".graphql": "graphql",
    // fallback: 'text'
  };

  const FILENAME_MAP: Record<string, string> = {
    Makefile: "makefile",
    Dockerfile: "dockerfile",
    ".gitignore": "gitignore",
    ".env": "bash",
    Jenkinsfile: "groovy",
    ".prettierrc": "json",
    ".eslintrc": "json",
    "tsconfig.json": "jsonc",
  };
  ```

### 2c. Register IPC handlers

**`src/main/ipc/filesystem.ts`** (new file)

```ts
ipcMain.handle('fs:tree', async (_event, workspacePath: string) => {
  // Validate workspacePath is a registered workspace (check config)
  ...
})
ipcMain.handle('fs:readFile', async (_event, workspacePath: string, relativePath: string) => {
  // Path validation happens inside readFileContent()
  ...
})
```

**Security notes:**

- `fs:tree` validates that `workspacePath` matches a registered workspace in config (prevents arbitrary directory listing)
- `fs:readFile` accepts `workspacePath` + `relativePath` (not an absolute path) — the main process resolves and validates the path stays within the workspace. This prevents the renderer from reading arbitrary files on disk
- Both return `IpcResult<T>` following the existing pattern

**`src/main/ipc/index.ts`** — import and call `registerFilesystemHandlers(configManager, mainWindow)`.

### 2d. Add to preload API

**`src/preload/index.ts`** — Add `fs` namespace:

```ts
fs: {
  tree: (workspacePath: string) => ipcRenderer.invoke('fs:tree', workspacePath),
  readFile: (workspacePath: string, relativePath: string) =>
    ipcRenderer.invoke('fs:readFile', workspacePath, relativePath),
}
```

**`src/preload/index.d.ts`** — Add type declarations for the `fs` namespace.

**Files changed:** `src/shared/types.ts`, `src/main/filesystem.ts` (new), `src/main/ipc/filesystem.ts` (new), `src/main/ipc/index.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`

---

## Step 3 — File Tree Watcher + Open File Watcher

### 3a. Extend `src/main/watchers.ts`

Add a third watcher for the workspace root, integrated into the existing `startWatchers`/`stopWatchers` lifecycle:

```ts
let fileTreeWatcher: chokidar.FSWatcher | null = null;
```

The `ALWAYS_EXCLUDED` constant from `filesystem.ts` is reused here to keep the ignore lists in sync:

```ts
chokidar.watch(workspacePath, {
  ignoreInitial: true,
  ignored: [
    "**/node_modules/**",
    "**/.git/**",
    "**/.worktrees/**",
    "**/.tasks/**",
    "**/.milestones/**",
    "**/.decisions/**",
    "**/.grove/**",
  ],
  depth: 20,
  awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
});
```

**Structural changes only:** Listen for `add`, `unlink`, `addDir`, `unlinkDir` events — NOT `change` (content changes). Send `fs:treeChanged` to renderer.

**Debounce:** 500ms (increased from initial 300ms to handle bulk operations like `git checkout` that produce hundreds of events). Use a module-level timer:

```ts
let treeDebounceTimer: NodeJS.Timeout | null = null;
fileTreeWatcher.on("all", (event) => {
  if (["add", "unlink", "addDir", "unlinkDir"].includes(event)) {
    if (treeDebounceTimer) clearTimeout(treeDebounceTimer);
    treeDebounceTimer = setTimeout(() => {
      mainWindow.webContents.send("fs:treeChanged");
    }, 500);
  }
});
```

**Lifecycle integration:** The new watcher is started in `startWatchers()` and stopped in `stopWatchers()`, following the exact same pattern as the task and milestone watchers. This ensures proper cleanup on workspace switch.

### 3b. Add file content watcher for open file

Instead of a separate `fs:watchFile` IPC handler, the open file watcher is started automatically when `fs:readFile` is called. This keeps watcher lifecycle management entirely in the main process (consistent with existing patterns):

```ts
let openFileWatcher: chokidar.FSWatcher | null = null;

function watchOpenFile(filePath: string, mainWindow: BrowserWindow): void {
  unwatchOpenFile();
  openFileWatcher = chokidar.watch(filePath, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });
  openFileWatcher.on("change", () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send("fs:fileChanged", filePath);
    }
  });
}
```

The `fs:readFile` IPC handler calls `watchOpenFile()` after successfully reading the file. When a new file is opened, the previous watch is replaced. `stopWatchers()` also calls `unwatchOpenFile()`.

### 3c. Add to preload

```ts
fs: {
  // ... existing tree + readFile
  onTreeChanged: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('fs:treeChanged', handler)
    return () => ipcRenderer.removeListener('fs:treeChanged', handler)
  },
  onFileChanged: (callback: (filePath: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, filePath: string) => callback(filePath)
    ipcRenderer.on('fs:fileChanged', handler)
    return () => ipcRenderer.removeListener('fs:fileChanged', handler)
  },
}
```

**Files changed:** `src/main/watchers.ts`, `src/main/ipc/filesystem.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`

---

## Step 4 — Zustand: File Store

### 4a. Create `src/renderer/src/stores/useFileStore.ts`

```ts
interface FileState {
  tree: FileTreeNode[];
  treeLoading: boolean;
  openFilePath: string | null; // relative path (absolute derived when needed)
  fileContent: FileContent | null;
  fileBinary: boolean;
  fileTooLarge: boolean;
  fileTooLargeSize: number | null;
  fileLoading: boolean;
  searchQuery: string;
  searchActive: boolean;
  expandedDirs: string[]; // relative dir paths, stored as array (Set not serializable)
  searchFocusCounter: number; // increment to trigger focus (avoids race conditions)

  // Actions
  fetchTree: () => Promise<void>;
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
```

**Key design decisions (from review):**

- **No `openFileAbsolutePath`:** Only store the relative path. Absolute path is derived on demand from `workspacePath + relativePath` when calling IPC. This eliminates a source of inconsistency.
- **`expandedDirs` as `string[]` not `Set<string>`:** Zustand doesn't natively serialize `Set`. Use an array and derive a `Set` for O(1) lookups inside components via `useMemo`. Persist to `localStorage` per workspace (key: `grove:expandedDirs:<workspacePath>`).
- **`searchFocusCounter` instead of boolean:** Increment on each `requestSearchFocus()` call. `FileSearch` watches for changes via `useEffect` and focuses the input. This avoids the clear/race problem with a boolean flag.
- **`fetchTree()` reads `activeWorkspacePath` from `useWorkspaceStore.getState()`** — same cross-store pattern used by `useDataStore.fetchData()`.
- **`openFile(path)` calls `window.api.fs.readFile(workspacePath, relativePath)`** — the main process auto-starts watching that file (no separate `watchFile` call needed).
- **Debounce `fetchTree`** by 200ms (same pattern as `useDataStore.fetchData`).

**Files changed:** `src/renderer/src/stores/useFileStore.ts` (new)

---

## Step 5 — File Tree Component

### 5a. Create `src/renderer/src/components/Files/FileTree.tsx`

Recursive tree component rendering `FileTreeNode[]`:

- **Layout:** Left panel within the Files view, 280px wide, `--bg-surface` background, right border `--border`
- **Directory rows:** Chevron icon (right when collapsed, down when expanded) + folder icon + name. Click toggles expand/collapse.
- **File rows:** File type icon (extension badge) + name. Click opens in viewer.
- **Indent guides:** Subtle `1px` vertical lines at each nesting level using `--border-dim` color. `padding-left: (depth * 16)px`.
- **Selected file:** Highlighted with `--bg-active` background and `--accent` left border
- **Hover:** `--bg-hover` background
- **Font:** `--font-ui`, 13px, `--text-primary` for names, `--text-secondary` for directory names
- **Performance:** Memoize tree node components with `React.memo` to prevent re-renders when sibling nodes change. For v1 this is sufficient — virtual scrolling deferred to Phase 11 per VISION.md.
- **Keyboard navigation:**
  - `ArrowDown` / `ArrowUp` — move focus through visible (non-collapsed) items
  - `ArrowRight` — expand directory (or move to first child if already expanded)
  - `ArrowLeft` — collapse directory (or move to parent if already collapsed / is a file)
  - `Enter` — open file / toggle directory
  - The tree container has `tabIndex={0}` and manages focus state internally

### 5b. Create `src/renderer/src/components/Files/FileTree.module.css`

Styles for tree layout, indent guides, row states, icons.

### 5c. File icon mapping utility

**`src/renderer/src/components/Files/fileIcons.ts`**

Simple map from extension to a character label. Keep it lightweight — no icon library:

```ts
const FILE_ICONS: Record<string, string> = {
  ".ts": "TS",
  ".tsx": "TX",
  ".js": "JS",
  ".jsx": "JX",
  ".json": "{}",
  ".md": "MD",
  ".css": "CS",
  ".html": "<>",
  ".py": "PY",
  ".go": "GO",
  ".rs": "RS",
  ".sql": "SQ",
  ".yml": "YM",
  ".yaml": "YM",
  ".sh": "$_",
  ".toml": "TM",
  // default: generic file icon
};
```

Also handle well-known extensionless files:

```ts
const FILENAME_ICONS: Record<string, string> = {
  Makefile: "MK",
  Dockerfile: "DK",
  LICENSE: "LI",
  ".gitignore": "GI",
  ".env": "EN",
};
```

Render as small monospace badge in `--text-lo` color.

**Files changed:** `src/renderer/src/components/Files/FileTree.tsx` (new), `src/renderer/src/components/Files/FileTree.module.css` (new), `src/renderer/src/components/Files/fileIcons.ts` (new)

---

## Step 6 — Fuzzy File Search

### 6a. Create `src/renderer/src/components/Files/FileSearch.tsx`

Search input at the top of the file tree panel:

- **Input:** Full width, `--bg-elevated` background, `--border` border, `--font-mono` 13px, placeholder "Search files... (Cmd+P)"
- **Behavior:** When query is non-empty, the tree view is replaced by a flat filtered list of results
- **Fuse.js setup:**
  ```ts
  const fuse = new Fuse(flatPaths, {
    keys: ["name", "path"],
    threshold: 0.3, // tighter than default to reduce noise
    distance: 100,
    ignoreLocation: true, // match anywhere in the string
    includeMatches: true,
  });
  ```
  `flatPaths` is computed from the tree (flattened recursively on tree changes). Weight the `name` key higher than `path` so filename matches rank above directory matches.
- **Result rows:** Filename in bold (`--text-primary`), directory path dimmed (`--text-secondary`), matched characters highlighted with `--accent` color
- **Keyboard:**
  - `ArrowDown`/`ArrowUp` navigate results
  - `Enter` opens selected file and clears search
  - `Escape` clears search query and returns to tree view

### 6b. Global keyboard shortcut: `Cmd+P`

**`src/renderer/src/hooks/useKeyboardShortcuts.ts`**

Add `Cmd+P` / `Ctrl+P` shortcut:

- If already in Files view: focus the search input
- If in another view: switch to Files view and focus search input
- Calls `useFileStore.getState().requestSearchFocus()` which increments `searchFocusCounter`
- `FileSearch` component watches `searchFocusCounter` via `useEffect` and focuses the input on change

### 6c. Create `src/renderer/src/components/Files/FileSearch.module.css`

**Files changed:** `src/renderer/src/components/Files/FileSearch.tsx` (new), `src/renderer/src/components/Files/FileSearch.module.css` (new), `src/renderer/src/hooks/useKeyboardShortcuts.ts`, `src/renderer/src/stores/useFileStore.ts`

---

## Step 7 — File Viewer Component

### 7a. Shiki Theme Setup

**`src/renderer/src/components/Files/shikiTheme.ts`** (new)

Create a custom Shiki theme object derived from the app's CSS variable values (hardcoded to match `variables.css` — Shiki requires concrete hex values, not CSS variables):

```ts
export const groveTheme: ThemeRegistration = {
  name: "grove-dark",
  type: "dark",
  colors: {
    "editor.background": "#101012",
    "editor.foreground": "#e2e2e6",
    "editorLineNumber.foreground": "#44444e",
  },
  tokenColors: [
    { scope: ["keyword", "storage"], settings: { foreground: "#7b68ee" } },
    { scope: ["string"], settings: { foreground: "#3ecf8e" } },
    {
      scope: ["comment"],
      settings: { foreground: "#44444e", fontStyle: "italic" },
    },
    { scope: ["number", "constant"], settings: { foreground: "#e8a44a" } },
    {
      scope: ["function", "entity.name.function"],
      settings: { foreground: "#5ba3f5" },
    },
    {
      scope: ["type", "entity.name.type"],
      settings: { foreground: "#e8a44a" },
    },
    { scope: ["variable"], settings: { foreground: "#e2e2e6" } },
    // ... more scopes as needed
  ],
};
```

### 7b. Shiki Highlighter Singleton

**`src/renderer/src/components/Files/shikiHighlighter.ts`** (new)

Lazy-loaded, cached highlighter instance:

```ts
import { createHighlighter, type Highlighter } from "shiki";
import { groveTheme } from "./shikiTheme";

let highlighterPromise: Promise<Highlighter> | null = null;

export function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [groveTheme],
      langs: [
        "typescript",
        "tsx",
        "javascript",
        "jsx",
        "python",
        "go",
        "rust",
        "sql",
        "yaml",
        "json",
        "markdown",
        "bash",
        "dockerfile",
        "css",
        "html",
        "toml",
        "xml",
        "graphql",
      ],
    });
  }
  return highlighterPromise;
}
```

### 7c. File Viewer Component

**`src/renderer/src/components/Files/FileViewer.tsx`** (new)

Uses `codeToTokens()` instead of `codeToHtml()` to render tokens as React elements. This avoids `dangerouslySetInnerHTML` and its XSS risks (file content could contain malicious HTML if Shiki ever had an escaping bug). It also gives more control for future features like click-to-copy line numbers.

- **Header bar:**
  - Path as breadcrumb: directory segments dimmed (`--text-secondary`), filename normal weight (`--text-primary`), all in `--font-mono` 13px
  - Language badge: small pill with `--bg-elevated` background, `--font-mono`
  - Line count: `N lines` in `--text-lo`
  - "READ ONLY" badge: small, `--text-lo` text, `--bg-elevated` background
- **Code area:**
  - Background: `--bg-surface`
  - Line numbers: `--text-lo`, `--font-mono`, right-aligned in a 48px fixed gutter
  - Code rendered as React elements from Shiki's `codeToTokens()`:
    ```tsx
    const { tokens } = await highlighter.codeToTokens(code, {
      lang,
      theme: "grove-dark",
    });
    // Render each line as a <div>, each token as a <span style={{ color: token.color }}>
    ```
  - `user-select: text` (allow copy), but no cursor blink or caret styling
  - Horizontal scrolling for long lines (no line wrapping)
- **Binary file state:** Centered message "Binary file — cannot display" in `--text-lo`
- **Too-large file state:** Centered message "File too large to display (4.2 MB)" with a hint "Open in external editor" in `--text-lo`
- **Loading state:** Centered "Loading..." text while Shiki initializes or file is being fetched
- **Auto-reload with flash:**
  - On `fs:fileChanged` events, `useFileStore.reloadOpenFile()` is called
  - On reload, briefly flash the entire code area background with `--accent-dim` for 200ms using a CSS animation class
  - **Note:** VISION.md specifies per-line flash on changed lines. For v1, flashing the entire viewer is a practical simplification — per-line flash requires diffing old vs new content and is deferred to a future iteration.

### 7d. Create `src/renderer/src/components/Files/FileViewer.module.css`

Styles for header, breadcrumb, code area, line numbers, badges, flash animation.

```css
@keyframes fileReloadFlash {
  0% {
    background-color: var(--accent-dim);
  }
  100% {
    background-color: var(--bg-surface);
  }
}

.flash {
  animation: fileReloadFlash 200ms ease-out;
}
```

**Files changed:** `src/renderer/src/components/Files/shikiTheme.ts` (new), `src/renderer/src/components/Files/shikiHighlighter.ts` (new), `src/renderer/src/components/Files/FileViewer.tsx` (new), `src/renderer/src/components/Files/FileViewer.module.css` (new)

---

## Step 8 — Files View Composition + Wiring

### 8a. Create `src/renderer/src/components/Files/FilesView.tsx`

Container component that composes the file tree and file viewer side by side:

```
+-------------------------------------------------+
| [FileSearch input]        |  path/to/file.ts    |
| ----------------------    |  TS  .  142 lines   |
|  > src/                   |  READ ONLY          |
|    > main/                | --------------------|
|      index.ts             |  1 | import { app } |
|      config.ts            |  2 | import { join } |
|    > renderer/            |  3 |                 |
|      > src/               |  4 | let mainWindow  |
|        App.tsx    <--     |  5 | ...             |
|        main.tsx           |                      |
|                           |                      |
+-------------------------------------------------+
```

- **Layout:** Flex row. Tree panel 280px fixed width. Viewer panel flex 1.
- **No file selected state:** Viewer panel shows centered message "Select a file to view" in `--text-lo`
- **Tree fetch:** On mount (and on workspace switch), calls `useFileStore.fetchTree()`
- **Tree refresh:** Listens for `fs:treeChanged` events and calls `fetchTree()`

### 8b. Wire into MainArea

**`src/renderer/src/components/MainArea/MainArea.tsx`**

```tsx
if (activeView === "files") {
  return (
    <div className={styles.mainAreaContent}>
      <FilesView />
    </div>
  );
}
```

### 8c. Wire IPC listeners in App.tsx

Add `fs:treeChanged` and `fs:fileChanged` listeners in `App.tsx` (following the same pattern as the existing `workspace:dataChanged` listener):

```tsx
// File tree structural changes
useEffect(() => {
  const unsub = window.api.fs.onTreeChanged(() => {
    useFileStore.getState().fetchTree(); // debounced in store
  });
  return unsub;
}, []);

// Open file content changes (agent modified a file)
useEffect(() => {
  const unsub = window.api.fs.onFileChanged(() => {
    useFileStore.getState().reloadOpenFile();
  });
  return unsub;
}, []);
```

Also clear the file store on workspace switch (add to existing workspace switch effect):

```tsx
useEffect(() => {
  clearData();
  useFileStore.getState().clear();
  if (activeWorkspacePath) {
    fetchData();
  }
}, [activeWorkspacePath, clearData, fetchData]);
```

**Files changed:** `src/renderer/src/components/Files/FilesView.tsx` (new), `src/renderer/src/components/MainArea/MainArea.tsx`, `src/renderer/src/App.tsx`

---

## Implementation Order

| #   | Task                                                  | Effort | Dependencies                 |
| --- | ----------------------------------------------------- | ------ | ---------------------------- |
| 0   | Install dependencies (`shiki`, `fuse.js`, `ignore`)   | S      | None                         |
| BF  | Board alignment bug fix                               | S      | None                         |
| 1   | Add `'files'` to nav system                           | S      | Bug fix (uses new CSS class) |
| 2   | IPC handlers: `fs:tree`, `fs:readFile` + shared types | M      | Deps installed               |
| 3   | File tree watcher + open file watcher                 | M      | Step 2                       |
| 4   | Zustand file store                                    | M      | Steps 2-3                    |
| 5   | File tree component                                   | L      | Step 4                       |
| 6   | Fuzzy file search                                     | M      | Steps 4-5                    |
| 7   | File viewer + Shiki setup                             | L      | Steps 4, 2                   |
| 8   | Files view composition + wiring                       | M      | Steps 5-7                    |

**Total estimated effort:** ~2-3 days for an experienced developer

---

## New Files Summary

| File                                                      | Purpose                                                               |
| --------------------------------------------------------- | --------------------------------------------------------------------- |
| `src/main/filesystem.ts`                                  | `buildFileTree()` + `readFileContent()` + gitignore + path validation |
| `src/main/ipc/filesystem.ts`                              | IPC handlers for `fs:tree`, `fs:readFile`                             |
| `src/renderer/src/stores/useFileStore.ts`                 | Zustand store for file tree + viewer state                            |
| `src/renderer/src/components/Files/FilesView.tsx`         | Container: tree + viewer layout                                       |
| `src/renderer/src/components/Files/FileTree.tsx`          | Recursive tree component                                              |
| `src/renderer/src/components/Files/FileTree.module.css`   | Tree styles                                                           |
| `src/renderer/src/components/Files/FileSearch.tsx`        | Fuzzy search input + results                                          |
| `src/renderer/src/components/Files/FileSearch.module.css` | Search styles                                                         |
| `src/renderer/src/components/Files/FileViewer.tsx`        | Syntax-highlighted read-only viewer                                   |
| `src/renderer/src/components/Files/FileViewer.module.css` | Viewer styles                                                         |
| `src/renderer/src/components/Files/shikiTheme.ts`         | Custom Shiki theme from app palette                                   |
| `src/renderer/src/components/Files/shikiHighlighter.ts`   | Lazy singleton highlighter                                            |
| `src/renderer/src/components/Files/fileIcons.ts`          | Extension + filename to icon map                                      |

## Modified Files Summary

| File                                                       | Change                                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `package.json`                                             | Add `shiki`, `fuse.js`, `ignore`                                                           |
| `src/shared/types.ts`                                      | Add `FileTreeNode`, `FileContent`, `FileReadResult`                                        |
| `src/main/ipc/index.ts`                                    | Register filesystem IPC handlers                                                           |
| `src/main/watchers.ts`                                     | Add file tree watcher + open file watcher (integrated into start/stop lifecycle)           |
| `src/preload/index.ts`                                     | Add `fs` namespace to API                                                                  |
| `src/preload/index.d.ts`                                   | Add `fs` type declarations                                                                 |
| `src/renderer/src/stores/useNavStore.ts`                   | Add `'files'` to `View` type                                                               |
| `src/renderer/src/components/Sidebar/BottomNav.tsx`        | Add "Files" nav item                                                                       |
| `src/renderer/src/components/MainArea/MainArea.tsx`        | Add Files view route + use `.mainAreaContent` for Board                                    |
| `src/renderer/src/components/MainArea/MainArea.module.css` | Add `.mainAreaContent` class                                                               |
| `src/renderer/src/hooks/useKeyboardShortcuts.ts`           | Add `Cmd+P` shortcut                                                                       |
| `src/renderer/src/App.tsx`                                 | Add `fs:treeChanged` and `fs:fileChanged` listeners + clear file store on workspace switch |

---

## Review Decisions Log

Changes incorporated from senior review:

| #   | Issue                                                                | Severity  | Resolution                                                                                                      |
| --- | -------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | `fs:readFile` accepts arbitrary absolute path — path traversal risk  | Critical  | Changed to accept `workspacePath` + `relativePath`; main process validates resolved path stays within workspace |
| 2   | `fs:tree` accepts arbitrary `workspacePath` — directory listing risk | Critical  | IPC handler validates `workspacePath` is a registered workspace                                                 |
| 3   | No file size limit — Shiki freeze on large files                     | Important | Added 1MB size check; new `tooLarge` result type                                                                |
| 4   | `codeToHtml` + `dangerouslySetInnerHTML` — XSS vector                | Important | Switched to `codeToTokens()` rendering tokens as React elements                                                 |
| 5   | File tree watcher not integrated into `startWatchers`/`stopWatchers` | Important | Explicitly integrated into existing lifecycle                                                                   |
| 6   | `fs:watchFile` as separate IPC call deviates from patterns           | Important | File watching is now automatic on `fs:readFile` — no separate IPC call                                          |
| 7   | Tree rebuild debounce too aggressive (300ms)                         | Important | Increased to 500ms                                                                                              |
| 8   | `expandedDirs` as `Set<string>` not serializable                     | Important | Changed to `string[]` with derived `Set` in components                                                          |
| 9   | `searchFocusRequested` boolean is race-prone                         | Minor     | Changed to `searchFocusCounter: number` pattern                                                                 |
| 10  | Nested `.gitignore` handling is complex                              | Minor     | Deferred to root `.gitignore` only for v1                                                                       |
| 11  | Missing filename-based language detection                            | Minor     | Added `FILENAME_MAP` for Makefile, Dockerfile, etc.                                                             |
| 12  | Missing symlink handling                                             | Minor     | Skip symlinks entirely for v1                                                                                   |
| 13  | Missing per-directory error handling                                 | Minor     | Wrap `readdir` in try/catch, skip unreadable dirs                                                               |
| 14  | Fuse.js threshold too permissive                                     | Minor     | Tightened to 0.3, added `distance`/`ignoreLocation`                                                             |
| 15  | `openFileAbsolutePath` redundant                                     | Nit       | Removed; derive from workspace path + relative path                                                             |
| 16  | `@types/fuse.js` doesn't exist                                       | Nit       | Removed from install command                                                                                    |
| 17  | Per-line flash vs whole-area flash                                   | Nit       | Documented as conscious v1 simplification                                                                       |

---

## Acceptance Criteria

1. Click "Files" in sidebar -> tree renders respecting `.gitignore`
2. Collapse/expand directories with click, arrow keys, or enter
3. `Cmd+P` opens fuzzy search from anywhere in the app
4. Enter on a search result opens the file with syntax highlighting
5. File viewer shows path breadcrumb, language badge, line count, "READ ONLY" badge
6. Binary files show "Binary file — cannot display" message
7. Files > 1MB show "File too large to display" message
8. Agent edits a file in the terminal -> viewer auto-reloads with a brief flash
9. Board view renders without centering issues (bug fix verified)
10. Tree refreshes when files are added/removed on disk
11. Expanded directory state persists per workspace across sessions
12. Path traversal attempts are rejected by the main process
13. Symlinks are skipped in the tree
14. Unreadable directories are silently skipped
