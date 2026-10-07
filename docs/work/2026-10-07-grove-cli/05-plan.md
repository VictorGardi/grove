---
feature: 2026-10-07-grove-cli
phase: plan
status: approved
version: 1
created: 2026-10-07
updated: 2026-10-07
approved_at: 2026-10-07
based_on:
  - 03-design.md@2
  - 04-structure.md@1
forced: []
---

# Grove CLI — plan

Self-approved per slice by grove-implement: mechanical checks passed, not human-reviewed.

## Slice 1 — `grove ls` from a grove session (tracer)

Notes for a cold reader: the socket is `<userData>/grove.sock`; protocol is one
JSON line per connection (`{"v":1,"id","method","params"}` → `{"id","ok":true,"data"}`
or `{"id","ok":false,"error":{"code","message"}}`). Exit codes: 0 ok, 1 app error,
2 usage, 3 app not running. Only `sessions.list` is served in this slice; other
methods answer `bad-method`. `grove ls` lists sessions with `lastStatus === 'running'`
(`--all`: also gone). The caller's row (full id equals `GROVE_SESSION_ID`) is marked `*`.
Session `cwd` does not exist until slice 2, so `CliSession.cwd` is the project path for now.

- [x] Write failing test `src/core/env.test.ts` "PATH prefix runs after rc": `loginShellArgv(['x'], { shell: '/bin/zsh', pathPrefix: '/b' })[4]` is `export PATH=/b:"$PATH"; exec x`; update the two existing `loginShellArgv` tests to the `{ shell }` options form
- [x] `src/core/env.ts`: `loginShellArgv(argv, o: { shell?: string; pathPrefix?: string } = {})`
- [x] Write failing test `src/core/cliEnv.test.ts`: with `make(NOW, { sessionEnv: { socketPath: '/s.sock', binDir: '/bin' } })`, creating a terminal session passes `env` with `GROVE_SESSION_ID` = the session id, `GROVE_SOCKET` = `/s.sock` and `PATH` starting `/bin:`; an opencode session passes the two `GROVE_*` vars, no `PATH`, and its argv shell command starts `export PATH=/bin:"$PATH"; exec`; without `sessionEnv`, `env` is undefined
- [x] `src/core/backend/types.ts`, `tmux.ts`, `testing/fakeBackend.ts`: `create` takes `env?: Record<string, string>`; tmux adds `-e K=V` per entry before `--`
- [x] `src/core/core.ts`: `CoreOptions.sessionEnv?: { socketPath: string; binDir: string }`; helper builds the env for a session; `sessionCreate` and `sessionResume` pass `env` and `pathPrefix`
- [x] `src/shared/cli.ts`: `PROTOCOL = 1`, `CliRequest`, `CliReply`, `CliSession`
- [x] Write failing test `src/cli/args.test.ts`: `parseCommand(['ls'])`, `['ls','--all','--json']`, no args / unknown command / unknown flag → `UsageError`
- [x] `src/cli/args.ts`: `parseCommand(argv)` with `node:util` `parseArgs`; `Command = { cmd: 'ls'; all: boolean; json: boolean }`; `UsageError` with usage text
- [x] Write failing test `src/cli/output.test.ts`: table header and rows with `*` on the caller; empty list prints nothing but the header; `--json` prints the array; `exitCode` maps `ok` → 0, `not-running` → 3, other errors → 1; `formatError` for `not-running` is `grove: the Grove app is not running`, else `grove: <code>: <message>`
- [x] `src/cli/output.ts`: `formatLs`, `exitCode`, `formatError`
- [x] Write failing test `src/cli/client.test.ts`: against a temp unix socket server a request round-trips; a missing socket path resolves `{ ok: false, error: { code: 'not-running' } }`
- [x] `src/cli/client.ts`: `request(socketPath, req): Promise<CliReply>`
- [x] `src/cli/index.ts`: read `GROVE_SOCKET` (missing → usage-style error exit 2, `grove: GROVE_SOCKET is not set`), `parseCommand`, request `sessions.list`, print, `process.exit(exitCode)`
- [x] Write failing test `src/main/cliServer.test.ts` (uses `setupCore()` and a temp socket): `sessions.list` returns the core's sessions as `CliSession` with the project name; `all` flag includes gone; `v: 2` → `bad-version`; unknown method → `bad-method`; socket file mode is 0600; `close()` removes the file
- [x] `src/main/cliServer.ts`: `startCliServer(core, { socketPath, raise }): Promise<{ close(): void }>`
- [x] `src/main/launcher.ts`: `writeLauncher({ binDir, execPath, cliPath, socketPath })` writes `<binDir>/grove` mode 0755 and returns its path
- [x] `src/main/index.ts`: `app.requestSingleInstanceLock()` (no lock → `app.quit()` and skip startup), `second-instance` → raise the window; compute `socketPath`/`binDir`, `writeLauncher`, pass `sessionEnv` to `createCore`, `startCliServer` after `core.start()`, close it in `before-quit`
- [x] `electron.vite.config.ts`: main build `rollupOptions.input = { index: 'src/main/index.ts', cli: 'src/cli/index.ts' }`
- [x] `tsconfig.node.json`: include `src/cli/**/*`
- [x] Run `npm test`
- [x] Run `npm run typecheck`
- [x] Run `npm run build` and check `out/main/cli.js` exists
- Manual (human, not a checkbox so resume doesn't reopen the slice): in `npm run dev`, open a terminal session and run `grove ls`; quit the app and run `grove ls` (exit 3); launch the app twice (the first window focuses)
