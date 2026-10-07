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
