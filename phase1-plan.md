# Phase 1 — Detailed Implementation Plan: Electron Shell + Workspace Management

## Goal

A working Electron app with workspace switching. No tasks yet. Just the skeleton — scaffold, config persistence, sidebar with workspace list, and a main content area placeholder.

## Done When

You can register multiple repos, switch between them, and the active workspace is highlighted in the sidebar with its branch shown. State persists across restarts. The app window is frameless, remembers size/position, and has the correct dark theme.

---

## 1. Project Scaffolding

### 1.1 Initialize electron-vite project

Run `npm create @quick-start/electron@latest grove -- --template react-ts` to scaffold the project.

After scaffolding, verify the generated structure and reconcile any differences. The template may vary between versions — the key requirement is that three entry points exist: `main`, `preload`, and `renderer`. Adjust paths in later steps to match the actual scaffold output.

Expected structure:

```
grove/
├── src/
│   ├── main/
│   │   └── index.ts
│   ├── preload/
│   │   ├── index.ts
│   │   └── index.d.ts
│   └── renderer/
│       ├── src/
│       │   ├── App.tsx
│       │   ├── main.tsx
│       │   └── ...
│       └── index.html
├── electron.vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── tsconfig.web.json
└── package.json
```

### 1.2 Install Phase 1 dependencies

```bash
npm install simple-git zustand
npm install -D @types/node
```

Config storage will use a custom JSON read/write utility with atomic writes (~30 lines) rather than `electron-store`. This avoids ESM compatibility concerns and gives full control over the read/write/validation cycle.

### 1.3 Configure TypeScript

- `tsconfig.node.json` — main + preload, targets Node, includes `src/main/**/*` and `src/preload/**/*`
- `tsconfig.web.json` — renderer, targets DOM, includes `src/renderer/**/*`
- Add `"electron-vite/node"` to `compilerOptions.types` in `tsconfig.node.json`
- Enable `strict: true` in all configs
- Configure path aliases if desired (e.g., `@shared/*` → `src/shared/*`)

### 1.4 Set up project structure

Extend the scaffolded structure to:

```
src/
├── main/
│   ├── index.ts              # App lifecycle, window creation, single-instance lock
│   ├── config.ts             # ConfigManager class (in-memory + disk flush)
│   ├── window-state.ts       # Window size/position persistence
│   └── ipc/
│       ├── workspace.ts      # Workspace IPC handlers
│       └── index.ts          # Register all handlers
├── preload/
│   ├── index.ts              # contextBridge.exposeInMainWorld
│   └── index.d.ts            # Window.api type augmentation (imports from shared)
├── renderer/
│   ├── src/
│   │   ├── App.tsx           # Root component with ErrorBoundary, layout shell
│   │   ├── main.tsx          # React entry point
│   │   ├── components/
│   │   │   ├── Sidebar/
│   │   │   │   ├── Sidebar.tsx
│   │   │   │   ├── Sidebar.module.css
│   │   │   │   ├── WorkspaceList.tsx
│   │   │   │   ├── WorkspaceItem.tsx
│   │   │   │   ├── BottomNav.tsx
│   │   │   │   ├── AppWordmark.tsx
│   │   │   │   └── ContextMenu.tsx
│   │   │   ├── TitleBar/
│   │   │   │   ├── TitleBar.tsx
│   │   │   │   └── TitleBar.module.css
│   │   │   ├── MainArea/
│   │   │   │   ├── MainArea.tsx
│   │   │   │   └── MainArea.module.css
│   │   │   └── ErrorBoundary/
│   │   │       └── ErrorBoundary.tsx
│   │   ├── stores/
│   │   │   ├── useWorkspaceStore.ts
│   │   │   └── useNavStore.ts
│   │   ├── styles/
│   │   │   ├── variables.css   # CSS custom properties (design tokens)
│   │   │   ├── reset.css       # Minimal CSS reset
│   │   │   └── global.css      # Global styles, font imports
│   │   └── types/
│   │       └── index.ts        # Renderer-specific types (re-exports shared)
│   └── index.html
└── shared/
    └── types.ts              # Single source of truth for types shared between main + renderer
```

### 1.5 Set up fonts

Bundle font files in `resources/fonts/` for offline use (desktop app should not depend on external CDN):

- `Figtree` — Variable weight, woff2 format
- `JetBrains Mono` — Regular + Bold, woff2 format

Write `@font-face` declarations in `global.css`. Configure `electron.vite.config.ts` to handle font assets correctly in both dev and production builds. Test that fonts load in both `npm run dev` and after `npm run build`.

> **Note:** If asset path resolution proves tricky with electron-vite, fall back to Google Fonts `@import` in `global.css` for initial development, then revisit bundling before Phase 11 (packaging).

### 1.6 Configure .gitignore

```
node_modules/
out/
dist/
.DS_Store
*.log
```

### 1.7 Configure electron.vite.config.ts

Adjust the config for:

- Font/asset handling (copy plugin or public directory for bundled fonts)
- `simple-git` as an external in the main process build (it spawns child processes)
- Any path aliases matching `tsconfig.json`

### 1.8 Content Security Policy

Add a strict CSP to `index.html`:

```html
<meta
  http-equiv="Content-Security-Policy"
  content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'"
/>
```

This prevents XSS and remote code execution. Adjust if Google Fonts fallback is used (add `https://fonts.googleapis.com` and `https://fonts.gstatic.com` to `style-src` and `font-src`).

---

## 2. Design System Foundation

### 2.1 CSS Variables (`variables.css`)

Define all design tokens from the VISION.md spec:

```css
:root {
  /* Backgrounds */
  --bg-base: #0b0b0d;
  --bg-surface: #101012;
  --bg-elevated: #141417;
  --bg-hover: #32323f;
  --bg-active: #1a1a22;

  /* Borders */
  --border: #242430;
  --border-dim: #1a1a24;

  /* Text */
  --text-primary: #e2e2e6;
  --text-secondary: #8b8b96;
  --text-lo: #44444e;

  /* Accent */
  --accent: #7b68ee;
  --accent-dim: rgba(123, 104, 238, 0.15);

  /* Status */
  --status-green: #3ecf8e;
  --status-amber: #e8a44a;
  --status-red: #e05c5c;
  --status-blue: #5ba3f5;

  /* Fonts */
  --font-ui: "Figtree", -apple-system, sans-serif;
  --font-mono: "JetBrains Mono", monospace;

  /* Layout */
  --sidebar-width: 240px;
  --titlebar-height: 40px;

  /* Radii */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;

  /* Transitions */
  --transition-fast: 120ms ease;
  --transition-normal: 200ms ease;
}
```

### 2.2 CSS Reset (`reset.css`)

Minimal reset:

- `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }`
- Inherit font on all elements
- Remove default list styles
- `img, svg { display: block; max-width: 100%; }`
- `:focus-visible` outline style (accent-colored for keyboard accessibility)
- `:focus:not(:focus-visible) { outline: none; }` — hide outline on mouse click

### 2.3 Global Styles (`global.css`)

- Import `variables.css` and `reset.css`
- `@font-face` declarations for bundled fonts
- `html, body, #root { height: 100%; overflow: hidden; }`
- `body` — background `--bg-base`, color `--text-primary`, font `--font-ui`, font-size 13px
- Custom scrollbar styling (8px wide, `--bg-surface` track, `--border` thumb, round on hover)
- `::selection` — background `--accent` at 30% opacity

---

## 3. Main Process Implementation

### 3.1 Single Instance Lock (`index.ts`)

Prevent multiple app instances from corrupting the shared config file:

```ts
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // Focus existing window if user tries to open second instance
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
```

### 3.2 App Config (`config.ts`)

**Config file location:** `app.getPath('userData')/config.json`

- macOS: `~/Library/Application Support/grove/config.json`
- Linux: `~/.config/grove/config.json`
- Windows: `%APPDATA%/grove/config.json`

**Schema** (defined in `src/shared/types.ts`):

```ts
interface AppConfig {
  workspaces: WorkspaceEntry[];
  lastActiveWorkspace: string | null; // path-based identifier
}

interface WorkspaceEntry {
  name: string; // Display label (derived from dirname)
  path: string; // Absolute path — the unique identifier
}
```

**Implementation — `ConfigManager` class (in-memory with disk flush):**

```ts
class ConfigManager {
  private config: AppConfig;
  private configPath: string;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.configPath = path.join(app.getPath("userData"), "config.json");
    this.config = this.loadFromDisk();
  }

  get(): AppConfig {
    return this.config;
  }

  update(fn: (config: AppConfig) => void): void {
    fn(this.config);
    this.scheduleSave();
  }

  /** Debounced save — coalesces rapid updates */
  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.writeToDisk(), 300);
  }

  /** Synchronous flush — called on app quit */
  flushSync(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.writeToDiskSync();
  }

  private loadFromDisk(): AppConfig {
    // If file doesn't exist or is corrupt, return defaults
    // Never throw — always recover gracefully
  }

  private writeToDisk(): void {
    // Atomic write: write to config.json.tmp, then rename
  }

  private writeToDiskSync(): void {
    // Same as writeToDisk but synchronous (for app quit)
  }
}
```

**Key design decisions:**

- Config is held in memory as the source of truth. Disk is a persistence layer, not the read source.
- Debounced writes (300ms) prevent rapid disk I/O when multiple config changes happen together.
- `flushSync()` ensures data is saved before app exits.
- Atomic writes (tmp + rename) prevent corrupt files on crash.
- No silent deletion of workspaces with invalid paths — paths are validated at read time and marked `exists: false` in the returned data, but config is never mutated automatically.
- Race conditions eliminated: all mutations go through the single `ConfigManager` instance. No concurrent read-modify-write from disk.

### 3.3 Window State Persistence (`window-state.ts`)

Custom implementation (~60 lines) rather than `electron-window-state` (unmaintained since 2018):

**Persisted state:**

```ts
interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
}
```

**File:** `app.getPath('userData')/window-state.json`

**Logic:**

1. **Load:** Read saved state. Validate position is on a visible display using `screen.getDisplayMatching(bounds)`. If saved position is off-screen (monitor disconnected), fall back to centered on primary display.
2. **Defaults:** `1200 x 800`, centered on primary display.
3. **Save:** Register `resize` and `move` event listeners — debounced at 500ms. Track `maximize`/`unmaximize` events.
4. **On close:** Save final state synchronously. If window is minimized, skip saving dimensions (they may be invalid on some platforms).
5. **Restore:** After window creation, if `isMaximized` was true, call `mainWindow.maximize()`.

**Export:** A factory function `createWindowStateKeeper(defaults)` that returns `{ state, manage(window), unmanage() }`.

### 3.4 Main Process Entry (`index.ts`)

**Window creation:**

```ts
const mainWindow = new BrowserWindow({
  ...windowState, // x, y, width, height from persistence
  minWidth: 900,
  minHeight: 600,
  titleBarStyle: "hidden",
  trafficLightPosition: { x: 12, y: 12 }, // macOS only
  ...(process.platform !== "darwin"
    ? {
        titleBarOverlay: {
          color: "#0b0b0d",
          symbolColor: "#8b8b96",
          height: 40,
        },
      }
    : {}),
  backgroundColor: "#0b0b0d", // Prevents white flash on startup
  webPreferences: {
    preload: join(__dirname, "../preload/index.js"),
    // sandbox defaults to true — do NOT set sandbox: false
    // All Node.js work (git, fs, config) runs in main process, not preload
  },
});
```

**Lifecycle:**

1. Single-instance lock (section 3.1)
2. `app.whenReady()` → create `ConfigManager`, create window state keeper, create window, register IPC handlers, load URL
3. `app.on('before-quit')` → `configManager.flushSync()`, save window state
4. `app.on('window-all-closed')` → `app.quit()` (on all platforms — macOS dock convention not needed for a dev tool)
5. `app.on('activate')` → recreate window if none exist (macOS)

**Platform info IPC:** Register a simple handler `app:getPlatform` that returns `process.platform`. The renderer uses this to adjust titlebar padding for macOS traffic lights.

### 3.5 IPC Handlers — Workspace (`ipc/workspace.ts`)

All handlers use `path` as the workspace identifier (not `name` — `name` is a display label only).

**Error handling pattern:** Every handler wraps in try/catch and returns a structured result:

```ts
type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };
```

| Channel               | Input          | Handler                                                                                | Returns                             |
| --------------------- | -------------- | -------------------------------------------------------------------------------------- | ----------------------------------- |
| `workspace:list`      | none           | Read config, for each workspace: check `fs.existsSync(path)`, get git branch if exists | `IpcResult<WorkspaceInfo[]>`        |
| `workspace:add`       | none           | Open folder dialog, validate, check duplicates, append to config                       | `IpcResult<WorkspaceEntry \| null>` |
| `workspace:addPath`   | `path: string` | Validate path, check duplicates, append to config (for testing/programmatic use)       | `IpcResult<WorkspaceEntry>`         |
| `workspace:remove`    | `path: string` | Filter workspace from config, write config                                             | `IpcResult<void>`                   |
| `workspace:setActive` | `path: string` | Update `lastActiveWorkspace` in config                                                 | `IpcResult<void>`                   |
| `workspace:getActive` | none           | Return `lastActiveWorkspace` from config                                               | `IpcResult<string \| null>`         |
| `workspace:getBranch` | `path: string` | `simple-git(path).revparse(['--abbrev-ref', 'HEAD'])`                                  | `IpcResult<string>`                 |

**`workspace:list` detail:**

```ts
async function handleWorkspaceList(): Promise<IpcResult<WorkspaceInfo[]>> {
  const config = configManager.get();
  const workspaces: WorkspaceInfo[] = [];

  for (const entry of config.workspaces) {
    const exists = fs.existsSync(entry.path);
    let branch: string | null = null;
    let isGitRepo = false;

    if (exists) {
      try {
        const git = simpleGit(entry.path);
        isGitRepo = await git.checkIsRepo();
        if (isGitRepo) {
          const raw = await git.revparse(["--abbrev-ref", "HEAD"]);
          branch = raw.trim() === "HEAD" ? "(detached)" : raw.trim();
        }
      } catch {
        // Git error — still show workspace, just without branch info
      }
    }

    workspaces.push({
      name: entry.name,
      path: entry.path,
      branch,
      isGitRepo,
      exists,
    });
  }

  return { ok: true, data: workspaces };
}
```

**`workspace:add` detail:**

1. Open native folder dialog: `dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: 'Select Workspace Folder' })`
2. If cancelled (`canceled: true`), return `{ ok: true, data: null }`
3. Extract path from `filePaths[0]`
4. Check if path already exists in config → return error `"Workspace already added"`
5. Extract name from `path.basename(selectedPath)`
6. Append `{ name, path }` to config workspaces
7. Set as active workspace
8. Return new workspace entry

**Error scenarios handled:**

- `simple-git` throws (not a git repo) → `isGitRepo: false`, `branch: null`
- `simple-git` throws (git not installed) → catch, log warning, still return workspace with `isGitRepo: false`
- Directory doesn't exist → `exists: false` in response, workspace stays in config
- File dialog cancelled → return null, no error
- Config write fails → return structured error, log to console

### 3.6 IPC Handler Registration (`ipc/index.ts`)

Import and register all handler functions. Called once from `main/index.ts` during startup:

```ts
export function registerIpcHandlers(
  configManager: ConfigManager,
  mainWindow: BrowserWindow,
): void {
  registerWorkspaceHandlers(configManager, mainWindow);
  // Future phases: registerTaskHandlers, registerGitHandlers, etc.
}
```

---

## 4. Preload Script

### 4.1 Context Bridge (`preload/index.ts`)

```ts
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  workspaces: {
    list: () => ipcRenderer.invoke("workspace:list"),
    add: () => ipcRenderer.invoke("workspace:add"),
    addPath: (path: string) => ipcRenderer.invoke("workspace:addPath", path),
    remove: (path: string) => ipcRenderer.invoke("workspace:remove", path),
    setActive: (path: string) =>
      ipcRenderer.invoke("workspace:setActive", path),
    getActive: () => ipcRenderer.invoke("workspace:getActive"),
    getBranch: (path: string) =>
      ipcRenderer.invoke("workspace:getBranch", path),
  },
  app: {
    getPlatform: () => ipcRenderer.invoke("app:getPlatform"),
  },
});
```

**Security notes:**

- Never expose raw `ipcRenderer` — always wrap in named functions
- Never pass the `event` object through the bridge
- All Node.js operations (fs, git, child_process) run in main process only
- Preload runs with sandbox enabled (default)

### 4.2 Type Declaration (`preload/index.d.ts`)

Import shared types rather than redeclaring them:

```ts
import type { WorkspaceInfo, WorkspaceEntry, IpcResult } from "../shared/types";

export interface ElectronAPI {
  workspaces: {
    list: () => Promise<IpcResult<WorkspaceInfo[]>>;
    add: () => Promise<IpcResult<WorkspaceEntry | null>>;
    addPath: (path: string) => Promise<IpcResult<WorkspaceEntry>>;
    remove: (path: string) => Promise<IpcResult<void>>;
    setActive: (path: string) => Promise<IpcResult<void>>;
    getActive: () => Promise<IpcResult<string | null>>;
    getBranch: (path: string) => Promise<IpcResult<string>>;
  };
  app: {
    getPlatform: () => Promise<NodeJS.Platform>;
  };
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
```

---

## 5. Shared Types (`src/shared/types.ts`)

Single source of truth for types used by both main and renderer:

```ts
/** Persisted in config.json */
export interface WorkspaceEntry {
  name: string; // Display label (directory basename)
  path: string; // Absolute path — unique identifier
}

/** Returned from workspace:list with runtime info */
export interface WorkspaceInfo extends WorkspaceEntry {
  branch: string | null; // Current git branch, null if not a git repo
  isGitRepo: boolean;
  exists: boolean; // false if directory no longer exists on disk
}

/** Persisted in config.json */
export interface AppConfig {
  workspaces: WorkspaceEntry[];
  lastActiveWorkspace: string | null; // workspace path
}

/** Standard IPC result wrapper */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Persisted in window-state.json */
export interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
}
```

---

## 6. Renderer — State Management

### 6.1 Workspace Store (`useWorkspaceStore.ts`)

```ts
interface WorkspaceState {
  workspaces: WorkspaceInfo[];
  activeWorkspacePath: string | null;
  loading: boolean;
  error: string | null;

  // Actions
  fetchWorkspaces: () => Promise<void>;
  addWorkspace: () => Promise<void>;
  removeWorkspace: (path: string) => Promise<void>;
  setActiveWorkspace: (path: string) => Promise<void>;
}
```

Use `create<WorkspaceState>()(...)` (double invocation for TypeScript inference).

**Action implementations:**

- `fetchWorkspaces`: calls `window.api.workspaces.list()`, checks `result.ok`, updates `workspaces` and `error`
- `addWorkspace`: calls `window.api.workspaces.add()`, if successful refetches workspace list
- `removeWorkspace`: calls `window.api.workspaces.remove(path)`, refetches list
- `setActiveWorkspace`: calls `window.api.workspaces.setActive(path)`, updates `activeWorkspacePath` locally

**Initial load:** `fetchWorkspaces` is called once in `App.tsx` via `useEffect`. It also restores `activeWorkspacePath` from `window.api.workspaces.getActive()`.

### 6.2 Navigation Store (`useNavStore.ts`)

```ts
type View = "board" | "decisions" | "terminal";

interface NavState {
  activeView: View;
  setActiveView: (view: View) => void;
}
```

Default: `'board'`. Simple store, no IPC.

---

## 7. Renderer — Components

### 7.1 Error Boundary (`ErrorBoundary.tsx`)

A root-level React error boundary wrapping the entire app:

- Catches render errors from any component
- Shows a recovery UI: "Something went wrong" with the error message and a "Reload" button
- Styled with the design system (dark background, muted text)
- Calls `window.location.reload()` on retry

This prevents the app from going blank when a component throws.

### 7.2 App Layout (`App.tsx`)

Top-level layout structure:

```
┌─────────────────────────────────────────────────┐
│ TitleBar (40px, draggable, app-region: drag)     │
├──────────────┬──────────────────────────────────┤
│ Sidebar      │ MainArea                          │
│ (240px)      │ (flex: 1)                         │
│              │                                    │
│              │  Placeholder content               │
│              │                                    │
└──────────────┴──────────────────────────────────┘
```

- Wraps everything in `<ErrorBoundary>`
- Uses CSS flexbox for the layout
- Sidebar is fixed-width `var(--sidebar-width)`
- Main area fills remaining space with `flex: 1`
- TitleBar spans full width above the sidebar + main split
- Calls `fetchWorkspaces()` in a `useEffect` on mount

### 7.3 TitleBar Component

- Height: `var(--titlebar-height)` (40px)
- Background: `--bg-base`
- CSS `app-region: drag` on the container
- On macOS: add ~70px `padding-left` to avoid overlapping traffic lights. Detect platform via `window.api.app.getPlatform()` — call once on mount, store in local state or a small Zustand store
- On Windows/Linux: `titleBarOverlay` handles window controls natively — no custom buttons needed
- Optional: display workspace name centered in the title bar (secondary text, small)

### 7.4 Sidebar Component

Structure (top to bottom):

```
┌──────────────────────────┐
│  🌿 Grove                │  ← AppWordmark
├──────────────────────────┤
│  WORKSPACES              │  ← Section label
│                          │
│  ▣ grove          [0]   │  ← WorkspaceItem (active)
│    ⎇ main                │
│  ▣ api-service    [0]   │  ← WorkspaceItem
│    ⎇ feat/auth           │
│                          │
│  + Add workspace         │  ← Add button
├──────────────────────────┤
│  (spacer)                │
├──────────────────────────┤
│  ▦ Task Board            │  ← BottomNav
│  ☐ Decisions             │
│  >_ Terminal             │
└──────────────────────────┘
```

**Sidebar styles:**

- Background: `--bg-surface`
- Border-right: `1px solid var(--border)`
- Width: `var(--sidebar-width)` (240px)
- Full height below titlebar
- `display: flex; flex-direction: column;` — spacer between workspace list and bottom nav uses `flex: 1`
- Overflow: workspace list area is scrollable (`overflow-y: auto`) if many workspaces

### 7.5 AppWordmark Component

- Height: ~40px
- Padding: 16px horizontal
- Icon: inline SVG tree/seedling glyph, 16px, `--text-secondary`
- Text: "Grove", `--font-ui`, 15px, font-weight 600, `--text-primary`
- No interaction (not clickable)

### 7.6 WorkspaceItem Component

Each workspace row:

- **Layout:** Two rows — name row and branch row
- **Name row:** Repo icon (inline SVG, 14px) + workspace name (`--text-primary`, 13px, `--font-ui`) + count badge right-aligned (`[0]`, `--text-lo`, `--font-mono`, 11px)
- **Branch row:** Indented 26px, git branch icon (inline SVG, 10px) + branch name (`--text-lo`, 11px, `--font-mono`)
- **If `exists: false`:** Dim the entire row (`opacity: 0.4`), show tooltip "Directory not found"
- **If not a git repo:** Hide the branch row
- **Active state:** Background `--bg-active`, optional subtle left border in `--accent` (2px)
- **Hover state:** Background `--bg-hover`
- **Click:** Calls `setActiveWorkspace(path)`
- **Focus:** Focusable with `tabindex="0"`, visible `:focus-visible` outline
- **Right-click:** Opens custom context menu (section 7.9)

### 7.7 WorkspaceList Component

- Maps over `workspaces` from the store
- Renders a `WorkspaceItem` for each
- Below the list: "Add workspace" button
  - Styled as a subtle text link: `+` icon + "Add workspace", `--text-lo`, 12px
  - On hover: `--text-secondary`
  - Calls `addWorkspace()` from the store
  - Keyboard accessible: `<button>` element

### 7.8 BottomNav Component

Three items stacked vertically, separated from workspace list by a border-top:

- **Task Board** — grid icon (inline SVG) + "Task Board" label
- **Decisions** — document icon (inline SVG) + "Decisions" label
- **Terminal** — `>_` text glyph + "Terminal" label

Each item:

- Padding: 8px 16px
- Font: `--font-ui`, 13px, `--text-secondary`
- Icon: 14px, `--text-lo`
- Active state: background `--bg-active`, text `--text-primary`
- Hover: background `--bg-hover`
- Click: calls `setActiveView(view)` on the nav store
- Keyboard: `role="button"`, `tabindex="0"`

### 7.9 ContextMenu Component (renderer-side)

A custom React context menu (not Electron native `Menu`):

- Positioned absolute `<div>` that appears at the right-click coordinates
- Closes on click outside (backdrop), Escape key, or item click
- For workspace items, shows:
  - "Open in Finder" / "Open in File Manager" (platform-aware label) — future enhancement, can stub or omit in Phase 1
  - "Remove workspace" — calls `removeWorkspace(path)` after confirmation
- Confirmation: inline within the menu — "Remove?" with "Yes" / "Cancel" sub-items, or a simple `window.confirm()` for Phase 1

**Why renderer-side:** Avoids IPC round-trips, is more portable, and is the pattern used by VS Code, Figma, and other modern Electron apps.

### 7.10 MainArea Component

A view switcher based on `activeView` from the nav store:

- When no workspace is active: centered "Add a workspace to get started" with a subtle button to add one
- When workspace active + `board` view: centered placeholder "Task Board — coming in Phase 2"
- When workspace active + `decisions` view: centered placeholder "Decisions — coming in Phase 9"
- When workspace active + `terminal` view: centered placeholder "Terminal — coming in Phase 6"

Each placeholder:

- Text: `--text-lo`, 14px, `--font-ui`
- Centered both vertically and horizontally
- Subtle icon above the text matching the view type

---

## 8. Branch Detection

### 8.1 Strategy: `fs.watch` on `.git/HEAD` (not polling)

Instead of polling `simple-git` every N seconds (which spawns child processes), watch the `.git/HEAD` file for changes:

```ts
// Main process — when active workspace changes
let headWatcher: fs.FSWatcher | null = null;

function watchBranch(
  workspacePath: string,
  onChange: (branch: string) => void,
): void {
  // Clean up previous watcher
  if (headWatcher) headWatcher.close();

  const headPath = path.join(workspacePath, ".git", "HEAD");
  if (!fs.existsSync(headPath)) return;

  headWatcher = fs.watch(headPath, async () => {
    try {
      const git = simpleGit(workspacePath);
      const raw = await git.revparse(["--abbrev-ref", "HEAD"]);
      const branch = raw.trim() === "HEAD" ? "(detached)" : raw.trim();
      onChange(branch);
    } catch {
      /* ignore */
    }
  });
}
```

When the branch changes, send an IPC event to the renderer:

```ts
mainWindow.webContents.send("workspace:branchChanged", {
  path: workspacePath,
  branch,
});
```

The preload exposes a listener:

```ts
onBranchChanged: (
  callback: (data: { path: string; branch: string }) => void,
) => {
  const handler = (_event: any, data: any) => callback(data);
  ipcRenderer.on("workspace:branchChanged", handler);
  return () => ipcRenderer.removeListener("workspace:branchChanged", handler);
};
```

**Advantages over polling:**

- Zero-cost when nothing changes (no child processes spawned)
- Instant detection (< 100ms vs 5–10 second polling interval)
- Same approach VS Code uses

**Fallback:** If `.git/HEAD` doesn't exist (not a git repo or bare repo), skip watching. Branch shows as `null`.

### 8.2 Initial Branch Load

On app start and on workspace switch, fetch all branches once via `workspace:list`. After that, the `fs.watch` handles live updates for the active workspace.

### 8.3 Watcher Lifecycle

- Start watching when a workspace becomes active
- Stop watching (close watcher) when switching to a different workspace
- Stop watching on app quit
- If the `.git/HEAD` file is deleted (e.g., repo deleted), the watcher emits an error — catch and clean up gracefully

---

## 9. Implementation Order

Execute these steps sequentially. Steps marked with `||` can be parallelized.

| Step | Task                                                           | Est. Time | Dependencies    |
| ---- | -------------------------------------------------------------- | --------- | --------------- |
| 1    | Scaffold electron-vite project, verify structure               | 15 min    | None            |
| 2    | Install dependencies, configure TS, update .gitignore          | 15 min    | Step 1          |
| 3    | Configure `electron.vite.config.ts` (externals, assets)        | 15 min    | Step 2          |
| 4    | Set up extended file structure (directories + empty files)     | 10 min    | Step 3          |
| 5    | Shared types (`src/shared/types.ts`)                           | 15 min    | Step 4          |
| 6    | CSS design system (variables, reset, global) + fonts           | 45 min    | Step 4          |
| 7    | CSP in `index.html`                                            | 5 min     | Step 4          |
| 8    | `ConfigManager` class (`main/config.ts`)                       | 45 min    | Step 5          |
| 9    | Window state keeper (`main/window-state.ts`)                   | 30 min    | Step 5          |
| 10   | Main process entry — lifecycle, window, single-instance lock   | 30 min    | Steps 8, 9      |
| 11   | IPC handlers — workspace operations                            | 60 min    | Steps 8, 10     |
| 12   | Branch watcher (fs.watch on .git/HEAD)                         | 30 min    | Step 11         |
| 13   | Preload script + type declarations                             | 20 min    | Steps 11, 12    |
| 14   | Zustand stores (workspace, nav)                                | 30 min    | Steps 5, 13     |
| 15   | ErrorBoundary component                                        | 15 min    | Step 6          |
| 16   | App layout shell (`App.tsx`) + TitleBar                        | 30 min    | Steps 6, 14, 15 |
| 17   | Sidebar shell + AppWordmark                                    | 20 min    | Step 16         |
| 18   | WorkspaceItem component                                        | 45 min    | Step 17         |
| 19   | WorkspaceList + add workspace flow                             | 30 min    | Step 18         |
| 20   | ContextMenu component + remove workspace                       | 30 min    | Step 18         |
| 21   | BottomNav component                                            | 20 min    | Step 17         |
| 22   | MainArea placeholder views                                     | 15 min    | Steps 16, 21    |
| 23   | Integration: initial load, workspace switching, branch updates | 30 min    | All above       |
| 24   | Testing: dev mode + production build, cross-platform checks    | 45 min    | Step 23         |
| 25   | Polish: hover states, transitions, edge cases, keyboard focus  | 30 min    | Step 24         |

**Estimated total: ~10.5 hours**

---

## 10. Acceptance Criteria

Phase 1 is complete when ALL of the following are true:

1. App launches as a frameless Electron window with the dark theme from VISION.md
2. Only one instance of the app can run at a time (second launch focuses existing window)
3. Sidebar shows "Grove" wordmark with tree/seedling icon
4. "Add workspace" opens a native folder picker dialog
5. Added workspaces appear in the sidebar with name and current git branch
6. Clicking a workspace highlights it as active
7. Active workspace persists across app restarts (`lastActiveWorkspace` in config)
8. Removing a workspace works (right-click → context menu → "Remove workspace" with confirmation)
9. Window size and position persist across restarts
10. Window position is validated against available displays on restore (handles monitor disconnection)
11. Bottom nav shows Task Board, Decisions, Terminal items with active state highlighting
12. Main area shows appropriate placeholder content based on active view and workspace state
13. No white flash on startup (`backgroundColor` set on BrowserWindow)
14. Branch name updates immediately when switched externally (via `fs.watch` on `.git/HEAD`)
15. Workspaces with deleted directories appear dimmed with "not found" indicator (not silently removed)
16. Non-git directories can be added as workspaces (branch row hidden)
17. Detached HEAD state displays as "(detached)"
18. Fonts (Figtree + JetBrains Mono) render correctly
19. All interactive elements are keyboard-accessible (`tabindex`, `:focus-visible`)
20. IPC errors are handled gracefully — errors surface in the UI, never cause crashes
21. App works in both `npm run dev` and after `npm run build`

---

## 11. Technical Decisions

| Decision           | Choice                                                                     | Reasoning                                                                                                                 |
| ------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Config storage     | Custom `ConfigManager` with in-memory state + debounced atomic disk writes | Avoids ESM compatibility issues with `electron-store`, eliminates read-modify-write races, gives full control (~60 lines) |
| Window state       | Custom `createWindowStateKeeper` (~60 lines)                               | Avoids unmaintained `electron-window-state` (last release 2018), consistent with config approach                          |
| Workspace identity | `path` as unique identifier                                                | Directory basename (`name`) can collide across repos. Path is guaranteed unique                                           |
| Font loading       | Bundled in `resources/fonts/` with `@font-face`                            | Desktop app should work offline. Fallback to Google Fonts `@import` if asset bundling proves complex                      |
| Icons              | Inline SVG React components                                                | No icon library dependency, full control over colors/size via `currentColor`, tiny footprint                              |
| Branch detection   | `fs.watch` on `.git/HEAD`                                                  | Zero-cost when idle, instant detection. Polling with `simple-git` spawns a child process every N seconds                  |
| Context menu       | Custom renderer-side React component                                       | Avoids IPC round-trips for menu → action flow. Same pattern as VS Code, Figma                                             |
| Sandbox            | Enabled (default)                                                          | All Node.js work runs in main process. Preload only bridges IPC. No reason to disable sandbox                             |
| Error handling     | `IpcResult<T>` wrapper on all IPC responses                                | Structured errors propagate cleanly to the renderer without losing information                                            |
| Single instance    | `app.requestSingleInstanceLock()`                                          | Prevents config file corruption from concurrent app instances                                                             |

---

## 12. Error Handling Strategy

### Main process errors

| Scenario                                    | Handling                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| Config file doesn't exist                   | Return defaults `{ workspaces: [], lastActiveWorkspace: null }`                 |
| Config file is corrupt JSON                 | Log warning, return defaults (don't delete the file — user may want to recover) |
| Config write fails (disk full, permissions) | Return `{ ok: false, error: "..." }` to renderer, log error                     |
| `simple-git` — not a git repo               | `isGitRepo: false`, `branch: null` — workspace still usable                     |
| `simple-git` — git not installed            | Catch `ENOENT`, log warning, all git features degrade gracefully                |
| File dialog cancelled                       | Return `{ ok: true, data: null }` — not an error                                |
| Workspace path doesn't exist                | `exists: false` in `WorkspaceInfo`, workspace stays in config, dimmed in UI     |
| Window state file corrupt                   | Fall back to default window size/position                                       |
| `.git/HEAD` watcher error                   | Close watcher, log warning, branch shows stale value                            |

### Renderer errors

| Scenario                         | Handling                                                           |
| -------------------------------- | ------------------------------------------------------------------ |
| IPC call returns `{ ok: false }` | Set `error` state in Zustand store, show inline error message      |
| Component render throws          | Caught by `ErrorBoundary`, shows recovery UI with "Reload" button  |
| Workspace list empty             | Empty state: "Add a workspace to get started"                      |
| Loading state                    | Show subtle loading indicator while `fetchWorkspaces` is in flight |

---

## 13. Files Created / Modified

### New files (in creation order):

| #   | File                                                          | Purpose                                           |
| --- | ------------------------------------------------------------- | ------------------------------------------------- |
| 1   | `src/shared/types.ts`                                         | Shared type definitions (single source of truth)  |
| 2   | `src/renderer/src/styles/variables.css`                       | CSS custom properties / design tokens             |
| 3   | `src/renderer/src/styles/reset.css`                           | Minimal CSS reset                                 |
| 4   | `src/renderer/src/styles/global.css`                          | Global styles, font imports, scrollbar, selection |
| 5   | `src/main/config.ts`                                          | ConfigManager class                               |
| 6   | `src/main/window-state.ts`                                    | Window state persistence                          |
| 7   | `src/main/ipc/workspace.ts`                                   | Workspace IPC handlers                            |
| 8   | `src/main/ipc/index.ts`                                       | IPC handler registration                          |
| 9   | `src/main/index.ts`                                           | Main process entry (modify scaffolded)            |
| 10  | `src/preload/index.ts`                                        | Context bridge (modify scaffolded)                |
| 11  | `src/preload/index.d.ts`                                      | Window.api type augmentation (modify scaffolded)  |
| 12  | `src/renderer/src/stores/useWorkspaceStore.ts`                | Workspace state management                        |
| 13  | `src/renderer/src/stores/useNavStore.ts`                      | Navigation state                                  |
| 14  | `src/renderer/src/components/ErrorBoundary/ErrorBoundary.tsx` | React error boundary                              |
| 15  | `src/renderer/src/components/TitleBar/TitleBar.tsx`           | Custom title bar with drag region                 |
| 16  | `src/renderer/src/components/TitleBar/TitleBar.module.css`    | TitleBar styles                                   |
| 17  | `src/renderer/src/components/Sidebar/Sidebar.tsx`             | Sidebar shell                                     |
| 18  | `src/renderer/src/components/Sidebar/Sidebar.module.css`      | Sidebar styles                                    |
| 19  | `src/renderer/src/components/Sidebar/AppWordmark.tsx`         | App logo/name                                     |
| 20  | `src/renderer/src/components/Sidebar/WorkspaceItem.tsx`       | Individual workspace row                          |
| 21  | `src/renderer/src/components/Sidebar/WorkspaceList.tsx`       | Workspace list + add button                       |
| 22  | `src/renderer/src/components/Sidebar/BottomNav.tsx`           | Bottom navigation items                           |
| 23  | `src/renderer/src/components/Sidebar/ContextMenu.tsx`         | Custom right-click context menu                   |
| 24  | `src/renderer/src/components/MainArea/MainArea.tsx`           | Main content area with view switching             |
| 25  | `src/renderer/src/components/MainArea/MainArea.module.css`    | MainArea styles                                   |
| 26  | `src/renderer/src/App.tsx`                                    | Root layout (modify scaffolded)                   |
| 27  | `src/renderer/index.html`                                     | Add CSP, font preloads (modify scaffolded)        |

---

## 14. Phase 2 Prep Considerations

Decisions made in Phase 1 that set up Phase 2 (Kanban board) correctly:

- **Main area view switching** is already in place — Phase 2 replaces the "board" placeholder with the real kanban component
- **CSS design system** includes all status colors needed for kanban columns
- **IPC pattern** (`ipcMain.handle` + `IpcResult<T>`) extends naturally to `tasks:list`, `tasks:create`, etc.
- **ConfigManager** pattern can be extended or a separate `TaskManager` can follow the same in-memory + flush architecture
- **`fs.watch` pattern** for `.git/HEAD` can be replicated with `chokidar` for `.tasks/` directory watching in Phase 2
- **`WorkspaceInfo.path`** is available for scoping task file reads to the active workspace
- **Zustand store pattern** extends naturally — add `useTaskStore` alongside `useWorkspaceStore`
