---
feature: 2026-10-07-grove-cli
phase: design
status: approved
version: 2
created: 2026-10-07
updated: 2026-10-07
approved_at: 2026-10-07
based_on:
  - 01-questions.md@1
  - 02-research.md@1
forced: []
---

# Grove CLI — design

Designed with `2026-10-07-review-comments`, which builds the shared send path
(`sendToSession`, ADR 0023). On 2026-10-07 the human delegated technical
decisions to the agent and chose: agents may kill any session; no parent is
recorded; `grove send` sends even to the session the human is looking at.

## Desired state

- While the app runs, main listens on a Unix socket; the `grove` command
  talks to it, for agents in grove sessions and the human in any terminal.
- `grove ls` lists sessions. `grove new` starts an OpenCode, Claude or terminal
  session in any folder (registering its project if needed), with an optional
  prompt, label and feature link, in the background.
- `grove send` submits text through review comments' send path; `grove read`
  prints recent screen text; `grove wait` blocks until the turn ends or the
  session needs the human (`send --wait`, `new --wait` combine them).
- `grove focus` shows a session and raises the window; `grove kill` ends one.
- Grove sessions have `grove` on `PATH` plus `GROVE_SESSION_ID`/`GROVE_SOCKET`;
  the human installs `grove` once from the menu. `grove skill` prints a skill.
- App not running → exit 3, "grove: the Grove app is not running".

## Non-goals

- Packaging (child 8), worktrees, workflow features, network APIs, launching
  the app, parent/child records, removing session records.

## System design

### Transport (C1): a Unix socket with versioned JSON lines

- **Socket:** `<userData>/grove.sock`, mode 0600, after `core.start()`; a
  stale file is unlinked first; closed on quit. A single-instance lock makes
  a second launch focus the first and exit.
- **Exchange:** one request per connection: `{"v":1,"id","method","params"}\n`
  → `{"id","ok":true,"data"}` or `{"id","ok":false,"error":{"code","message"}}`.
  `v` ≠ 1 → `bad-version`. `wait` holds its connection until it resolves.
- **Methods** (`src/shared/cli.ts`): `sessions.list|create|send|wait|read|focus|kill`.
- **Session refs:** full id, unique id prefix (≥ 4 chars), or exact label;
  else `not-found` / `ambiguous`.

### Commands and output (C3)

```
grove ls [--all] [--json]                 live sessions (--all: also gone)
grove new <opencode|claude|terminal> [--cwd DIR] [--prompt TEXT|-] [--label L]
          [--link SLUG] [--wait] [--timeout S] [--json]      prints the new id
grove send <ref> <TEXT|-> [--no-enter] [--wait] [--timeout S]
grove wait <ref> [--timeout S]            until not working (default 600 s)
grove read <ref> [--lines N]              pane text, last N lines (default 100)
grove focus <ref>
grove kill <ref>
grove skill                               print the agent skill
```

- **Output:** `ls` prints a table (ID8, KIND, STATUS, LABEL, PROJECT, FEATURE),
  the caller's row marked `*`; others print one line. `--json` prints full
  objects (`{id, kind, label, status, waitingFor, lastStatus, project, cwd, feature}`).
  `-` reads stdin.
- **Exit codes:** 0 ok / turn finished; 1 app error (`grove: <code>: <message>`);
  2 usage; 3 app not running; 4 waiting for the human; 5 gone; 124 timeout.
- **Wait:** returns once the status is not `working`. `--wait` first waits up
  to 30 s for `working` to appear, then for it to end. Terminal sessions have
  no status → `no-status`, exit 1.

### Session creation (C4): any folder, cwd stored, prompt at launch

- **Project:** `--cwd` (default: the caller's cwd) → the registered project
  with the longest containing path; none → register the folder's git top
  level (or the folder outside git).
- **cwd:** `Session.cwd: string | null` (null = project path), persisted in
  state **v4** (`v3ToV4` sets null). Create and resume start there.
- **Prompt:** `AgentSource.argv(id, mode, {prompt, name})`: `opencode -s <id>
  --prompt <text>`; `claude --session-id <id> --settings … --name <label> <text>`.
  Terminal sessions get it via `sendToSession` once the pane is stable.
- **Label/link:** `--label` pins a label; `--link` is checked against
  discovered features before anything is created, then pinned.

### Caller identity and PATH (C5)

- `backend.create({env})` → tmux `new-session -e`: `GROVE_SESSION_ID`,
  `GROVE_SOCKET`, and for terminal sessions `PATH=<userData>/bin:<PATH>`.
  Agent sessions get `export PATH=<bin>:"$PATH"; exec …` in `loginShellArgv`,
  after the rc files.
- **Launcher:** written at every start to `<userData>/bin/grove` (0755):
  `ELECTRON_RUN_AS_NODE=1 exec "<execPath>" "<appPath>/out/main/cli.js" "$@"`,
  `GROVE_SOCKET` defaulted.
- **Install:** **grove → Install Command Line Tool…** symlinks
  `~/.local/bin/grove`, then says whether that directory is on `PATH`.

## Program design

### Call paths

```
CLI:    grove <cmd> → src/cli/index.ts (parseArgs) → net.connect(GROVE_SOCKET) → JSON line
Server: main/cliServer.ts → validate v/method/params → core.commands.* → reply → exit code
create: sessions.create → core.sessionCreate({kind, cwd, prompt, label, feature}) → resolveProject
        → source.argv(id,'start',{prompt,name}) → backend.create({cwd, env}) → set('sessions')
send:   sessions.send → core.sendToSession (review comments) [→ waitTurn]
wait:   sessions.wait → core.waitTurn(id, {expectStart, timeoutMs}) ← sessions slice listener
read:   sessions.read → backend.capture(name, lines)
focus:  sessions.focus → uiSet({focusedSessionId}) + win.restore/show/focus
```

### File tree

```
src/shared/cli.ts                       NEW       PROTOCOL=1, CliRequest/CliReply, CliMethods, CliSession
src/shared/types.ts                     MODIFIED  Session.cwd, StateFile v4
src/cli/index.ts                        NEW       entry: parse → request → print → exit code
src/cli/args.ts (+ .test)               NEW       parseCommand(argv): Command | UsageError
src/cli/output.ts (+ .test)             NEW       table/json/one-line output, exitCode(reply)
src/cli/client.ts (+ .test)             NEW       request(socket, req): Promise<CliReply> (ENOENT/ECONNREFUSED → 3)
src/main/cliServer.ts                   NEW       startCliServer(core, opts): { close() }
src/main/launcher.ts                    NEW       writeLauncher(), installCommandLineTool()
src/main/index.ts                       MODIFIED  single-instance lock, launcher, server, env for core
src/main/menu.ts                        MODIFIED  Install Command Line Tool…
src/core/cliOps.ts (+ .test)            NEW       resolveSessionRef, resolveProject, waitTurn
src/core/core.ts                        MODIFIED  sessionCreate opts, cwd on resume, waitTurn, sessionRead
src/core/sessions.ts                    MODIFIED  newSession cwd/label
src/core/store/stateStore.ts (+ .test)  MODIFIED  v3ToV4
src/core/env.ts (+ .test)               MODIFIED  loginShellArgv(argv, {pathPrefix})
src/core/backend/types.ts, tmux.ts      MODIFIED  create({env})
src/core/agents/types.ts                MODIFIED  argv(id, mode, opts?)
src/core/opencode/client.ts, claude/hooks.ts, claude/source.ts  MODIFIED  --prompt / --name + prompt
electron.vite.config.ts                 MODIFIED  main input { index, cli }
resources/skills/grove/SKILL.md         NEW       agent skill, printed by `grove skill`
```

### Key signatures

```ts
// shared/cli.ts
interface CliRequest { v: 1; id: string; method: keyof CliMethods; params: unknown }
type CliReply = { id: string; ok: true; data: unknown } | { id: string; ok: false; error: { code: string; message: string } }
// core
sessionCreate(a: { kind: SessionKind; projectId?: string; cwd?: string; prompt?: string; label?: string;
  feature?: string; cols: number; rows: number; caller?: string }): Promise<Result<Session>>
resolveSessionRef(sessions: Session[], ref: string): Result<Session>          // id, prefix ≥ 4, exact label
resolveProject(projects: Project[], cwd: string, gitTop: (d: string) => Promise<string | null>):
  Promise<{ project: Project; added: boolean }>
waitTurn(id: string, o: { expectStart: boolean; timeoutMs: number }):
  Promise<Result<{ status: 'idle' | 'waiting' | 'gone'; waitingFor: Session['waitingFor'] | null }>>
sessionRead(a: { id: string; lines: number }): Promise<Result<{ text: string }>>
// main
startCliServer(core: Core, o: { socketPath: string; raise(): void }): { close(): void }
writeLauncher(o: { binDir: string; execPath: string; cliPath: string; socketPath: string }): string
```

Tests: args, output, client (temp socket), cliOps (fake source and timers),
v3ToV4, `loginShellArgv`; server dispatch with `setupCore()`; end to end by
hand in `npm run dev`.

## One-way decisions

**C1. A Unix socket in userData speaking versioned JSON lines, with a single-instance lock**
([ADR 0027](../../adr/0027-grove-cli-over-unix-socket.md)).
- Rejected: HTTP on localhost (any local process, a token, a port file);
  WebSocket like xirp (a dependency for one-shot requests).

**C2. The CLI is a JS bundle run by the app's own Electron binary as Node, through an app-written launcher**
([ADR 0028](../../adr/0028-cli-runs-on-electron-as-node.md)).
- Rejected: a system `node` (may be missing or wrong); a compiled binary
  (new toolchain, ~50 MB).

**C3. Command surface, `--json` and exit codes as above** (ADR 0027): a
contract for skills and scripts.
- Rejected: JSON-only like herdr (unfriendly to humans); xirp's wide surface.

**C4. Sessions start in any folder: the containing project, a persisted `cwd`
(state v4), and the prompt passed at launch**
([ADR 0029](../../adr/0029-session-cwd-and-launch-prompt.md)).
- Rejected: every folder its own project (clutter); paste the first prompt
  after start (racy, needs a readiness wait).

**C5. Identity through `GROVE_SESSION_ID`/`GROVE_SOCKET` set with tmux `-e`, and PATH prefixed after the rc files** (part of ADR 0027).
- Rejected: PATH by `-e` alone (rc files may reset it); no identity vars.

## Two-way decisions

| Decision | Choice |
|---|---|
| Kill | Any caller, any session (human's choice); no `remove` |
| Parent | Not recorded (human's choice) |
| Send to the focused session | Sent anyway (human's choice) |
| Socket path | `<userData>/grove.sock` (about 60 bytes, under the 104-byte limit) |
| New session size | 120×40, as in the app's modal; attaching resizes it |
| Notifications | None for CLI-started sessions; they show in the sidebar |
| Argument parsing | `node:util` `parseArgs`, no dependency |
| CLI build | Second input in electron-vite's main build → `out/main/cli.js` |
| Skill | `resources/skills/grove/SKILL.md`; `grove skill` prints it; the human installs it |
| Install target | `~/.local/bin/grove` symlink; nothing is written to system or Homebrew directories |

## Risks

- **Depends on review comments** slice 1 for `send`/`read`; build it first.
- **PATH reset:** a shell rc file that overwrites `PATH` hides `grove` in
  terminal sessions. Agent sessions are safe, because the prefix runs after rc.
- **Dev-only paths:** the launcher points at dev Electron and `out/` until
  child 8; rewritten at each start.
- **Unbounded control:** any same-user process can drive sessions (as via tmux).
- **Wait relies on status:** a disconnected agent source has no status, so
  `wait` waits until the timeout.

## Open questions
