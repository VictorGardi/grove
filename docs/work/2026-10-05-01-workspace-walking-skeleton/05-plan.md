---
feature: 2026-10-05-01-workspace-walking-skeleton
phase: plan
status: approved
version: 1
created: 2026-10-05
updated: 2026-10-05
approved_at: 2026-10-05
based_on:
  - 03-design.md@1
  - 04-structure.md@1
forced: []
---

# Plan: workspace walking skeleton

Agent-facing. Read this file and `03-design.md` (the IPC contract, tmux contract,
file shapes and `SessionBackend`/`Core` interfaces there are binding). Work one
slice at a time; each slice ends with its **Verify** block passing and a stop for
human review.

**Approval:** this plan was approved automatically by `grove-plan` after its
content self-checks passed (no open questions, no placeholder markers, every
slice has verification). A human did not review it.

## Ground rules

- **Repo state at start:** HEAD (`15ec3b4`) has no app code: no `package.json`,
  no `src/`. Everything below is new. `spikes/` holds throwaway Phase 0 scripts.
  Leave them alone.
- **Old build config** is taken from commit `f5a1c17`, `git show
  f5a1c17:<file>`. Do not take any of its `src/`.
- **Sandbox.** In Claude Code, run every command that touches tmux (`npm test`,
  `npm run dev`, any `tmux -L …`) with the sandbox disabled. tmux sockets live in
  `/private/tmp/tmux-501`, which the sandbox blocks. `npm install` needs network
  (`registry.npmjs.org`, `github.com`, `objects.githubusercontent.com`). If npm
  fails with `EPERM … _cacache` (the user's `~/.npm` has root-owned files), run
  it with `npm_config_cache=$TMPDIR/npmcache`.
- **Manual steps** (anything marked *Manual*) need the human at the keyboard. Run
  the automated checks yourself, then list the manual ones for the human with
  exact commands. Record their results in `06-implementation.md`.
- **Commands** (written to `grove.config.json` in slice 1):
  `test` = `npm test`, `typecheck` = `npm run typecheck`, `build` = `npm run
  build`, `dev` = `npm run dev`. There is no lint command in this child.
- **Imports:** core (`src/core/**`) must never import `electron`. Check this
  with `grep -rn "from 'electron'" src/core` (expect no output) in every slice.
- **Style:** TypeScript strict, 2-space indent, single quotes, no semicolons.
  Comments only where the why isn't obvious.

### Corrections applied while planning

These are factual fixes to the structure's wording, agreed with the human or
taken from research. None changes a design decision.

1. OpenCode ids are **descending** by time: newer ids sort first. The spike
   computes `~(ms * 0x1000 + 1)`. Checked against this machine's
   `opencode.db`: `ses_244fb7288ffe…` was created at 1776959130999 ms, and the
   port must give the prefix `244fb7288ffe` for that time. The design and
   structure now say "descending" (typo fix, the human chose not to reopen
   approval).
2. `spikes/tmux-opencode/q1-truecolor.sh` runs OpenCode on a spike socket. It
   doesn't draw a gradient. Slice 5 uses an inline gradient one-liner instead.
3. `spikes/electron/keylog.py` needs an output file argument.
4. A Finder-equivalent launch from a shell is `env -i /usr/bin/open -n …`.
   Plain `open` forwards the shell's env (research Q7).

### Implementation choices made here (two-way, easy to change)

- `readVersioned` takes an optional 4th argument `onBad(message)`, so the
  caller can raise the error banner.
- Startup errors reach the renderer through one extra invoke, `app:errors` →
  `string[]`, read once on renderer start. The design's IPC table has no channel
  for the banner, and `Slices` stays `{projects, sessions, ui}`.
- `Core` gets one method beyond the design's interface, `checkLiveness():
  Promise<void>`, so main can trigger the check on window focus.
- Times are ISO strings (`startedAt`, `endedAt`). Ids are `crypto.randomUUID()`.
- `atomicWrite` is synchronous (`writeFileSync` of `<path>.<pid>.tmp`, then
  `renameSync`). Main is the only writer, and the files are tiny.
- Terminal theme: foreground `#d4d4d4`, background `#1e1e1e` (the colours the
  Phase 0 spikes used).
- The single-attach rule is enforced in main: a new `pty:attach` kills every
  other live attach first.

## Shared reference

### `package.json` (slice 1, exact)

```json
{
  "name": "grove",
  "productName": "grove",
  "version": "0.1.0",
  "private": true,
  "description": "Feature workspace for OpenCode sessions",
  "main": "./out/main/index.js",
  "scripts": {
    "typecheck:node": "tsc --noEmit -p tsconfig.node.json --composite false",
    "typecheck:web": "tsc --noEmit -p tsconfig.web.json --composite false",
    "typecheck": "npm run typecheck:node && npm run typecheck:web",
    "test": "vitest run",
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "postinstall": "node scripts/fix-spawn-helper.mjs"
  },
  "build": { "asarUnpack": ["node_modules/node-pty/**", "resources/**"] },
  "dependencies": {
    "@xterm/addon-fit": "0.11.0",
    "@xterm/addon-webgl": "0.19.0",
    "@xterm/xterm": "6.0.0",
    "node-pty": "1.1.0",
    "zustand": "5.0.15"
  },
  "devDependencies": {
    "@electron-toolkit/tsconfig": "2.0.0",
    "@types/node": "24.19.1",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "5.2.0",
    "electron": "44.5.1",
    "electron-vite": "5.0.0",
    "react": "19.3.0",
    "react-dom": "19.3.0",
    "typescript": "5.9.3",
    "vite": "7.3.6",
    "vitest": "4.1.11"
  }
}
```

Do not add `electron-builder` or `"type": "module"`. Packaging is child 8, and
vitest's warning about loading an ESM config as CJS is expected and harmless.

### `resources/tmux.conf` (slice 1, exact)

```
# grove's tmux server config (-L grove). Changing an option later may need
# `tmux -L grove kill-server`, since source-file never unsets old options.
set -g status off
set -g mouse on
set -g history-limit 50000
set -g allow-passthrough on
set -g remain-on-exit failed
set -s escape-time 10
set -s focus-events on
```

### Types (`src/shared/types.ts`)

```ts
export interface Project { id: string; name: string; path: string }
export type SessionKind = 'opencode' | 'terminal'
export interface Session {
  id: string
  projectId: string
  kind: SessionKind
  label: string
  labelPinned: boolean
  tmuxName: string                 // `grove-${id}`
  opencodeSessionId: string | null // set for kind 'opencode' (slice 3)
  feature: string | null           // always null in this child
  linkPinned: boolean              // always false in this child
  action: { stage: string; actionId: string } | null // always null
  startedAt: string                // ISO
  endedAt: string | null           // ISO, set when first seen gone
  lastStatus: 'running' | 'gone'
}
export interface UiState { sidebarWidth: number; focusedSessionId: string | null }
export type Slices = { projects: Project[]; sessions: Session[]; ui: UiState }
export interface ConfigFile { schemaVersion: 1; projects: Project[] }
export interface StateFile { schemaVersion: 1; sessions: Session[]; ui: UiState }
export const DEFAULT_UI: UiState = { sidebarWidth: 260, focusedSessionId: null }
```

### IPC (`src/shared/ipc.ts`)

```ts
export type Result<T> = { ok: true; data: T } | { ok: false; error: string }
export type MenuAction =
  | { type: 'newSession' } | { type: 'closeSession' } | { type: 'focusIndex'; n: number }
// invoke channels: name → [args, result data]
export interface InvokeMap {
  'state:get': [void, Slices]
  'app:errors': [void, string[]]
  'project:add': [void, Project | null]
  'project:remove': [{ id: string }, { id: string }]             // slice 4
  'session:create': [{ projectId: string; kind: SessionKind; cols: number; rows: number }, Session]
  'session:kill': [{ id: string }, { id: string }]               // slice 4
  'session:remove': [{ id: string }, { id: string }]             // slice 4
  'session:rename': [{ id: string; label: string }, Session]     // slice 4
  'ui:set': [Partial<UiState>, UiState]                          // slice 2
  'pty:attach': [{ sessionId: string; cols: number; rows: number }, { attachId: string }]
}
// fire-and-forget renderer → main
export interface SendMap {
  'pty:input': { attachId: string; data: string }
  'pty:resize': { attachId: string; cols: number; rows: number }
  'pty:detach': { attachId: string }
}
// pushes main → renderer
export interface PushMap {
  'state:projects': Project[]
  'state:sessions': Session[]
  'state:ui': UiState
  'pty:data': { attachId: string; data: string }
  'pty:exit': { attachId: string }
  'menu:action': MenuAction
}
export interface Api {
  invoke<K extends keyof InvokeMap>(ch: K, ...args: InvokeMap[K][0] extends void ? [] : [InvokeMap[K][0]]): Promise<Result<InvokeMap[K][1]>>
  send<K extends keyof SendMap>(ch: K, payload: SendMap[K]): void
  on<K extends keyof PushMap>(ch: K, cb: (payload: PushMap[K]) => void): () => void
}
```

Add each channel in the slice marked, not before. Main wraps every handler as
`try { return { ok: true, data } } catch (e) { return { ok: false, error: String(e.message ?? e) } }`.
Core commands return `Result<T>` themselves for rule violations (error codes
`has-live-sessions`, `not-gone`, `not-found`).

### Core shape (`src/core/core.ts`)

```ts
export interface CoreOptions {
  configPath: string   // ~/.config/grove/config.json
  statePath: string    // <userData>/state.json (used from slice 2)
  backend: SessionBackend
  now?: () => Date     // tests inject this
}
export function createCore(opts: CoreOptions): Core
```

`Core` is the design's interface plus `checkLiveness()` and `getErrors():
string[]`. `commands` holds one async method per invoke channel except
`state:get`, `app:errors`, `pty:attach` and `project:add`'s picker. Names:
`projectAdd({path})`, `projectRemove({id})`, `sessionCreate(…)`,
`sessionKill({id})`, `sessionRemove({id})`, `sessionRename({id,label})`,
`uiSet(partial)`. Every mutation replaces the slice array or object (never
mutates in place), emits `slice`, and, from slice 2, saves the file that owns
the slice (`projects` → config, `sessions`/`ui` → state).

### Paths in main

- config: `path.join(os.homedir(), '.config', 'grove', 'config.json')`
- state: `path.join(app.getPath('userData'), 'state.json')`
- tmux conf: `path.join(app.getAppPath(), 'resources', 'tmux.conf')`. In dev,
  `getAppPath()` is the repo root.
- preload: `path.join(__dirname, '../preload/index.js')`
- renderer: `process.env.ELECTRON_RENDERER_URL` → `loadURL`, else
  `loadFile(path.join(__dirname, '../renderer/index.html'))`

---

## Slice 1. Tracer: add a project, open a terminal session in tmux

Outcome: `npm run dev` shows an empty sidebar with **Add project**. A picked
folder is saved to `~/.config/grove/config.json` and listed. Cmd+T opens the ＋
modal (project + Terminal). It creates `grove-<uuid>` on `-L grove` in the project
root, listed under the project and attached in xterm.js. Sessions live in memory
only. Cmd+Q quits within 2 s and the tmux session survives.

### Scaffold

- [x] `git show f5a1c17:electron.vite.config.ts > electron.vite.config.ts`. Keep it as is.
- [x] `git show f5a1c17:tsconfig.json > tsconfig.json`. Keep it as is.
- [x] `git show f5a1c17:tsconfig.node.json > tsconfig.node.json`. Change `include`
  to `["electron.vite.config.*", "vitest.config.*", "src/main/**/*", "src/preload/**/*", "src/shared/**/*", "src/core/**/*"]`.
  Add `"types": ["electron-vite/node", "node"]`.
- [x] `git show f5a1c17:tsconfig.web.json > tsconfig.web.json`. Add
  `"src/shared/**/*"` to `include`.
- [x] `git show f5a1c17:vitest.config.ts > vitest.config.ts`. Change `test.include`
  to `["src/**/*.test.ts"]` and add `testTimeout: 15000`.
- [x] Write `package.json` exactly as in **Shared reference**.
- [x] Write `scripts/fix-spawn-helper.mjs`. For each directory in
  `node_modules/node-pty/prebuilds/*/`, if a `spawn-helper` file exists, set it
  to `chmod 0o755` and print the path. Exit 0 when node-pty is absent. Use only
  `node:fs` and `node:path`, resolved from `process.cwd()`.
- [x] Write `resources/tmux.conf` exactly as in **Shared reference**.
- [x] Set `grove.config.json` `"commands"` to
  `{ "test": "npm test", "typecheck": "npm run typecheck", "build": "npm run build", "dev": "npm run dev" }`.
  Leave the other keys unchanged.
- [x] Append `out/` to `.gitignore` if it's missing (`node_modules/` is already there).
- [x] Run `npm install` (network, see Ground rules). If
  `node_modules/electron/dist/Electron.app` is missing afterwards, run `node node_modules/electron/install.js`.
  npm 11's allowScripts can skip Electron's download.
- [x] `src/renderer/index.html`: a `<div id="root">` and
  `<script type="module" src="./src/main.tsx">`. CSP meta:
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`.
  `html, body, #root { margin:0; height:100%; background:#1e1e1e; color:#d4d4d4; font: 13px -apple-system, sans-serif }`.
- [x] `src/renderer/src/main.tsx`: import `@xterm/xterm/css/xterm.css`, then
  `createRoot(document.getElementById('root')!).render(<App />)`.
- [x] `src/renderer/src/env.d.ts`: `/// <reference types="vite/client" />`, plus
  `import type { Api } from '@shared/ipc'` and `declare global { interface Window { api: Api } }` with `export {}`.

### Shared and store

- [x] `src/shared/types.ts` and `src/shared/ipc.ts` as in **Shared reference**,
  with only the slice-1 channels: `state:get`, `app:errors`, `project:add`,
  `session:create`, `pty:attach`, `pty:input|resize|detach`, pushes
  `state:projects|sessions|ui`, `pty:data|exit`, `menu:action`.
- [x] **Test first:** `src/core/store/jsonFile.test.ts` (each test uses a fresh
  `fs.mkdtempSync(path.join(os.tmpdir(), 'grove-'))`):
  - `atomicWrite` creates parent directories, writes the content, and leaves no `*.tmp` file in the directory.
  - `readVersioned` on a missing file returns `empty` and doesn't call `onBad`.
  - `readVersioned` on `{"schemaVersion":1,"x":2}` returns the parsed object.
  - A bad JSON file is renamed to `<name>.bad-<digits>`, returns `empty` and calls `onBad` once.
  - `{"schemaVersion":2}` with expected 1 does the same as bad JSON.
- [x] `src/core/store/jsonFile.ts`: `atomicWrite(path, data: string): void` and
  `readVersioned<T extends { schemaVersion: number }>(path, schemaVersion, empty: T, onBad?: (msg: string) => void): T`.
  Bad files are renamed with `renameSync(path, `${path}.bad-${Date.now()}`)`.
- [x] `src/core/store/configStore.ts`: `loadConfig(path, onBad)`, which returns
  `ConfigFile` with empty `{schemaVersion:1, projects:[]}`, and `saveConfig(path, cfg)`,
  which writes `JSON.stringify(cfg, null, 2) + '\n'` atomically.

### Env and backend

- [x] `src/core/env.ts`:
  - `minimalEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv` returns a copy
    without `TMUX` and `TMUX_PANE`. Slice 6 adds the PATH and LANG defaults.
  - `findTmux(env): string | null` returns the first `<dir>/tmux` in
    `env.PATH.split(':')` that passes `fs.accessSync(p, fs.constants.X_OK)`.
- [x] `src/core/backend/types.ts`: `SessionBackend` and `AttachHandle`, exactly
  as in the design.
- [x] `src/core/backend/herdr.ts`: `class HerdrBackend implements SessionBackend`.
  Every method throws `new Error('herdr backend: not implemented')`.
- [x] **Test first:** `src/core/backend/tmux.test.ts`. Use
  `describe.skipIf(!findTmux(process.env))`, socket `gt${process.pid}`, and
  conf `path.resolve('resources/tmux.conf')`, and `env: minimalEnv(process.env)`, so tests run from inside tmux don't inherit `TMUX`. `afterAll` runs
  `tmux -L gt<pid> kill-server`, ignoring errors. Cases:
  - `list()` with no server returns an empty `Set`.
  - `create({name:'grove-a', cwd: os.tmpdir(), cols:100, rows:30})`, then `list()` has `grove-a`.
    `tmux -L gt<pid> show-options -g history-limit` contains `50000`, which proves `-f` was used.
  - `ensureConfig()` with the server up resolves (it runs `source-file`).
  - `kill('grove-a')` → `list()` lacks it. `kill('grove-missing')` resolves.
  - `attach('grove-b', 80, 24)` after `create` of `grove-b` gets `onData` within 3 s. `kill()` on the
    handle leaves `grove-b` in `list()`.
  - Exact match: with only `grove-abc` present, `kill('grove-ab')` must not remove `grove-abc`.
- [x] `src/core/backend/tmux.ts`: `class TmuxBackend implements SessionBackend`,
  with constructor `{ tmuxPath, socket, confPath, env }`.
  - Run tmux with `execFile(tmuxPath, ['-L', socket, ...args], { env })`, promisified,
    and keep stdout/stderr. Never use a shell.
  - `ensureConfig`: if `list-sessions` exits 0, run `source-file <confPath>`. Otherwise do nothing.
  - `create`: `['-f', confPath, 'new-session', '-d', '-s', name, '-c', cwd, '-x', String(cols), '-y', String(rows), ...(argv ? ['--', ...argv] : [])]`.
  - `list`: `list-sessions -F '#{session_name}'`. On a non-zero exit whose stderr
    contains `no server running` or `error connecting`, return an empty set.
    Rethrow other errors.
  - `kill`: `kill-session -t =<name>`. Swallow an error whose stderr has
    `can't find session`, `no server running` or `error connecting`.
  - `setColors`: `select-pane -t =<name> -P fg=<fg>,bg=<bg>` (used from slice 5).
  - `attach`: `pty.spawn(tmuxPath, ['-L', socket, 'attach-session', '-t', `=${name}`], { name: 'xterm-256color', cols, rows, cwd: os.homedir(), env })`.
    Wrap it as an `AttachHandle`. `kill()` calls `p.kill()` and is idempotent.

### Core

- [x] `src/core/projects.ts`: `newProject(path, id): Project`, where `name` is
  `path.basename(path)`.
- [x] `src/core/sessions.ts`:
  - `makeLabel(kind, date)` gives `OpenCode · HH:MM` or `Terminal · HH:MM`. Use
    local time with two-digit hours and minutes, and the `·` U+00B7 separator.
  - `newSession({ projectId, kind, now, id })` gives a `Session` with
    `tmuxName: 'grove-' + id`, `lastStatus: 'running'`, `labelPinned: false`,
    the null/false fields from the types, and `startedAt: now.toISOString()`.
- [x] `src/core/core.ts`: `createCore`.
  - `start()`: load the config (`onBad` pushes the message to `errors`), then
    `backend.ensureConfig()`. Catch backend errors and push `tmux: <message>` to `errors`.
  - `sessionCreate`: for `kind !== 'terminal'`, return `{ok:false, error:'unsupported-kind'}` until slice 3.
    Otherwise look up the project (`not-found`), then call
    `backend.create({ name, cwd: project.path, cols, rows })`, then add the session and emit.
  - `projectAdd({path})` appends the project, calls `saveConfig` and emits.
  - `attach(sessionId, …)` finds the session and returns `backend.attach(tmuxName, …)`.
    It tracks the handle in a `Set` and removes it on exit or kill.
  - `dispose()` kills every tracked handle.
  - Sessions and `ui` (`DEFAULT_UI`) live in memory in this slice.

### Main and preload

- [x] `src/preload/index.ts`: use `contextBridge.exposeInMainWorld('api', api)`
  with `invoke: (ch, arg) => ipcRenderer.invoke(ch, arg)`,
  `send: (ch, p) => ipcRenderer.send(ch, p)`, and `on` that adds a listener and
  returns a function that removes it. Type the object as `Api`.
- [x] `src/main/ipc.ts`: `registerIpc(core, getWindow)`.
  - `ipcMain.handle` for each invoke channel, wrapped as described in **IPC**.
  - `project:add` shows `dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })`.
    If cancelled it returns `null`; otherwise it calls `core.commands.projectAdd({ path })`.
  - `pty:attach` kills and removes every attach in `Map<attachId, AttachHandle>`
    (single live attach), then calls `core.attach`, which wires `onData` to
    `pty:data` and `onExit` to `pty:exit`. It returns the attach id from `randomUUID()`.
  - `pty:input|resize|detach` look up the handle and call `write`/`resize`/`kill`.
    Unknown ids are ignored.
  - Slice pushes are coalesced: `core.on('slice', (k, v) => { pending.set(k, v); schedule() })`.
    `schedule` uses one `setImmediate` per tick, which sends `state:<k>` for each pending entry.
  - Every `webContents.send` is guarded with `if (win && !win.isDestroyed())`.
- [x] `src/main/menu.ts`: `buildMenu(send: (a: MenuAction) => void)`.
  - App menu: `about`, `separator`, `hide`, `hideOthers`, `separator`, `quit` (Cmd+Q).
  - File: **New Session** `CmdOrCtrl+T` sends `{type:'newSession'}`.
  - View: when `!app.isPackaged`, `toggleDevTools` and `reload`.
  - Set it with `Menu.setApplicationMenu`.
- [x] `src/main/index.ts`:
  - `app.whenReady()`: build the core with
    `new TmuxBackend({ tmuxPath: findTmux(process.env) ?? 'tmux', socket: 'grove', confPath, env: minimalEnv(process.env) })`,
    then `await core.start()`, `registerIpc`, the menu, and one
    `BrowserWindow({ width: 1200, height: 800, backgroundColor: '#1e1e1e', webPreferences: { preload, contextIsolation: true } })`.
  - `win.on('closed')` → `app.quit()`, and `window-all-closed` → `app.quit()`
    (closing the window quits, on macOS too).
  - `app.on('before-quit', () => core.dispose())`, then
    `app.on('will-quit', () => app.exit(0))`.

### Renderer

- [x] `src/renderer/src/stores/slices.ts`: a zustand store `useSlices` with
  `{ projects, sessions, ui, errors: string[], focusedId: string | null }`.
  - `hydrate()` invokes `state:get` and `app:errors`, then subscribes to the
    three `state:*` pushes, each replacing its key.
  - `setFocused(id)` sets the focused id. In slice 1, `focusedId` is renderer-local.
- [x] `src/renderer/src/components/Sidebar.tsx`: width `ui.sidebarWidth`.
  - Each project shows its name and, under it, its sessions (label plus a
    `running`/`gone` badge). Clicking a session calls `setFocused`.
  - **Add project** button at the bottom invokes `project:add`.
- [x] `src/renderer/src/components/NewSessionModal.tsx`: a project `<select>`
  (default: the first project) and a kind radio, **Terminal** only for now.
  - **Create** invokes `session:create` with `cols: 120, rows: 40`, then focuses
    the new session and closes. Esc closes. With no projects it shows "Add a project first".
- [x] `src/renderer/src/components/TerminalView.tsx`: props `{ sessionId }`.
  The parent renders it with `key={sessionId}`, so a change remounts it.
  - On mount: `new Terminal({ allowProposedApi: true })`, load `FitAddon`,
    `open(div)`, `fit()`, `focus()`.
  - Subscribe to `pty:data` and `pty:exit` before invoking `pty:attach`. Buffer
    `pty:data` payloads until the attach id resolves, then write only those for that id.
  - `term.onData(d => send('pty:input', {attachId, data:d}))`.
  - A `ResizeObserver` calls `fit()`, debounced 100 ms, then sends `pty:resize`.
  - On unmount: send `pty:detach`, unsubscribe, `term.dispose()`.
- [x] `src/renderer/src/App.tsx`: calls `hydrate()` once. It renders a red error
  banner (one line per entry in `errors`), then a flex row with `Sidebar` and
  either `TerminalView key={focusedId}` for a running focused session or an
  empty pane. Subscribe to `menu:action`: `newSession` opens `NewSessionModal`.

### Verify (slice 1)

- [x] `stat -f %Lp node_modules/node-pty/prebuilds/darwin-*/spawn-helper` prints `755`.
- [x] `grep -rn "from 'electron'" src/core` prints nothing.
- [x] `npm run typecheck` passes.
- [x] `npm test` passes (sandbox off). `tmux.test.ts` runs and doesn't skip.
- [x] *Manual:* `npm run dev` → **Add project** → pick this repo →
  `cat ~/.config/grove/config.json` shows `schemaVersion: 1` and one project
  `{ id, name: "grove", path }`. Cmd+T → Terminal → Create → `pwd` in the xterm
  prints the repo path. `tmux -L grove ls` lists `grove-<uuid>`.
- [x] *Manual:* Cmd+Q → within 2 s `pgrep -f electron-vite` prints nothing, and
  `tmux -L grove ls` still lists the session.
  - **If it hangs:** in `before-quit`, after `core.dispose()`, add
    `setTimeout(() => process.kill(process.pid, 'SIGKILL'), 1000).unref()` and
    re-run this check (design Risks: node-pty exit hang).
- [x] Stop for review.

---

## Slice 2. Sessions persist, reconcile on start, and go `gone`

Outcome: sessions and `ui` are saved to `state.json`. After a relaunch they are
listed, and the focused one re-attaches. A session killed outside the app shows
`gone` within 5 s while the app runs, or on the next start. A corrupt state file
is moved aside and an error banner shows.

- [x] Add the `ui:set` channel to `src/shared/ipc.ts`.
- [x] **Test first:** `src/core/store/stateStore.test.ts`.
  - A missing file gives `{schemaVersion:1, sessions:[], ui: DEFAULT_UI}`.
  - Bad JSON or `schemaVersion: 9` gives `state.json.bad-<ts>`, `onBad` called and an empty state.
  - Save then load round-trips.
- [x] `src/core/store/stateStore.ts`: `loadState(path, onBad): StateFile` and
  `saveState(path, s: StateFile)`, both through `jsonFile.ts`. The loader fills
  in a missing `ui` field with `DEFAULT_UI`.
- [x] `src/core/testing/fakeBackend.ts`: an in-memory `SessionBackend`.
  - It keeps `live: Set<string>`. `create` adds, `kill` deletes, `list` returns a copy.
  - `attach` returns a handle whose `emitExit()` fires `onExit`.
  - `calls: {method, args}[]` records every call.
- [x] **Test first:** `src/core/sessions.test.ts`. Use the fake backend, a temp
  dir for config and state, and a fixed `now`.
  - `reconcile`: a session missing from `live` becomes `gone` with
    `endedAt = now`. A present one stays `running`. An already `gone` one keeps
    its original `endedAt`. Names in `live` without a session add nothing (orphans).
  - Through `createCore`: create two terminal sessions. A second core on the same
    paths lists both after `start()`. Remove one name from `fake.live`, then
    `checkLiveness()` marks it `gone`, emits `sessions` and saves (re-read the file).
  - `start()` with a session missing from tmux saves it as `gone` with `endedAt` set.
  - `uiSet({focusedSessionId})` persists.
  - `makeLabel('terminal', new Date(2026, 9, 5, 9, 7))` returns `Terminal · 09:07`.
- [x] `src/core/sessions.ts`: add
  `reconcile(sessions: Session[], live: Set<string>, now: string): Session[]`.
  It returns the same array reference when nothing changed.
- [x] `src/core/core.ts`:
  - `start()` now: load config and state (both `onBad` → `errors`), then
    `ensureConfig`, then `list()`, then `reconcile`. Save state if it changed.
    Start `setInterval(() => void checkLiveness(), 5000)`.
  - `checkLiveness()` calls `list()`, reconciles, and emits and saves on change.
    Backend errors are swallowed in the poll.
  - Each tracked attach's `onExit` triggers `checkLiveness()`.
  - `uiSet` merges and saves. Every sessions change saves the state.
  - `dispose()` also clears the interval.
- [x] `src/main/index.ts`: `win.on('focus', () => void core.checkLiveness())`.
  Register `ui:set` in `ipc.ts`.
- [x] Renderer: drop the local `focusedId`. `setFocused(id)` invokes
  `ui:set({ focusedSessionId: id })`, and focus is read from `ui.focusedSessionId`.
  After hydrate, App attaches it when that session is `running`.

### Verify (slice 2)

- [x] `npm run typecheck` and `npm test` pass (sandbox off).
- [x] `grep -rn "from 'electron'" src/core` prints nothing.
- [x] *Manual:* create two sessions, type `echo hello` in the focused one, Cmd+Q,
  `npm run dev` → both listed, the focused one attached and showing `hello`.
- [x] *Manual:* with the app running, `tmux -L grove kill-session -t =grove-<id>`
  (id from the sidebar or `tmux -L grove ls`) → the row shows `gone` within 5 s.
  Quit, kill another with the same command, relaunch → it shows `gone`, and
  `jq '.sessions[].endedAt' ~/Library/Application\ Support/grove/state.json`
  prints a timestamp for both.
- [x] *Manual:* quit, `echo '{' > ~/Library/Application\ Support/grove/state.json`,
  relaunch → red banner, and `ls ~/Library/Application\ Support/grove/state.json.bad-*` lists one file.
- [x] Stop for review.

---

## Slice 3. OpenCode sessions with a minted id and the user's shell env

Outcome: the ＋ modal offers OpenCode. It runs
`$SHELL -l -i -c 'exec opencode -s <ses_…>'` in the project root, labelled
`OpenCode · HH:MM`. The TUI has the user's PATH, and a first prompt gets a reply.

- [x] **Test first:** `src/core/opencodeId.test.ts`.
  - `mintSessionId(1776959130999).slice(0, 16) === 'ses_244fb7288ffe'`. The
    real id `ses_244fb7288ffe7YEch15CUa2BbN` was created at that ms on this
    machine (`session_v2.time_created`).
  - Ids match `/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/`, length 30.
  - Descending order: `mintSessionId(t + 1000) < mintSessionId(t)` as strings.
  - Two calls at the same `t` differ in the random part.
- [x] `src/core/opencodeId.ts`: port `spikes/opencode/gen-session-id.js` exactly.
  - `value = ~(BigInt(now) * 0x1000n + 1n)`. The time part is six bytes,
    `(value >> BigInt(40 - 8*i)) & 0xffn` for `i = 0..5`, as two-digit hex.
  - Then 14 chars `chars[b % 62]` from `randomBytes(14)`, where `chars` is
    `0-9A-Za-z` in that order.
  - Signature `mintSessionId(now = Date.now()): string`.
- [x] **Test first:** `src/core/env.test.ts`.
  - `loginShellArgv(['opencode', '-s', 'ses_abc'], '/bin/zsh')` deep-equals
    `['/bin/zsh', '-l', '-i', '-c', 'exec opencode -s ses_abc']`.
  - An argument with a space or `'` is single-quoted with `'\''` escaping:
    `['echo', "a b'c"]` → `exec echo 'a b'\''c'`.
  - `minimalEnv({ TMUX: 'x', TMUX_PANE: '%1', HOME: '/h', PATH: '/usr/bin' })`
    has no `TMUX`/`TMUX_PANE` and keeps `HOME`.
- [x] `src/core/env.ts`: `loginShellArgv(argv, shell = process.env.SHELL ?? '/bin/zsh')`.
  Each arg is quoted only when it has a char outside `[A-Za-z0-9_\-./=:@%+,]`.
- [x] `src/core/sessions.ts` and `core.ts`: for `kind: 'opencode'`, set
  `opencodeSessionId = mintSessionId(now.getTime())` and pass
  `argv: loginShellArgv(['opencode', '-s', opencodeSessionId])` to `backend.create`.
  Remove the `unsupported-kind` guard. Terminal sessions still pass no `argv`.
- [x] Add a `sessions.test.ts` case: an opencode create records a `create` call
  whose `argv[4]` is `exec opencode -s <session.opencodeSessionId>`.
- [x] `NewSessionModal.tsx`: kind radio **OpenCode** (default) / **Terminal**.

### Verify (slice 3)

- [x] `npm run typecheck` and `npm test` pass (sandbox off).
- [x] *Manual:* Cmd+T → OpenCode → the TUI opens in the repo. Type `say hi`, press
  Enter → a model reply arrives, with no `provider.auth` / 403 error.
- [x] *Manual:* `tmux -L grove list-panes -t =grove-<id> -F '#{pane_start_command}'`
  contains the `opencodeSessionId` from
  `jq '.sessions[] | {tmuxName, opencodeSessionId}' ~/Library/Application\ Support/grove/state.json`.
- [x] Stop for review.

---

## Slice 4. Session and project lifecycle in the sidebar

Outcome: Cmd+W confirms, then kills the focused session. `gone` rows have
**Remove**. Sessions can be renamed. Clicking or Cmd+1..9 switches the single
live attach. **Remove project** is refused while it has `running` sessions;
otherwise it removes the project and its `gone` sessions.

- [x] Add `session:kill|remove|rename` and `project:remove` to `src/shared/ipc.ts`.
- [x] **Test first** (`sessions.test.ts` and new `src/core/projects.test.ts`, via
  `createCore` and the fake backend):
  - `sessionKill` calls `backend.kill(tmuxName)`, sets `gone` with `endedAt` and
    saves. Killing a session whose name is already missing from `fake.live` still succeeds.
  - `sessionRemove` on a `running` session returns `{ok:false, error:'not-gone'}`.
    On a `gone` one it removes it.
  - `sessionRename` sets `label` and `labelPinned: true`, and the change survives a new core.
  - `projectRemove` with a `running` session returns `has-live-sessions`. With
    only `gone` sessions it removes the project from the config and its sessions from the state.
  - Unknown ids return `not-found`.
  - When the focused session is removed, `ui.focusedSessionId` becomes `null`.
- [x] Implement the four commands in `core.ts`, with pure helpers in `projects.ts`
  and `sessions.ts`. Register them in `ipc.ts`.
- [x] `src/main/menu.ts`: File menu **Close Session** `CmdOrCtrl+W` sends
  `{type:'closeSession'}`. Add a **Session** menu with items `Session 1`..`Session 9`,
  each `CmdOrCtrl+<n>`, sending `{type:'focusIndex', n}`.
- [x] `src/renderer/src/components/ConfirmDialog.tsx`: modal props
  `{ title, body, confirmLabel, onConfirm, onCancel }`. Enter confirms, Esc cancels.
- [x] `App.tsx` handles `menu:action`.
  - `closeSession` with a running focused session opens ConfirmDialog
    ("Kill session <label>?"). Confirm invokes `session:kill`.
  - `focusIndex(n)` focuses the n-th session in sidebar order: projects in config
    order, then that project's sessions in `startedAt` order. Out of range does nothing.
- [x] `Sidebar.tsx`:
  - `gone` rows get a **Remove** button (`session:remove`).
  - Double-clicking a label shows an inline input: Enter invokes `session:rename`,
    Esc cancels.
  - Each project header gets **Remove project** (`project:remove`). An error
    result shows `Can't remove: project has running sessions` under the header.
  - A focused `gone` session shows "Session ended" with **Remove** in the main
    pane, in place of `TerminalView`.

### Verify (slice 4)

- [x] `npm run typecheck` and `npm test` pass (sandbox off).
- [x] *Manual:* Cmd+W → Cancel → still running. Cmd+W → Confirm → row `gone`, and
  `tmux -L grove ls` no longer lists it. **Remove** → row gone. Rename a session,
  then relaunch → the new name is kept.
- [x] *Manual:* with two running sessions, Cmd+1 / Cmd+2 switch terminals, and
  `tmux -L grove list-clients` shows exactly one client. **Remove project** on a
  project with a running session → the refusal message shows.
- [x] Stop for review.

---

## Slice 5. Terminal fidelity and keys

Outcome: WebGL rendering and truecolor. tmux answers OSC 10/11 with the app's
colours. The menu owns Cmd+T/W/K/1..9/Q, Edit roles work, `macOptionIsMeta` is
off, and every other key reaches the pane unchanged.

- [x] `src/shared/theme.ts`: `export const terminalTheme = { foreground: '#d4d4d4', background: '#1e1e1e', cursor: '#d4d4d4', selectionBackground: '#264f78' }`.
- [x] **Test first:** in `tmux.test.ts`, after `create('grove-c')` and
  `setColors('grove-c', '#d4d4d4', '#1e1e1e')`, the combined output of
  `show-options -p -t =grove-c window-style` and `show-options -w -t =grove-c window-style`
  contains `#d4d4d4` and `#1e1e1e` (compare lowercase).
- [x] `src/core/backend/tmux.ts` `attach`: spawn env is
  `{ ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }`.
- [x] `src/core/core.ts` `sessionCreate`: after `backend.create`, call
  `backend.setColors(tmuxName, terminalTheme.foreground, terminalTheme.background)`.
  Import the theme from `src/shared/theme.ts`, which has no Electron imports.
  Add a `sessions.test.ts` assertion that the fake recorded `setColors`.
- [x] `TerminalView.tsx`:
  - Options `{ allowProposedApi: true, macOptionIsMeta: false, theme: terminalTheme, fontFamily: 'Menlo, monospace', fontSize: 13 }`.
  - After `open()`, `const webgl = new WebglAddon(); webgl.onContextLoss(() => webgl.dispose()); term.loadAddon(webgl)`.
    Wrap it in try/catch: on failure, stay on the DOM renderer.
- [x] `src/main/menu.ts`:
  - Add an **Edit** menu with roles `undo`, `redo`, `separator`, `cut`, `copy`, `paste`, `selectAll`.
  - Add to View **Command Palette** `CmdOrCtrl+K` with an empty `click` (child 7).
  - No `before-input-event` handler anywhere.

### Verify (slice 5)

- [x] `npm run typecheck` and `npm test` pass (sandbox off).
- [x] *Manual (truecolor):* in a Terminal session run
  `awk 'BEGIN{for(i=0;i<80;i++){r=255-i*3;g=i*3;printf "\033[48;2;%d;%d;100m ",r,g}; printf "\033[0m\n"}'`
  → a smooth red-to-green band, not 256-colour steps.
- [x] *Manual (OSC 11):* in a Terminal session run
  `printf '\e]11;?\a'; sleep 0.2` → the reply echoes `rgb:1e1e/1e1e/1e1e`.
- [x] *Manual (keys):* in a Terminal session run
  `python3 spikes/electron/keylog.py "$TMPDIR/keylog.txt"`, then press each key
  below. The hex line shown must match. Exit with Ctrl+C three times, or close
  the session.

  | Key | Expected hex |
  |---|---|
  | Enter / Shift+Enter | `0d` / `0d` |
  | Option+Enter | `1b0d` |
  | Tab / Shift+Tab | `09` / `1b5b5a` |
  | Option+Backspace | `1b7f` |
  | Option+Left / Ctrl+Left | `1b5b313b3344` / `1b5b313b3544` |
  | Ctrl+A / C / P / X / J | `01` / `03` / `10` / `18` / `0a` |
  | Up | `1b5b41` |
  | Option+B / Option+F | a composed character's UTF-8 bytes with no `1b` prefix (e.g. `e280ba` / `c692` on a Swedish layout) |
  | Esc | `1b` |
  | Cmd+K | nothing printed |
  | Paste (Cmd+V of `hi`) | `6869` (keylog doesn't enable bracketed paste) |

- [x] Stop for review.

---

## Slice 6. Finder and Dock launch work like `npm run dev`

Outcome: the built app, launched outside a shell, finds tmux, starts OpenCode
with the login-shell env, and has a UTF-8 locale.

- [x] **Test first** in `env.test.ts`:
  - `findTmux({ PATH: '/usr/bin:/bin' })` returns `/opt/homebrew/bin/tmux`. Use
    `it.skipIf(!fs.existsSync('/opt/homebrew/bin/tmux'))`.
  - `findTmux({ PATH: '' })` with a fake `dirs` argument pointing at an empty
    temp dir returns `null`.
  - `minimalEnv({ PATH: '/usr/bin:/bin' })`: `PATH` ends with
    `:/opt/homebrew/bin:/usr/local/bin` and `LANG === 'en_US.UTF-8'`.
  - `minimalEnv({ PATH: '/opt/homebrew/bin:/usr/bin', LANG: 'sv_SE.UTF-8' })`
    keeps `LANG` and doesn't duplicate `/opt/homebrew/bin`.
- [x] `src/core/env.ts`:
  - `export const FIXED_DIRS = ['/opt/homebrew/bin', '/usr/local/bin']`.
  - `findTmux(env, dirs = FIXED_DIRS)` searches `env.PATH` entries, then `dirs`.
  - `minimalEnv(base)` appends each missing `FIXED_DIRS` entry to `PATH` and sets
    `LANG = 'en_US.UTF-8'` when `LANG` is unset or empty. It still strips `TMUX`/`TMUX_PANE`.
- [x] `src/main/index.ts`: if `findTmux(process.env)` returns `null`, push
  `tmux not found (looked in PATH, /opt/homebrew/bin, /usr/local/bin)` to the
  startup errors, which `app:errors` returns. Still open the window.
  - `core.getErrors()` and main's own errors are concatenated for `app:errors`.

### Verify (slice 6)

- [x] `npm run typecheck`, `npm test` (sandbox off) and `npm run build` pass.
- [ ] *Manual (Launch Services env):* quit grove. Then run
  `tmux -L grove kill-server`, so the next server starts with the app's env,
  not a shell's. This ends existing sessions: create one Terminal session
  first, and expect it to show `gone`.
  - Run `env -i /usr/bin/open -n -a "$PWD/node_modules/electron/dist/Electron.app" --args "$PWD"`.
    Claude's sandbox blocks `open`, so the human runs it.
  - Then: a new OpenCode session opens and replies to `say hi`. In a new
    Terminal session, `locale` shows `LANG="en_US.UTF-8"`, and `echo $PATH`
    contains `/opt/homebrew/bin`.
  - Quit, relaunch the same way → the sessions re-attach.
- [ ] *Manual (Dock):* `ln -s "$PWD" node_modules/electron/dist/Electron.app/Contents/Resources/app`
  so Electron loads grove with no arguments. Drag that `Electron.app` into the
  Dock, quit grove, then click it in the Dock and repeat the checks above.
  - Afterwards, `rm node_modules/electron/dist/Electron.app/Contents/Resources/app`
    and remove it from the Dock.
  - If Electron shows its default page, not grove, record "Dock launch not
    verifiable with the dev binary; carried to child 8".
  - Record the Dock-launch env result in `06-implementation.md` either way. It
    closes the research's open "Dock-launch env" unknown.
- [ ] Stop for review. The child is done when all six slices are verified.

## Open questions
