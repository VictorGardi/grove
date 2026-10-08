---
feature: 2026-10-05-01-workspace-walking-skeleton
phase: implementation
status: complete
version: 1
created: 2026-10-05
updated: 2026-10-05
based_on:
  - 03-design.md@1
  - 04-structure.md@1
  - 05-plan.md@1
forced: []
---

# Implementation: workspace walking skeleton

## Gate note

`05-plan.md` was set to `approved` by `grove-plan` itself, not by a human
through `grove-approve` (the plan says so in its **Approval** paragraph). On
2026-10-05, when invoking `grove-implement`, the human was asked and chose
"Proceed, I accept it". That choice is the human approval of the plan for
this implementation.

## Slices

- [x] Slice 1. Tracer: add a project, open a terminal session in tmux
- [x] Slice 2. Sessions persist, reconcile on start, and go `gone`
- [x] Slice 3. OpenCode sessions with a minted id and the user's shell env
- [x] Slice 4. Session and project lifecycle in the sidebar
- [x] Slice 5. Terminal fidelity and keys
- [x] Slice 6. Finder and Dock launch work like `npm run dev`

## Slice 1

### Automated verification (2026-10-05)

- `stat -f %Lp node_modules/node-pty/prebuilds/darwin-*/spawn-helper` → `755` (arm64 and x64)
- `grep -rn "from 'electron'" src/core` → no output
- `npm run typecheck` → passes
- `npm test` (sandbox off) → 2 files, 11 tests pass. `tmux.test.ts` ran all 6 cases, none skipped
- `npm run build` → passes (not required for this slice; run as a smoke check)
- `npm run dev` smoke run for 10 s → main, preload and renderer start with no errors

### Manual verification

Reported passing by the human on 2026-10-05.

- [x] Add project → `~/.config/grove/config.json` has `schemaVersion: 1` and one project `{ id, name: "grove", path }`. Cmd+T → Terminal → Create → `pwd` prints the repo path. `tmux -L grove ls` lists `grove-<uuid>`.
- [x] Cmd+Q → within 2 s the app is gone, and `tmux -L grove ls` still lists the session. No hang, so the SIGKILL fallback was not added.

### Deviations (small, two-way)

1. **`registerIpc(core, getWindow, getErrors)`**: takes a third argument that
   supplies the `app:errors` list. Main passes `core.getErrors` for now. Slice 6
   will concatenate main's own errors there without changing `ipc.ts`.
2. **`hydrate()` subscribes to the `state:*` pushes before it invokes
   `state:get`**, not after. This way a push between the two can't be lost.
   Last write wins either way.
3. **`TerminalView` writes `[detached]`** to the terminal when its attach gets
   `pty:exit`. The plan didn't say what to do on exit. Without this, a pane
   whose tmux client died just freezes with no sign.
4. **`TerminalView` detaches a late attach.** If the component unmounts before
   `pty:attach` resolves, it sends `pty:detach` for the returned id, so the PTY
   isn't leaked.
5. **`Commands` is declared in `core.ts`** and has only the slice-1 methods
   (`projectAdd`, `sessionCreate`). Later slices add methods as their channels
   arrive.
6. **`grove.config.json`** was rewritten through a JSON serializer, which
   expanded `"tracker": { "type": "none" }` onto three lines. The values are
   unchanged.
7. **`.gitignore`** already had `out/`, so it wasn't changed.
8. **Environment, not code:** inside Claude Code's sandbox, `node
   node_modules/electron/install.js` fails with `fetch failed` (`ENOTFOUND`)
   because Node's fetch ignores the proxy env vars. Running it with
   `NODE_USE_ENV_PROXY=1` downloaded Electron. npm itself needed
   `npm_config_cache=$TMPDIR/npmcache`, as the plan predicted.

## Slice 2

### Automated verification (2026-10-05)

- `npm run typecheck` → passes
- `npm test` (sandbox off) → 4 files, 23 tests pass, tmux tests not skipped
- `grep -rn "from 'electron'" src/core` → no output
- `npm run build` → passes. The `npm run dev` smoke run for 10 s logged no errors

### Manual verification

Reported passing by the human on 2026-10-05.

- [x] Two sessions, `echo hello` in the focused one, Cmd+Q, `npm run dev` → both listed, focused one attached showing `hello`.
- [x] `tmux -L grove kill-session -t =grove-<id>` while running → `gone` within 5 s. Quit, kill another, relaunch → `gone`. `jq '.sessions[].endedAt' ~/Library/Application\ Support/grove/state.json` prints a timestamp for both.
- [x] Quit, `echo '{' > ~/Library/Application\ Support/grove/state.json`, relaunch → red banner, one `state.json.bad-*` file.

### Deviations (small, two-way)

1. **Saving is centralized in core's `set()`.** Every slice change saves the
   file that owns it (`projects` → config, `sessions`/`ui` → state), so
   `projectAdd` no longer calls `saveConfig` itself. Behaviour is the same, and
   the plan's "every mutation saves" rule now holds by construction.
2. **`loadState` also fills in a missing `sessions` field** with `[]`, not just
   a missing `ui`.
3. **Extra tests:** `stateStore.test.ts` checks that a missing `ui` is filled
   in. `sessions.test.ts` checks that an attach's exit triggers a liveness
   check. The plan requires both behaviours but listed no tests for them.
4. **`FakeBackend` is a class** (`src/core/testing/fakeBackend.ts`). It also
   keeps `handles`, so tests can call `emitExit()` on an attach.

## Slice 3

### Automated verification (2026-10-05)

- `npm run typecheck` → passes
- `npm test` (sandbox off) → 6 files, 32 tests pass, tmux tests not skipped
- `grep -rn "from 'electron'" src/core` → no output
- `npm run build` → passes
- `mintSessionId(1776959130999)` gives the prefix `ses_244fb7288ffe`, which matches the real id on this machine

### Manual verification

Reported passing by the human on 2026-10-05.

- [x] Cmd+T → OpenCode → the TUI opens in the repo. `say hi` + Enter gets a model reply, with no `provider.auth` / 403 error.
- [x] `tmux -L grove list-panes -t =grove-<id> -F '#{pane_start_command}'` contains the `opencodeSessionId` from `jq '.sessions[] | {tmuxName, opencodeSessionId}' ~/Library/Application\ Support/grove/state.json`.

### Deviations (small, two-way)

1. **The id is minted in `newSession`, not in `core.ts`.** `newSession` already
   gets `now`, so it sets `opencodeSessionId` for `kind: 'opencode'`. Core
   builds the `loginShellArgv` from that id.
2. **Extra test:** a terminal create passes no `argv`. The plan states this
   rule but listed no test for it.

## Slice 4

### Automated verification (2026-10-05)

- `npm run typecheck` → passes
- `npm test` (sandbox off) → 7 files, 41 tests pass, tmux tests not skipped
- `grep -rn "from 'electron'" src/core` → no output
- `npm run build` → passes
- `npm run dev` smoke run for 10 s, stopped with `pkill`. The log has two
  `Error sending from webContents: Render frame was disposed before WebFrameMain could be accessed`
  lines. A saved focused session re-attached, and its `pty:data` arrived while
  the forced kill tore the renderer down. Electron logs this and nothing
  throws. Not fixed: watch whether it appears on a normal Cmd+Q.

### Manual verification

Reported passing by the human on 2026-10-05.

- [x] Cmd+W → Cancel → still running. Cmd+W → Confirm → row `gone`, and `tmux -L grove ls` no longer lists it. **Remove** → row gone. Rename a session, relaunch → the name is kept.
- [x] With two running sessions, Cmd+1 / Cmd+2 switch terminals, and `tmux -L grove list-clients` shows exactly one client. **Remove project** on a project with a running session → the refusal message shows.

### Deviations (small, two-way)

1. **Shared test helper** `src/core/testing/setup.ts` (`setupCore`,
   `createTerminal`, `NOW`, `LATER`). `sessions.test.ts` now uses it, and so
   does the new `projects.test.ts`.
2. **`sessionKill` re-reads the session after `backend.kill`**, so a poll that
   marked it gone while the kill was running keeps that poll's `endedAt`.
3. **`projectRemove` also clears `ui.focusedSessionId`** when the focused
   session was one of the removed ones, the same as `sessionRemove`.
4. **Pure helpers:** `hasLiveSessions` in `projects.ts`, and `markGone` and
   `rename` in `sessions.ts`. `reconcile` now uses `markGone`.
5. **`src/renderer/src/sidebarOrder.ts`** holds the sidebar order (projects
   in config order, then sessions by `startedAt`). The sidebar and
   Cmd+1..9 both use it.
6. **`ConfirmDialog` listens in the capture phase** and stops propagation of
   Enter/Esc, so those keys never also reach a focused terminal.
7. **Renaming:** an empty or whitespace-only label is ignored. Blurring the
   input cancels.
8. **The "Can't remove" message** stays under the project header until the
   next **Remove project** click on a project.

## Slice 5

### Automated verification (2026-10-05)

- `npm run typecheck` → passes
- `npm test` (sandbox off) → 7 files, 43 tests pass, including the new real-tmux colour test
- `grep -rn "from 'electron'" src/core` → no output. `grep -rn before-input-event src` → no output
- `npm run build` → passes. The `npm run dev` smoke run for 10 s logged no errors

### Manual verification

Reported passing by the human on 2026-10-05, including the modal fix (deviation 4). Only sessions created after this
slice get the pane colours, so use a **new** Terminal session.

- [x] Truecolor: the `awk` gradient one-liner from the plan shows a smooth red-to-green band.
- [x] OSC 11: `printf '\e]11;?\a'; sleep 0.2` echoes `rgb:1e1e/1e1e/1e1e`.
- [x] Keys: `python3 spikes/electron/keylog.py "$TMPDIR/keylog.txt"` matches the plan's table.

### Deviations (small, two-way)

1. **The `setColors` target is `=grove-<id>:` (trailing colon), not
   `=grove-<id>`.** The new real-tmux test failed with the plan's form:
   `select-pane -t =grove-c` gives `can't find pane: =grove-c`, because for a
   pane or window target tmux reads `=name` as an exact *window* name.
   `=grove-c:` names the session exactly, then takes its current window and
   pane. Checked by hand: with `grove-c` and `grove-cc` both present, styling
   `=grove-c:` left `grove-cc` unstyled. This keeps the design's two-way
   "Targets: always exact match" rule. The design's tmux contract table shows
   `select-pane -t =grove-<id>`, and that form doesn't work. The session-level
   commands (`kill-session`, `attach-session`) keep `=grove-<id>`, which tmux
   reads as a session there. The test's `show-options -p/-w` targets use the
   same `:` form.
2. **View menu layout:** **Command Palette** comes first, and in dev a
   separator comes before the DevTools and reload items.
3. **Noticed while checking:** in zsh, an unquoted `=grove-<id>` is expanded
   as a command path (`grove-c not found`). The manual commands in the plan
   (`tmux -L grove kill-session -t =grove-<id>`) need quotes in zsh:
   `-t '=grove-<id>'`.
4. **Bug fix (reported by the human during slice 5 review):** with a terminal
   open, the Cmd+T modal couldn't be clicked, because clicks went to the
   terminal underneath. Cause: xterm.css gives absolutely positioned layers
   z-indexes 5–11 (helper textarea, scrollbar, decorations). The terminal
   container made no stacking context, so those layers painted above the
   modal's `position: fixed` backdrop, which had no z-index. The
   ConfirmDialog had the same problem. Fix: `isolation: 'isolate'` on the
   `TerminalView` container, and `zIndex: 1000` on both overlay backdrops.

## Slice 6

### Automated verification (2026-10-05)

- `npm run typecheck` → passes
- `npm test` (sandbox off) → 7 files, 47 tests pass. The `/opt/homebrew/bin/tmux` fallback test ran (not skipped)
- `grep -rn "from 'electron'" src/core` → no output
- `npm run build` → passes. The `npm run dev` smoke run for 10 s logged no errors

### Manual verification

Reported passing by the human on 2026-10-05.

- [x] Launch Services env (`env -i /usr/bin/open -n -a …`): an OpenCode session replies to `say hi`. In a Terminal session, `locale` shows `LANG="en_US.UTF-8"` and `$PATH` contains `/opt/homebrew/bin`. Relaunch the same way → the sessions re-attach.
- [x] Dock launch: same checks, or "Dock launch not verifiable with the dev binary; carried to child 8".

Dock-launch env result: the human reported that the Dock checks pass. A Dock launch finds tmux, and sessions get `LANG` and Homebrew on `PATH`. This closes the research's open "Dock-launch env" unknown.

### Deviations (small, two-way)

1. **`minimalEnv` rebuilds `PATH`** from the non-empty entries plus the missing
   `FIXED_DIRS`, so empty segments (`::`) are dropped.
2. **Main's startup errors** live in a local `errors` array in `index.ts`.
   `app:errors` returns `[...errors, ...core.getErrors()]` through the
   `getErrors` argument added to `registerIpc` in slice 1.

## Final checks (2026-10-05)

All configured commands pass on `d35597f`:

- `npm run typecheck` → passes
- `npm test` (sandbox off) → 7 files, 47 tests pass
- `npm run build` → passes
- `grep -rn "from 'electron'" src/core` → no output

There is no lint command in this child. The tracker is `none`, so no comment was posted.

## PR description

### Workspace walking skeleton

Child 1 of the `opencode-feature-workspace` epic. This is the thinnest
end-to-end grove app. Add a repo as a project, start an OpenCode or terminal
session in tmux, work in it in xterm.js, quit, relaunch, and find it still there.

**Design in brief** (`03-design.md`):
- Core runs in Electron main behind a seam with no Electron imports (E-D4):
  projects, sessions, the JSON stores and the tmux backend. It is tested with
  vitest, including against real tmux on a throwaway socket.
- Sessions live in tmux on a dedicated socket (`-L grove`), with a shipped
  `resources/tmux.conf`, and are attached through node-pty (E-D3). Targets are
  always exact (`=grove-<id>`, `=grove-<id>:` for pane commands).
- Each session gets the user's login-shell env (D1 / ADR 0010). OpenCode runs
  as `$SHELL -l -i -c 'exec opencode -s <minted ses_ id>'`.
- Main → renderer state uses whole-slice snapshots, coalesced per tick (D2 /
  ADR 0011). Commands are `invoke` calls returning `Result<T>`.
- State is kept in versioned JSON with atomic writes (E-D7):
  `~/.config/grove/config.json` (projects) and
  `~/Library/Application Support/grove/state.json` (sessions, ui). A bad file
  is moved aside and shown in an error banner.

**Slices:**
1. Tracer: add a project, open a terminal session in tmux (`61cf125`)
2. Sessions persist, reconcile on start, and go `gone` (`57023a0`)
3. OpenCode sessions with a minted id and the user's shell env (`9772ce0`)
4. Session and project lifecycle in the sidebar: kill, remove, rename,
   Cmd+1..9, remove project (`c9cc791`)
5. Terminal fidelity and keys: WebGL, truecolor, OSC 10/11, menu-owned
   accelerators (`0c4ee4b`, plus the overlay z-index fix `c73a1e9`)
6. Finder and Dock launches find tmux and set a UTF-8 locale (`d35597f`)

**How to verify:**
- `npm install`, then `npm run typecheck`, `npm test` (needs access to
  `/private/tmp/tmux-501`, so run it outside sandboxes) and `npm run build`.
- `npm run dev`: Add project → Cmd+T → OpenCode → `say hi` gets a reply. Then
  Cmd+Q, and `npm run dev` again: the session re-attaches.
- `tmux -L grove kill-session -t '=grove-<id>'` while the app runs → the row
  shows `gone` within 5 s.
- The manual checks for each slice are listed above, and all passed on 2026-10-05.

**Notable deviations:** the pane-target form `=grove-<id>:` (slice 5,
deviation 1), and the overlay stacking fix (slice 5, deviation 4). Everything
else is a small naming or helper choice, logged per slice.

