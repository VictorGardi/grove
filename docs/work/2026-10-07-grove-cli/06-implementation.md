---
feature: 2026-10-07-grove-cli
phase: implementation
status: draft
version: 1
created: 2026-10-07
updated: 2026-10-07
based_on:
  - 05-plan.md@1
forced: []
---

# Grove CLI — implementation

## Progress

- [x] Slice 1 — `grove ls` from a grove session (tracer)
- [x] Slice 2 — `grove new` in any folder, with prompt, label and link
- [x] Slice 3 — `grove send` and `grove read`
- [x] Slice 4 — `grove wait`, `send --wait`, `new --wait`
- [x] Slice 5 — `focus`, `kill`, install and skill

## Slice 1

Deviations (all small, none touch a one-way decision):

- `CliSession.cwd` is the project path for now; `Session.cwd` arrives in slice 2.
- `grove ls` and the `CliMethods` type only declare `sessions.list`; other methods answer `bad-method` until their slices.
- `request()` resolves a `not-running` error reply instead of throwing; `exitCode` maps it to 3.
- `loginShellArgv`'s second parameter changed from a shell string to `{ shell?, pathPrefix? }`.
- `CoreOptions.sessionEnv` carries socket path and bin dir; without it sessions get no `GROVE_*` env (keeps existing tests unchanged).
- `main/index.ts` shares one `raise()` between the notification click and `second-instance`.
- `startCliServer` returns a `Promise` (it resolves once listening); `raise` is accepted but unused until slice 5.
- `tsconfig.node.json` now includes `src/cli/**`.
- Terminal sessions get `PATH=<bin>:<minimalEnv PATH>` through tmux `-e`.

### Fixes after first manual run

- **Launcher bug:** `: "${GROVE_SOCKET:='…'}"` left literal single quotes in the socket path under `sh`, so the CLI reported "not running" with the app up. Now `[ -n "$GROVE_SOCKET" ] || GROVE_SOCKET='…'`; the test runs the launcher against a fake executable instead of matching text.
- **Decided by the human (option A), no design change:** on this macOS, `/etc/zprofile`'s `path_helper` rebuilds `PATH` from scratch in login shells, so the tmux `-e PATH=<bin>:…` for **terminal** sessions is overwritten and `grove` is not found there. Agent sessions are unaffected (prefix runs after rc). Design C5 chose `-e` for terminal sessions; terminal sessions keep `-e` as designed. `grove` is found there once **Install Command Line Tool…** (slice 5) links `~/.local/bin/grove`; until then use `<userData>/bin/grove`. Slice 5's manual check must confirm this from a terminal session. Human verified `<userData>/bin/grove ls` works.

## Slice 2

Deviations (small; none touch a one-way decision):

- Core tests for `sessionCreate` live in the new `src/core/sessionCreate.test.ts`, not `sessions.test.ts`.
- `sessionCreate` takes no `caller` option (the design's signature listed one; nothing uses it yet).
- Exactly one of `projectId`/`cwd` is used: `projectId` wins if both are given; the app passes only `projectId`.
- New error code `no-feature` (design only said `--link` is checked first). The server maps core codes to `{code, message}`; bad `kind`/`cwd` params reply `bad-params`.
- `--link` for a folder that would register a new project always fails (`no-feature`): a new project has no discovered features yet.
- The project is registered after `backend.create` succeeds, so a failed create leaves nothing behind.
- A terminal's prompt is sent after `paneStable` returns, even when the pane never settled within 10 s (so the prompt isn't lost).
- A Claude prompt starting with `-` is passed after `--`; not verified against the real `claude` parser (manual check below).
- Stored `cwd` is the real path (`realpath`) of the folder; equal to the project's real path → `null`.
- Three renderer test fixtures gained `cwd: null`.

### Slice 2 manual verification (run by the agent, headless)

Real core, tmux backend (own socket and temp state), CLI server and the built `grove` through the real launcher; real Claude sessions. All passed:

- `grove new claude --cwd <repo>/docs --prompt … --label helper`: project registered (git top level), label pinned and shown as Claude's `--name`, cwd stored, the prompt ran and was answered.
- `grove new terminal --link no-such-slug`: exit 1, `no-feature`, no session created.
- `grove new terminal --prompt 'echo …'`: typed and run once the pane was stable.
- Kill then resume: restarted in the stored folder, history intact.
- A prompt starting with `-` works as `--prompt=-text`. `--prompt -text` (space) is rejected by `node:util` `parseArgs` ("argument is ambiguous") with its own hint. Left as is; `--prompt -` reads stdin.
- Claude shows its workspace-trust dialog in a never-trusted folder; the prompt waits behind it. Claude's behaviour, not grove's.

## Slice 3

Deviations (small; none touch a one-way decision):

- `sessionRead` is on `Commands` (not a separate `Core` method); an unknown id is `not-found`, a gone session returns whatever the pane capture gives (empty).
- `send` and `read` resolve refs over all sessions, gone ones included (so `send` can resume a gone agent session).
- New server messages for `gone` and `not-ready`.
- `grove send` prints nothing on success.
- Tests and code were written together rather than strictly red-first.

## Slice 4

Deviations (small; none touch a one-way decision):

- `waitTurn` lives in `cliOps.ts` as `waitTurn(deps, id, o)` with `deps = { find, onSessions }`; `Core.waitTurn` wires it to the sessions slice listener. `TurnResult` is in `shared/cli.ts`.
- `--wait` on `send`/`new` runs inside the same request (`wait`, `timeoutS` params; `turn` in the reply data). A timeout after `new` replies `timeout` with the new session id in the message.
- A `--timeout` of `0` or less is a usage error; timeouts take fractional seconds.
- A finished-unseen turn (`waiting`/`done`) counts as finished (exit 0); only `permission`/`question` exit 4.
- Tests and code were written together rather than strictly red-first.

## Slice 5

Deviations (small; none touch a one-way decision):

- `installCommandLineTool` returns `{ ok, target, onPath } | { ok: false, message }`; it refuses (touches nothing) when `~/.local/bin/grove` exists and is not a symlink, and replaces a symlink.
- The menu item's `PATH` check uses the login shell's `PATH` (`$SHELL -ilc 'printf %s "$PATH"'`, 5 s timeout, fallback `process.env.PATH`), since a GUI app's own `PATH` is minimal. The result shows in a message box.
- `grove skill` reads `<cli dir>/../../resources/skills/grove/SKILL.md` and needs no running app; dev layout only (packaging, child 8).
- `buildMenu` takes a second argument, the install handler.
- Not run by the agent: the menu item, a real macOS Terminal check of `grove focus`/`grove skill`, and the slice 1 follow-up that a terminal session finds `grove` once installed. These stay in the human's manual list below.

### Manual verification for the human (slices 3–5)

- Slice 3: from one grove session, `grove send <other> "reply pong"`, then `grove read <other>` shows the answer.
- Slice 4: `grove new opencode --prompt "count to 5" --wait` returns when the turn ends; `grove wait <ref> --timeout 2` on a working session exits 124.
- Slice 5: **grove → Install Command Line Tool…**, open a new macOS Terminal, `grove focus <ref>` raises the window, `grove skill | head`; inside a terminal session in the app, `grove ls` now works (the `path_helper` issue from slice 1).

## Checks after the last slice

`npm test` (524 passed), `npm run typecheck` and `npm run build` pass. No lint command is configured; no tracker.

## PR description

**Grove CLI: `grove` talks to the running app**

Agents in grove sessions, and the human in any terminal, can now list, start,
message, read, wait on, focus and kill grove sessions.

- **Transport (ADR 0027):** the app listens on `<userData>/grove.sock` (0600), one versioned JSON line per connection; a single-instance lock makes a second launch focus the first.
- **CLI runtime (ADR 0028):** `out/main/cli.js` runs on the app's Electron binary as Node, through a launcher written to `<userData>/bin/grove` at each start. Grove sessions get `GROVE_SESSION_ID`, `GROVE_SOCKET` and that directory on `PATH`.
- **Sessions in any folder (ADR 0029):** `grove new <kind> --cwd --prompt --label --link` registers the containing project, stores `Session.cwd` (state v4) and passes the prompt at launch.
- **Commands:** `ls`, `new`, `send`, `read`, `wait`, `focus`, `kill`, `skill`; `--wait` on `send`/`new`; exit codes 0/1/2/3/4/5/124.
- **Install:** grove → Install Command Line Tool… symlinks `~/.local/bin/grove`. `resources/skills/grove/SKILL.md` is printed by `grove skill`.

Slices: 1 `grove ls` tracer · 2 `grove new` · 3 `send`/`read` · 4 `wait` · 5 `focus`/`kill`/install/skill.

Verify: `npm test`, `npm run typecheck`, `npm run build`; then the manual list above in `npm run dev`.
Rollout: state file v3 → v4 (older builds can't read v4); sessions already running have no `GROVE_*` until resumed.
