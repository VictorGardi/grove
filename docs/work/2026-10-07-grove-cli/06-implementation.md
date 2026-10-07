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
