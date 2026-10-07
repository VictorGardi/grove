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

## Slice 2 — `grove new` in any folder, with prompt, label and link

Notes for a cold reader: `grove new <opencode|claude|terminal> [--cwd DIR] [--prompt TEXT|-]
[--label L] [--link SLUG] [--json]` calls `sessions.create` (params `{kind, cwd, prompt?, label?, feature?}`),
prints the new session's full id (`--json`: the `CliSession`). `--cwd` defaults to the
caller's cwd, made absolute in the CLI. Session size is 120×40. `--wait`/`--timeout` come in slice 4.
Core error codes → CLI messages (exit 1, `grove: <code>: <message>`): `not-found` (bad cwd: "not a folder"),
`no-feature` ("no such feature in that project"), `no-source`, plus `ambiguous`/`not-found` for refs.
Project choice: the registered project with the longest path containing the folder; none → register the
folder's git top level, or the folder itself outside git. `Session.cwd` is `null` when the folder is the
project path, else the folder. State goes to v4 (`cwd: null` on every existing session). `--link` is
checked against discovered features of the chosen project before anything is created (a project that
would be new has no features, so linking fails). Prompt: OpenCode `--prompt <text>`, Claude
`--name <label>` (only when `--label` given) then the text as the positional argument (after `--` if it
starts with `-`); a terminal session gets it through `sendToSession` once the pane is stable (two equal
captures 300 ms apart, up to 10 s), in the background. Start argv gets these opts; resume never does.

- [x] Write failing test `src/core/cliOps.test.ts`: `resolveSessionRef` (full id; unique prefix ≥ 4; prefix < 4 not matched; ambiguous prefix → `ambiguous`; exact label; two same labels → `ambiguous`; none → `not-found`; id beats label); `resolveProject` (longest containing project wins; a subfolder maps to its project; none → git top level registered with `added: true`; none and not in git → the folder; a sibling path with a shared prefix is not "containing"); `paneStable` (resolves when two captures match; gives up after the timeout) with an injected sleep
- [x] `src/core/cliOps.ts`: `resolveSessionRef(sessions, ref): Result<Session>`, `resolveProject(projects, cwd, gitTop): Promise<{ project: Project; added: boolean }>`, `paneStable(capture, o): Promise<boolean>`
- [x] Write failing test `src/core/store/stateStore.test.ts`: v3 → v4 sets `cwd: null`; update existing version expectations from 3 to 4
- [x] `src/shared/types.ts`: `Session.cwd: string | null`, `StateFile.schemaVersion: 4`; `src/core/store/stateStore.ts`: `v3ToV4`, `readVersioned(…, 4, …, { 1, 2, 3 })`; `src/core/core.ts` saves `schemaVersion: 4`; `src/core/sessions.ts` `newSession` sets `cwd` (option `cwd?`, default null) and `label` option pins the label
- [x] Write failing tests in `src/core/sessions.test.ts`: create argv carries prompt and name per kind (opencode `--prompt`, claude `--name` + positional, claude with a `-`-leading prompt uses `--`); create with `cwd` of a subfolder stores `cwd` and starts the backend there; `cwd` equal to the project path stores null; unknown folder → `not-found`, nothing created; new folder registers a project; `feature` unknown → `no-feature`, nothing created; known feature → linked and pinned; `label` pins; terminal prompt is pasted once the pane is stable; resume starts in the stored cwd
- [x] `src/core/agents/types.ts`: `argv(id, mode, opts?: { prompt?: string; name?: string })`; `src/core/opencode/client.ts`, `src/core/claude/hooks.ts` (`claudeArgv` gains `opts`), `src/core/claude/source.ts`, `src/core/testing/fakeAgentSource.ts` pass them through
- [x] `src/core/core.ts`: `sessionCreate` accepts `{ kind, projectId?, cwd?, prompt?, label?, feature?, cols, rows }` (exactly one of `projectId`/`cwd`; the UI passes `projectId` as today), implements the rules in the notes above; `sessionResume` starts in `session.cwd ?? project.path`
- [x] `src/shared/cli.ts`: `sessions.create` in `CliMethods`; `src/main/cliServer.ts`: `sessions.create` (validates params, calls `sessionCreate` with 120×40, maps errors to `{code, message}`), `cwd` in `CliSession` is `session.cwd ?? project.path`
- [x] Write failing tests `src/cli/args.test.ts` (`new` with flags, `--prompt -`, missing/unknown kind → `UsageError`) and `src/main/cliServer.test.ts` (`sessions.create` creates a session in a subfolder; unknown `feature` replies `no-feature` and creates nothing)
- [x] `src/cli/args.ts`: `Command` gains `{ cmd: 'new'; kind; cwd?; prompt?; label?; link?; json }`; `src/cli/output.ts`: `formatNew`; `src/cli/index.ts`: send `sessions.create` (stdin for `--prompt -`, cwd default `process.cwd()`)
- [x] Run `npm test`
- [x] Run `npm run typecheck`
- [x] Run `npm run build`
- Manual (human, not a checkbox): `grove new claude --cwd ~/git/other --prompt "say hi" --label helper`; the session shows in the sidebar under that folder's project (registered if new) and the prompt runs; `grove new terminal --link no-such-slug` exits 1 and creates nothing; kill, resume from the sidebar, and check it restarts in the same folder.

## Slice 3 — `grove send` and `grove read`

Notes for a cold reader: `grove send <ref> <TEXT|-> [--no-enter]` calls `sessions.send` (params `{ref, text, submit}`),
prints nothing on success (exit 0); `-` reads stdin. `grove read <ref> [--lines N]` (default 100) calls `sessions.read`
(params `{ref, lines}`, data `{text}`) and prints the text with trailing whitespace trimmed. The server resolves `ref`
with `resolveSessionRef` over all sessions (gone ones too); `not-found`/`ambiguous` reply as errors. `send` uses
`core.commands.sendToSession` (a gone agent session is resumed first; errors such as `gone`/`not-ready` are replied as
`{code, message: code}` unless the table in `cliServer.ts` has a message). `read` is `core.commands.sessionRead`,
which captures the last N lines of the session's pane (a missing pane gives empty text). `--wait` comes in slice 4.

- [x] Write failing test `src/cli/args.test.ts`: `send abc "hi"` → `{cmd:'send', ref:'abc', text:'hi', submit:true}`; `send abc - --no-enter` → `submit:false`; `send abc` and `send` → `UsageError`; `read abc` → `lines: 100`; `read abc --lines 40` → 40; `--lines x` and `--lines 0` → `UsageError`
- [x] `src/cli/args.ts`: `Command` gains `send` and `read`; usage text lists them
- [x] Write failing test `src/main/cliServer.test.ts`: `sessions.send` with a ref (id prefix) reaches `t.fake.pastes` with `submit` as given; unknown ref → `not-found`; `sessions.read` returns `t.fake.captured` text for the session's `tmuxName`; missing params → `bad-params`
- [x] `src/core/core.ts`: `Commands.sessionRead({ id, lines })` → `{ text }` (`not-found` for an unknown id) via `backend.capture`
- [x] `src/shared/cli.ts`: `sessions.send` and `sessions.read` in `CliMethods`
- [x] `src/main/cliServer.ts`: `sessions.send`, `sessions.read`, ref resolution, message table gains `gone`, `not-ready`
- [x] `src/cli/output.ts`: `formatRead(text)` (trims trailing whitespace); add its case to `src/cli/output.test.ts`
- [x] `src/cli/index.ts`: send and read requests (stdin for `-`)
- [x] Run `npm test`
- [x] Run `npm run typecheck`
- [x] Run `npm run build`
- Manual (human, not a checkbox): from one grove session, `grove send <other> "reply pong"`, then `grove read <other>` shows the answer.
