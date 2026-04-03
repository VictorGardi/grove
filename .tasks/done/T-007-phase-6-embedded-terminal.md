---
id: T-007
title: 'Phase 6: Embedded terminal with node-pty and xterm.js'
status: done
priority: critical
agent: opencode
created: '2026-04-03'
tags:
  - terminal
  - phase-6
  - feature
decisions: []
milestone: null
---

## Description

Implement Phase 6 from VISION.md: a real embedded terminal using node-pty and xterm.js.
The terminal is a collapsible bottom panel (not a full view replacement), with one tab
per active worktree plus free terminals at repo root. PTYs persist across workspace
switches and tab changes. The terminal panel coexists with whatever main area view
is currently active (board, files, milestones, etc.).

### Architecture decisions

**Terminal as bottom panel, not a view:** VISION.md specifies the terminal as a 240px
collapsible panel at the bottom of the layout, spanning the main area and detail panel.
The current codebase incorrectly treats `"terminal"` as a `View` type that replaces the
main area content. This must be refactored: clicking "Terminal" in the sidebar should
toggle the bottom panel open/closed, while the main area continues to show its current
view (board, files, etc.).

**PTY lifecycle:** Each PTY is identified by a unique string ID. PTYs are spawned in the
main process and communicate with the renderer via IPC events. PTYs survive workspace
switches — each workspace has its own PTY pool. Switching workspaces hides/shows tabs
but does not kill processes.

**xterm.js package:** Use `@xterm/xterm` (the new scoped package name), `@xterm/addon-fit`,
and `@xterm/addon-web-links`.

**node-pty native addon:** node-pty requires native compilation. The existing
`externalizeDepsPlugin()` in electron.vite.config.ts handles externalization for Vite
bundling. The `postinstall` script (`electron-builder install-app-deps`) handles native
addon compilation for the correct Electron version. `electron-builder.yml` must be
updated: set `npmRebuild: true` and add `node_modules/node-pty/**` to `asarUnpack`
(native `.node` addons cannot be loaded from inside asar archives).

**IPC channel types:** Use `ipcMain.handle` for request/response channels (`pty:create`,
`pty:kill`, `pty:isIdle`). Use `ipcMain.on` for fire-and-forget channels (`pty:write`,
`pty:resize`) since these are high-frequency and don't need a response. Use
`webContents.send` for push events (`pty:data`, `pty:exit`).

**Centralized data routing:** Register a single global `pty:data` IPC listener in the
terminal store/context rather than per-tab listeners. Route data to the correct xterm
instance by PTY ID via a `Map<string, Terminal>`. This avoids N-listener
registration/cleanup issues.

**Shell resolution:** Resolve the user's shell in this order: (1) app config shell
override from `~/.config/grove/config.json`, (2) `$SHELL` env var, (3) `/bin/zsh`
on macOS or `/bin/bash` on Linux, (4) `powershell.exe` on Windows.

## Definition of Done

### Step 1 — Install dependencies and configure build

- [x] Install `node-pty`, `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`
- [x] Update `electron-builder.yml`: set `npmRebuild: true`, add `node_modules/node-pty/**` to `asarUnpack`
- [x] Verify the app builds and starts with the new dependencies (no runtime crashes)

### Step 2 — Main process PTY manager (`src/main/pty.ts`)

- [x] Create `PtyManager` class that manages a pool of PTY instances
- [x] Shell resolution: app config override → `$SHELL` → `/bin/zsh` (macOS) or `/bin/bash` (Linux) → `powershell.exe` (Windows)
- [x] `create(id: string, cwd: string)` — spawns a PTY using resolved shell, stores by ID. Registers `onData` and `onExit` handlers on the PTY instance
- [x] `write(id: string, data: string)` — forwards keystrokes to the PTY
- [x] `resize(id: string, cols: number, rows: number)` — forwards resize events
- [x] `kill(id: string)` — kills the PTY process, removes from pool
- [x] `killAll()` — kills all PTYs (called on app quit)
- [x] Data output callback: PTY data forwarded to a callback set during construction, which the IPC layer uses to push `pty:data` events to the renderer
- [x] Exit callback: PTY exit forwarded to a callback, which the IPC layer uses to push `pty:exit` events (with exitCode + signal)
- [x] Idle detection: track last output timestamp per PTY. `isIdle(id: string)` returns true if no output for 3+ seconds
- [x] `getIds()` — returns list of all active PTY IDs
- [x] `exists(id: string)` — checks if a PTY with the given ID exists

### Step 3 — PTY IPC handlers (`src/main/ipc/pty.ts`)

- [x] `pty:create` — `ipcMain.handle`: calls `ptyManager.create()`, returns `IpcResult<void>`
- [x] `pty:write` — `ipcMain.on` (fire-and-forget): calls `ptyManager.write()`
- [x] `pty:resize` — `ipcMain.on` (fire-and-forget): calls `ptyManager.resize()`
- [x] `pty:kill` — `ipcMain.handle`: calls `ptyManager.kill()`, returns `IpcResult<void>`
- [x] `pty:isIdle` — `ipcMain.handle`: calls `ptyManager.isIdle()`, returns `IpcResult<boolean>`
- [x] Data forwarding: PtyManager's data callback sends `mainWindow.webContents.send('pty:data', id, chunk)`
- [x] Exit forwarding: PtyManager's exit callback sends `mainWindow.webContents.send('pty:exit', id, { exitCode, signal })`
- [x] Register handlers in `src/main/ipc/index.ts` via `registerPtyHandlers(ptyManager, mainWindow)`
- [x] Call `ptyManager.killAll()` on app `before-quit` in `src/main/index.ts`

### Step 4 — Preload bridge (`src/preload/index.ts` + `index.d.ts`)

- [x] Add `pty` namespace to the contextBridge API:
  - `create(id: string, cwd: string): Promise<IpcResult<void>>` (via `ipcRenderer.invoke`)
  - `write(id: string, data: string): void` (fire-and-forget via `ipcRenderer.send`)
  - `resize(id: string, cols: number, rows: number): void` (fire-and-forget via `ipcRenderer.send`)
  - `kill(id: string): Promise<IpcResult<void>>` (via `ipcRenderer.invoke`)
  - `isIdle(id: string): Promise<IpcResult<boolean>>` (via `ipcRenderer.invoke`)
  - `onData(callback: (id: string, data: string) => void): () => void` (event listener returning cleanup)
  - `onExit(callback: (id: string, exitCode: number, signal?: number) => void): () => void` (event listener returning cleanup)
- [x] Add corresponding TypeScript declarations in `index.d.ts`

### Step 5 — Refactor navigation: terminal as bottom panel

- [x] In `useNavStore.ts`: remove `"terminal"` from the `View` type union. Add `terminalPanelOpen: boolean` state and `toggleTerminalPanel()` action. Remove `lastContentView` and `toggleTerminal()` (no longer needed — terminal doesn't replace views)
- [x] In `BottomNav.tsx`: change the Terminal nav item to call `toggleTerminalPanel()` instead of `setActiveView("terminal")`. Highlight the Terminal item based on `terminalPanelOpen` (not `activeView`)
- [x] In `MainArea.tsx`: remove the `activeView === "terminal"` placeholder block entirely
- [x] In `useKeyboardShortcuts.ts`: change `Cmd+J` to call `toggleTerminalPanel()` instead of `toggleTerminal()`
- [x] In `App.tsx`: add `<TerminalPanel />` component below the main flex row, conditionally rendered when `terminalPanelOpen` is true

### Step 6 — Terminal Zustand store (`src/renderer/src/stores/useTerminalStore.ts`)

- [x] Create store with state:
  - `tabs: TerminalTab[]` — array of `{ id: string, label: string, workspacePath: string, worktreePath: string | null, taskId: string | null }`
  - `activeTabId: string | null`
  - `idleMap: Record<string, boolean>` — tracks idle state per PTY (used by Phase 7 diff auto-refresh)
  - `xtermRefs: Map<string, Terminal>` — xterm instance registry for centralized data routing
- [x] Actions:
  - `addTab(tab)` — adds a tab and sets it active
  - `removeTab(id)` — removes tab, kills PTY via `window.api.pty.kill(id)`, removes from xtermRefs, selects next/previous tab
  - `setActiveTab(id)` — switches active tab
  - `getTabsForWorkspace(workspacePath)` — returns tabs for a specific workspace
  - `setIdle(id, idle)` — updates idle state for a PTY
  - `registerXterm(id, terminal)` — registers an xterm instance for data routing
  - `unregisterXterm(id)` — removes an xterm instance
- [x] Centralized `pty:data` listener: register a single global `onData` listener that routes data to the correct xterm instance via `xtermRefs.get(id)?.write(data)`
- [x] Centralized `pty:exit` listener: register a single global `onExit` listener that shows exit message in the correct xterm instance
- [x] Free terminal ID generation: use `free-<timestamp>` pattern for "+" button terminals

### Step 7 — Terminal panel component (`src/renderer/src/components/Terminal/`)

- [x] Create `TerminalPanel.tsx` — the bottom panel container:
  - 240px default height, CSS variable `--terminal-height`
  - Resize handle at the top edge (drag to resize, min 120px, max 600px)
  - Tab bar at top: one tab per terminal (filtered by active workspace), showing label + idle/active dot
  - "+" button to add a free terminal at repo root
  - Terminal content area below the tab bar
  - Persist height preference in localStorage
- [x] Create `TerminalPanel.module.css` with appropriate styling (dark surfaces, borders matching app theme)
- [x] Create `TerminalTab.tsx` — renders a single xterm.js instance:
  - Import `@xterm/xterm/css/xterm.css` for proper xterm styling
  - On mount: call `window.api.pty.create(id, cwd)` to spawn the PTY
  - Create xterm.js `Terminal` instance with `FitAddon` and `WebLinksAddon`
  - Register xterm instance with terminal store's `registerXterm(id, terminal)` for centralized data routing
  - Forward user input from xterm's `onData` event to `window.api.pty.write(id, data)`
  - On container resize: debounce (100ms), call `FitAddon.fit()` + `window.api.pty.resize(id, cols, rows)` to avoid flooding PTY during window resize
  - xterm theme derived from CSS variables (bg: `#0b0b0d`, fg: `#e2e2e6`, cursor: `#7b68ee`, selection: accent-dim, etc.)
  - Set `scrollback: 5000` to limit memory usage
  - On unmount (tab closed): unregister xterm, call `window.api.pty.kill(id)`, dispose xterm instance
- [x] Tab switching: hide/show xterm instances via `display: none`/`display: block` (keep DOM mounted) so switching tabs does not destroy the terminal. Call `FitAddon.fit()` on the newly visible tab to ensure correct sizing

### Step 8 — Worktree integration

- [x] When a worktree is created (in `Board.tsx` after successful `git:setupWorktreeForTask`), automatically add a terminal tab:
  - Tab ID: `wt-<taskId>` (e.g. `wt-T-004`)
  - Label: branch short name (e.g. `feat/T-004-slug`)
  - CWD: the worktree absolute path (resolve from worktree relative path + workspace path)
  - `taskId` and `worktreePath` set on the tab
  - Only create tab AFTER `setupWorktreeForTask` result is confirmed `ok`
- [x] When a worktree is torn down (`git:teardownWorktreeForTask` in `Board.tsx`), remove the terminal tab and kill its PTY
- [x] Auto-open the terminal panel when a worktree tab is created (if it's collapsed)
- [x] Pre-fill agent command: after PTY is created and shell prompt appears (wait ~500ms), write the agent command text (without carriage return) based on the task's `agent` field:
  - `claude-code` → `claude`
  - `copilot` → `gh copilot suggest`
  - `codex` → `codex`
  - `aider` → `aider`
  - `opencode` → `opencode`
  - `null` → no pre-fill

### Step 9 — Sidebar worktree indicators

- [x] In `WorktreeList.tsx`: read idle state from terminal store. Show green dot + "running" when the worktree has an active terminal with recent output, grey dot + "idle" when idle or no terminal
- [x] Clicking a worktree item in the sidebar: navigate to the task AND activate its terminal tab (if one exists), open terminal panel if collapsed

### Step 10 — Multi-workspace terminal isolation

- [x] Each workspace's terminal tabs are tracked by `workspacePath` in the tab data
- [x] Tab bar filters to only show tabs for the active workspace
- [x] PTYs from other workspaces stay alive in the main process — switching back resumes them
- [x] The "+" button spawns a free terminal at the active workspace root

### Step 11 — Session restoration on app restart

- [x] On app startup, after workspace loads, scan for tasks in `doing` status with `worktree` fields
- [x] For each active worktree, auto-create a terminal tab and spawn a fresh PTY in that worktree directory
- [x] Auto-open terminal panel if any worktree tabs were restored

### Step 12 — Polish and edge cases

- [x] Backtick shortcut: only toggle terminal when xterm is NOT focused (check `document.activeElement` is not inside xterm container). Use Ctrl+`` ` `` as an alternative that works everywhere
- [x] Cmd+J toggles terminal panel (already wired in Step 5)
- [x] Terminal panel remembers height across restarts (localStorage)
- [x] App quit: all PTYs are killed gracefully via `ptyManager.killAll()`
- [x] Handle PTY process exit (child process dies): show `\r\nProcess exited (code N)\r\n` in xterm via the centralized `pty:exit` listener, disable input. Show a "Restart" indicator
- [x] Terminal inherits the user's shell config (`$SHELL`, env vars from parent Electron process)
- [x] ResizeObserver on the terminal container to handle layout changes (sidebar toggle, detail panel open/close). Debounce resize by 100ms

## Context for agent

Key files to modify:

- `package.json` — add dependencies
- `electron-builder.yml` — npmRebuild + asarUnpack for node-pty
- `src/main/index.ts` — integrate PtyManager lifecycle
- `src/main/ipc/index.ts` — register PTY handlers
- `src/preload/index.ts` + `index.d.ts` — add pty bridge
- `src/renderer/src/stores/useNavStore.ts` — refactor terminal from view to panel
- `src/renderer/src/components/Sidebar/BottomNav.tsx` — terminal toggle behavior
- `src/renderer/src/components/MainArea/MainArea.tsx` — remove terminal placeholder
- `src/renderer/src/App.tsx` — add TerminalPanel to layout
- `src/renderer/src/hooks/useKeyboardShortcuts.ts` — update shortcuts
- `src/renderer/src/components/Sidebar/WorktreeList.tsx` — wire terminal indicators
- `src/renderer/src/components/Board/Board.tsx` — add terminal tab on worktree create/teardown

New files to create:

- `src/main/pty.ts` — PtyManager class
- `src/main/ipc/pty.ts` — PTY IPC handlers
- `src/renderer/src/stores/useTerminalStore.ts` — terminal state + centralized data routing
- `src/renderer/src/components/Terminal/TerminalPanel.tsx` + `.module.css`
- `src/renderer/src/components/Terminal/TerminalTab.tsx`

Existing patterns to follow:

- IPC: `ipcMain.handle` for request/response (returns `IpcResult<T>`), `ipcMain.on` for fire-and-forget, `webContents.send` for push events
- Preload: expose typed API via `contextBridge.exposeInMainWorld`
- Stores: Zustand v5 with `create<State>()(...)` pattern
- Components: CSS modules with `.module.css` files
- Styling: use CSS variables from `variables.css`, dark theme, JetBrains Mono for terminal
