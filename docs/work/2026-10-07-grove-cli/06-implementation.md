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
- **Open, needs a design decision (not fixed):** on this macOS, `/etc/zprofile`'s `path_helper` rebuilds `PATH` from scratch in login shells, so the tmux `-e PATH=<bin>:…` for **terminal** sessions is overwritten and `grove` is not found there. Agent sessions are unaffected (prefix runs after rc). Design C5 chose `-e` for terminal sessions; see the options put to the human.
