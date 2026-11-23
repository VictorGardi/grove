# Pinned spaces: how keys, persistence, windows and space identity work today

Facts only, as of master at fe348e2. Paths are under /Users/victor/git/grove.

## 1. Keyboard shortcuts

### Where they are defined
A shortcut is a **key action** (a string id) with a binding string such as `mod+shift+n`. Four places carry the full list, all keyed by the same 29 action ids:
- Type `KeyAction`: `packages/protocol/messages.ts:283-312`. `ConfigValues.keys: Record<KeyAction,string>` at `messages.ts:328`. RPC `config.setKey` at `messages.ts:548`. Broadcast `config.changed` at `messages.ts:611`.
- `KEY_ACTIONS` array (`packages/core/config/schema.ts:26-56`, `satisfies readonly KeyAction[]`), `DEFAULT_VALUES.keys` (`schema.ts:~68-100`), `KEY_DESCRIPTIONS: Record<KeyAction,string>` (`schema.ts:~127-160`, text written into AGENTS.md in the config folder), the `keys.json` schema built by mapping KEY_ACTIONS (`schema.ts:272-300`).
- Window handlers: `keyActions: Record<KeyAction, () => void>` at `packages/ui/main.ts:333-382` (TypeScript forces an entry for every action).
- Panel labels: `KEY_LABELS: Record<KeyAction,string>` at `packages/ui/keys-panel.ts:8-37`.
- README documents the defaults in one paragraph: `README.md:118` (it lists only some actions; not next-urgent, newest-tab, palette, diff, usage, grid-reset-layout, new-grid-shell).
- Tests that enumerate: `packages/ui/keys-panel.test.ts` (imports `KEY_LABELS`), `packages/core/config/schema.test.ts:43` (default file validates).

### Full list of bound keys (defaults, `schema.ts` DEFAULT_VALUES.keys). `mod` = Cmd on macOS, Ctrl elsewhere
| Action | Binding | Action | Binding |
|---|---|---|---|
| grid-toggle | mod+g | palette (Go to) | mod+k |
| new-shell | mod+t | sidebar-toggle | mod+b |
| new-grid-shell | mod+shift+t | notes | mod+shift+n |
| new-space | mod+n | diff (Changes) | mod+shift+d |
| close-tab | mod+w | usage | mod+shift+u |
| previous-tab | ctrl+tab (Control+Tab on Mac too) | dock-expand | mod+shift+e |
| grid-tab | mod+shift+g | zoom-in / out / reset | mod+= / mod+- / mod+0 |
| grid-reset-layout | mod+shift+l | space-1..space-9 | mod+1 .. mod+9 |
| next-urgent | mod+. | push-to-talk (voice) | ctrl+space (held) |
| newest-tab | mod+shift+j | | |

Other keys handled that are not in keys.json (hard-coded):
- Shift added to the previous-tab binding steps the other way along the strip (`main.ts:1686-1697`).
- In grid mode: Cmd+Option+arrow moves between panes, +Shift swaps, Cmd+Ctrl+Option+arrow nudges a divider (`main.ts:1699-1725`; Ctrl+Alt off the Mac).
- Go to: Esc, arrows, Enter, Cmd/Ctrl+Enter opens in grid (`goto.ts:251-262`). Diff panel: Cmd/Ctrl+F filter (`diff-panel.ts:1098-1099`), Cmd/Ctrl+Enter sends a comment (`diff-panel.ts:406`). Dock/modals/context menu: Esc and arrows.
- Native macOS menu (`packages/ui/src-tauri/src/lib.rs:313-343`): predefined items only: About, Hide (Cmd+H), Hide Others, Show All, Quit (Cmd+Q), Undo/Redo, Cut/Copy/Paste/Select All, Minimize (Cmd+M). Cmd+W is deliberately left out of the menu so the page sees it (`lib.rs:311-312`). No custom menu accelerators; no global-shortcut plugin (Cargo.toml has only the notification plugin, `lib.rs:365`).

### How a key is matched and handled
- One capture-phase `keydown` listener on `window`, `main.ts:1667-1730`. It runs `findAction(keys, event, isMac)` (`packages/ui/config.ts:133`), then `preventDefault()` + `stopPropagation()` and `keyActions[action]()`. Because it is capture-phase and stops propagation, a matched chord never reaches the focused xterm/terminal or the program in the pane.
- Skipped while Go to (except its own key, to close), the rename modal, integration panel, space dialog or context menu is open (`main.ts:1668-1679`). Voice (`push-to-talk`) returns early and only consumes the key in an agent tab (`main.ts:1680-1688`).
- Matching rules: `bindingMatches` (`config.ts:119-131`): modifiers must match exactly; key is by physical code (letters, digits, Period, Space) except `=`/`-` which go by character (`config.ts:77-90`). A binding is modifiers (mod, ctrl, alt, shift; at least one) + one `[a-z0-9.=-]` or `tab`/`space` (`schema.ts canonicalBinding`, ~108-117).
- The keymap `keys` in main.ts starts from defaults and is replaced by every `config.changed` (`applyConfig`); the core is the single owner of keys.json.

### How a new shortcut is registered and shown
1. Add the id to `KeyAction` (`messages.ts`), `KEY_ACTIONS`, `DEFAULT_VALUES.keys`, `KEY_DESCRIPTIONS` (schema.ts); `KEY_LABELS` (keys-panel.ts); `keyActions` (main.ts). The compiler enforces the Record types; README paragraph is manual.
2. Validation: the `keys.json` schema rejects two actions sharing a binding (`schema.ts:~285-298` `check`, message "`<action>: same binding as <other>`"). An action missing from an existing keys.json takes its default (`validateFile`, `schema.ts:~370-374`). An unknown key in the file is rejected ("unknown key").
3. Shown in the Keys settings section: `createKeysPanel` (`keys-panel.ts:46-...`) renders one row per `KEY_LABELS` key (`Object.keys(KEY_LABELS)`), a chip with `formatBinding(...)` (e.g. "Cmd+Shift+N"), click-to-record, a Reset button when it differs from default. Rebinding goes through `config.setKey` (core `ConfigStore.setKey`, `packages/core/config/store.ts:65-85`: validates the whole file, keeps keys.json.bak, writes `~/.grove/config/keys.json`), which then broadcasts `config.changed`.
4. Shown elsewhere: `shortcut(action)` / `paintShortcuts()` (`main.ts:919-930`) writes the current binding into tooltips (dock-expand, grid-reset-layout, grid-toggle, sidebar-toggle, rail buttons via `rail.paintShortcuts`). The empty-state text hard-codes "Cmd+N" (`index.html:58`). Voice shows its key in a notice (`main.ts:1590`).

### Pin-like chords today (defaults)
- Cmd+Shift+D: TAKEN by `diff` (Changes panel).
- Cmd+Shift+P, Cmd+P, Cmd+D: not bound by any Grove key action, hard-coded handler, or native menu item. (Cmd+Shift+N=notes, Cmd+Shift+U=usage, Cmd+Shift+E, Cmd+Shift+G, Cmd+Shift+L, Cmd+Shift+J, Cmd+Shift+T are taken.) Cmd+F is used only inside the diff panel.
- Terminals/agent apps in panes: a chord Grove matches is swallowed (capture + stopPropagation), so Grove wins over anything in the pane. An unmatched chord goes to the terminal; `packages/ui/terminal.ts` has no custom key handler (xterm defaults). Terminal programs on macOS normally receive no Cmd+letter input at all; this repo has no document of what Claude/OpenCode/Copilot bind, so that is not verified here. Existing precedent for a Ctrl chord that terminals use: Ctrl+Space is NUL in a terminal and macOS input-source switching; Grove catches it first and passes it on only in a shell tab (`.scratch/voice-input/decision-log.md:45`).
- The keys panel binding recorder only accepts a binding with a modifier + letter/digit/period/=/-/Tab/Space (`keys-panel.ts` error text).

## 2. Persistence today

Three stores, none shared by the others:

### a) Browser `localStorage` of the single window (per window/webview origin, never seen by the core)
Accessor `storage()` returns `localStorage` or null if access throws (`main.ts:1421-1427`); read per use. Shared mechanism `persistedPref<T>` (`packages/ui/persisted-pref.ts:1-53`): one key, a `fallback`, `decode`/`encode`; null store, throwing store or junk text all fall back to default silently (unless an `onFailure` hook). `flagPref` for booleans. Keys in use (grep of ui/*.ts):
`grove.theme`, `grove.zoom`, `grove.sound`, `grove.agent-appearance`, `grove.sidebar-hidden` (`'1'/'0'`, `sidebar-state.ts:8-13`), `grove.sidebar-folds` (JSON array of repo names; on write only repos that still have a heading are kept, `sidebar-state.ts:28-40`; read at `main.ts:119`, written `main.ts:1043`), `grove.view-state`, `grove.dock-width`, `grove.dock-expanded`, `grove.pane-dim`, `grove.usage-breakdown`, `grove.usage-range`, `grove.voice-language`.
- `grove.view-state` (`packages/ui/view-state.ts`): JSON `{gridOn, gridTabs[], gridLayout, activeSpace, activeTab}`; ids stored are space/tab ids. Written by the window store after every change once restored (`window-store.ts:162-168`), read once on first reconcile (`window-store.ts:232-243`). A saved activeSpace/activeTab that no longer exists is dropped silently (`window-store.ts:239-243`). Port: `ViewStatePort`, `storageViewState`, `noViewState`, `memoryViewState` (`view-state.ts:42-65`).
- Decisions: `.scratch/persisted-prefs/outcome-brief.md` and `decision-log.md` (all eight prefs kept in browser storage, same keys and formats, no migration of later settings; stated non-goal "any new setting"; per-folder diff prefs "live in the core state file, not browser storage", `research-behaviour.md`). `.scratch/window-store/spec.md`: the window store owns spaces/tabs/active/recent/grid; view state saved through the port (user stories 5-9, 30-31); "Not owned: ... config (keys, theme tokens, notes), sound ..."; "Any change to the core, the protocol or the CLI" is out of scope there. Recent order is not saved (spec story 6); it is re-seeded from the active tab on start.
- ADR 0005 (`docs/adr/0005-sidebar-groups-a-repo-under-a-heading.md`): fold choice "saved per repo ... a new stored preference that must drop repos that no longer exist" (this is the sidebar-folds key). Other ADRs: 0001 git reads/writes, 0002 session names on tabs, 0003/0004 usage history, 0006 voice. None covers pins or cross-window state.

### b) The core's state file `~/.grove/state.json` (shared by everything that talks to the core)
`packages/core/store/state.ts`: `StateV1 { version:1, spaces: SpaceRecord[], tabs: TabRecord[], diffPrefs?, diffComments? }`. `SpaceRecord = { id?, path, name? }` (`state.ts:6-10`); optional fields were added without a version bump ("a version-1 file written before them loads unchanged", `state.ts:12-14, 36-40`). Loading: `loadState` (`state.ts:~86-130`): missing file = empty; unparseable/malformed body is renamed `.corrupt-<ms>` and replaced by empty; a file with a missing/other `version` is refused (core runs in refused mode; spaces writes throw via `assertNotRefused`) and left untouched. Writes are atomic: temp file, fsync, rename (`saveState`, `state.ts:~134-148`). The file today has keys `version, spaces, tabs, diffPrefs, diffComments`. Space order in the sidebar = order of `state.spaces` (`SpacesService.list` maps it, `spaces.ts:58-74`).
- This is how spaces, tabs (id, spaceId, label, agent, agentSessionId, found) and per-folder diff prefs/comments survive restart. Mutations: `SpacesService.add/removeSpace/renameSpace`, etc.; each saves then the daemon broadcasts (`spaces.changed`, `spaces.removed`, `tabs.opened`, `tabs.closed`).
- Live PTYs survive a window quit in the separate holder process (`~/.grove/h` socket, `holder.log`); the core listens on `~/.grove/s` (`packages/protocol/paths.ts:18-52`, `groveHome()` honours `GROVE_HOME`).

### c) Other files under `~/.grove` (core-owned)
`config/` (settings.json, keys.json, launchers.json, theme.json, layout.json, AGENTS.md; five validated files, hot-reloaded by `watchConfig` and broadcast as `config.changed`, `daemon.ts:245`), `notes.md` (the notes page), `integrations.json` (consent record, `daemon.ts:141`), `models/` (voice), `agents/`, `worktrees/<repo>/`, `config.json` (a stray older file; not referenced by code found), `dev-userdata/`. Config files hold nothing per-space except `layout.json` `sidebarOrder` (order of two sections: spaces, agents) and `settings.json` `sidebarWidth`.

### Per-window vs shared (today)
- Per window (webview localStorage; no `storage` event listener exists, `grep "'storage'"` empty): theme, zoom, sound, appearance, sidebar hidden and folds, view state (active tab/space, grid), dock, pane-dim, usage, voice language. Active tab and active space are also in-memory per window.
- Shared through the core (all connected clients see it, broadcast on change): spaces list and names, tabs and their labels, config (keys, theme tokens, layout, settings), notes, diff prefs/comments, agent status, usage.

## 3. Multiple windows and sync

- Tauri config declares exactly one window, label `main` (`packages/ui/src-tauri/tauri.conf.json:12-21`); capability file lists only `["main"]` (`capabilities/default.json:4`); `raise_window` fetches `"main"` only (`lib.rs:233-239`); nothing in `lib.rs` creates another webview window. The Rust `Bridge` holds one `events: Option<Channel>` slot, which `connect` overwrites (`lib.rs:27-32, 179-186`), so a second webview in the same app process would replace the first's event channel. No single-instance plugin is configured.
- The core supports several clients: it keeps a `Set` of sockets and `broadcast()` writes every notification to all of them (`daemon.ts:224-228`); CLI processes are also clients. Comments/spec text already speak of "every window" and "another window or the CLI" (`protocol/messages.ts:610` "every window applies it"; `main.ts:294, 1347`; window-store spec story 28 "added or changed elsewhere (CLI, another window)"). `attention.focus` tracks "the client that last sent" it (`daemon.ts:232`).
- Sync mechanism between clients is therefore: the core is the source of truth for spaces/tabs/config and pushes notifications: `spaces.changed` (add/rename/git change, `daemon.ts:751,764`, git poll `171,214`), `spaces.removed` (`daemon.ts:785`), `tabs.opened/closed/focus`, `config.changed`, `status.changed`, `usage.changed` (`messages.ts:593-615`). The window applies them at `main.ts:1335-1351`. After a core reconnect the window resyncs with `spaces.list` (`messages.ts:518-520`, store `reconcile`).
- Anything held in `localStorage` is NOT synced by any code. (Tabs of different windows of one Tauri app would share the same localStorage origin on disk, but no code listens for or merges changes.) There is no RPC today that stores a per-space flag; `spaces.rename` is the only per-space user-set field (`name`).

## 4. Where a space's identity comes from, and whether it survives restart

- A space has an opaque `id` that is not a path: `SpaceInfo.id` "Opaque, and not a path. Spaces saved before ids existed have their path as their id" (`messages.ts:212-214`). New spaces get `sp_<12 hex>` from `SpacesService.newSpaceId` (`spaces.ts:470-476`), saved in `state.json` `spaces[].id` (`add`, `spaces.ts:100`). Real examples in `~/.grove/state.json`: `sp_acf823e53787`, `sp_34cf99fbac6b`.
- Legacy records without an id are filled on load: first space of a path gets the path as id, later ones `${path}#n` (`state.ts:fillIds`, ~lines 55-70); `recordSpaceId(space) = space.id ?? space.path` (`state.ts:30`).
- `spaces.add` always creates a new space even when the folder already is one; two spaces can share a folder (`spaces.ts:99`, `messages.ts:522`), so path is not a unique key. `path` is the `realpath` of the folder (`spaces.ts:91-95`).
- Survives restart: yes, id is persisted in `state.json` and is stable across app/core restarts; it stays the same through rename (`renameSpace` replaces only `name`, `spaces.ts:121-131`). It disappears when `spaces.remove` drops the record (`removeSpace`, `spaces.ts:107-114`), which also removes its worktree checkout when asked; a later re-add gets a new id. A worktree space is a separate space with its own id; its `parent` is derived from git at read time (`describe`, `spaces.ts:505-520`), not stored.
- Tabs reference it by `spaceId` (`TabRecord.spaceId`, `state.ts:21`). The window already stores space ids (not paths) in `grove.view-state.activeSpace` and keys sidebar folds by repo name instead (`sidebar-state.ts`), with stale entries pruned on read/write.
- The core-side space set is the only authority on whether an id still exists; the window learns of removals through `spaces.removed` or a `spaces.list` resync (`main.ts:1348`).
