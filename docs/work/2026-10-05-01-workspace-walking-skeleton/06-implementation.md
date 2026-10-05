---
feature: 2026-10-05-01-workspace-walking-skeleton
phase: implementation
status: in-progress
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
- [ ] Slice 3. OpenCode sessions with a minted id and the user's shell env
- [ ] Slice 4. Session and project lifecycle in the sidebar
- [ ] Slice 5. Terminal fidelity and keys
- [ ] Slice 6. Finder and Dock launch work like `npm run dev`

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

To be done by the human. Results go here.

- [ ] Cmd+T → OpenCode → the TUI opens in the repo. `say hi` + Enter gets a model reply, with no `provider.auth` / 403 error.
- [ ] `tmux -L grove list-panes -t =grove-<id> -F '#{pane_start_command}'` contains the `opencodeSessionId` from `jq '.sessions[] | {tmuxName, opencodeSessionId}' ~/Library/Application\ Support/grove/state.json`.

### Deviations (small, two-way)

1. **The id is minted in `newSession`, not in `core.ts`.** `newSession` already
   gets `now`, so it sets `opencodeSessionId` for `kind: 'opencode'`. Core
   builds the `loginShellArgv` from that id.
2. **Extra test:** a terminal create passes no `argv`. The plan states this
   rule but listed no test for it.
