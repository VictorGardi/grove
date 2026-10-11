---
feature: 2026-10-08-agent-sandboxing
phase: research
status: draft
approved_at: 2026-10-10
version: 6
created: 2026-10-08
updated: 2026-10-11
based_on: ["01-questions.md@1"]
repo_heads: ["09cbcdccd6880a4635c5f0f77aa3acf640c7cfb6"]
---

# Agent session sandboxing — research

Answers `01-questions.md` § "Research questions" (11 items; the source
numbering has two Q4s, answered as 4a and 4b). Facts as of `repo_heads`,
each cited.

## Summary

Grove launches every session through one pipeline: `AgentSource.argv()` → `loginShellArgv()`
→ `TmuxBackend.create()` → `tmux new-session -- argv` (`src/core/core.ts:634-637`,
`src/core/env.ts:42-46`, `src/core/backend/tmux.ts:43-50`). tmux, the attach clients and all
of core run on the host; only the pane's leaf command is the agent. The pane's environment
carries exactly two injected variables (`GROVE_SESSION_ID`, `GROVE_SOCKET`); the Claude
hook-spool path reaches the pane as text inside the launch argv, not as an env var. The
`grove` CLI speaks JSON over `<userData>/grove.sock`. Host-side subsystems (diff, discovery,
autolink, spool tailing) resolve paths from `project.path` or the pane's reported cwd, so a
session's directory must remain a real host-visible path. Every session-creation path
converges on the single `sessionCreate` command.

## Answers

### 1. How a session's argv is constructed

- Each agent kind builds its argv behind `AgentSource.argv(id, mode, opts)`
  (`src/core/agents/types.ts:38`):
  - OpenCode: `['opencode', '-s', id, ...(--prompt)]`; resume uses the same form
    (`src/core/opencode/client.ts:52-54`).
  - Claude: `claudeArgv()` → `['claude', --session-id | --resume, '--settings', <hooks
    JSON>, ...(--name), prompt]` (`src/core/claude/source.ts:26-28`,
    `src/core/claude/hooks.ts:51-55`).
- `loginShellArgv(argv, opts)` wraps it in the user's login shell: `[shell, '-l', '-i',
  '-c', 'export PATH=<binDir>:"$PATH"; exec <argv>']` (`src/core/env.ts:42-46`), one quoting
  helper for all args (`src/core/env.ts:36-38`); `pathPrefix` runs after the rc files so
  they cannot hide it (`src/core/env.ts:44`).
- Core calls it at creation (`src/core/core.ts:634-637`) and resume
  (`src/core/core.ts:684-685`), passing the result straight to
  `backend.create({ ..., argv, env: cliEnv(session) })`. The pane therefore
  always executes `$SHELL -l -i -c 'exec <command>'` — a single `exec` leaf.
- Terminal sessions pass no argv (`argv` is `undefined`, `src/core/core.ts:636`);
  tmux falls back to its default login shell (`src/core/backend/tmux.ts:48`), and a first
  prompt is typed in via the send path once the pane is stable
  (`src/core/core.ts:645-650`).

### 2. What `cliEnv(session)` injects, and what must stay reachable

- `cliEnv` returns exactly (`src/core/core.ts:166-174`): `GROVE_SESSION_ID`
  = the app's session id (:170), `GROVE_SOCKET` = `<userData>/grove.sock`
  (:171, built at `src/main/index.ts:58`), `PATH` = `<binDir>:<minimal
  PATH>` — **terminal sessions only** (:172) — or `undefined` when core
  was built without `sessionEnv` (:167-168).
- Agent sessions get their `PATH` (with the `grove` launcher dir prefixed) through
  `loginShellArgv`'s `pathPrefix` instead (`src/core/core.ts:175`, `src/core/env.ts:44`).
  Tests pin both shapes: terminal env includes PATH, agent env is `{GROVE_SESSION_ID,
  GROVE_SOCKET}` and argv starts with `export PATH=…; exec`
  (`src/core/cliEnv.test.ts:15-33`).
- Facts about what a pane must be able to reach for existing features:
  - **`GROVE_SOCKET`**: without it the `grove` CLI exits with a usage error
    (`src/cli/index.ts:59-63`); it is the socket core listens on while the app runs (ADR
    0027).
  - **`GROVE_SESSION_ID`**: the CLI's identity — `grove ls` highlights the calling session
    with it (`src/cli/index.ts:23`); ADR 0027 records both variables injected via `tmux
    new-session -e`.
  - **`PATH` including `binDir`**: that dir holds the `grove` executable
    (`src/main/index.ts:60`, ADR 0027).
  - **Claude hook-spool path**: *not* an env var — text inside the `--settings` JSON
    argument (`src/core/claude/hooks.ts:41,47`), written from inside the pane (see 3).
  - **OpenCode's shared service**: the TUI joins the shared service whose URL and password
    live in `~/.local/state/opencode/service.json` (`src/core/opencode/client.ts:8-10`, ADR
    0005:14-16) — a loopback HTTP port plus a file under the user's home.

### 3. (source item 3) How the hook-spool mechanism works for Claude sessions

- **Writer — shell commands running inside the pane.** Every Claude launch carries
  `--settings <JSON>` (`src/core/claude/hooks.ts:54`) whose `hooks` block maps each event
  (SessionStart, PermissionRequest, Pre/PostToolUse, Stop, …) to an inline shell command:
  `x=$(cat); printf '{"t":…,"e":%s}\n' … >> <spool>` (`src/core/claude/hooks.ts:39-48`);
  `PostToolBatch` appends a marker line instead (`src/core/claude/hooks.ts:42`). The
  `statusLine` command appends a slim `StatusLine` record via `jq`, then runs the user's own
  statusline (`src/core/claude/hooks.ts:27-37`). Claude executes these as hook subprocesses
  in the pane; the spool path is fixed at launch as literal text inside the settings
  argument.
- **File**: `<dir>/<id>.jsonl`, where `dir` is `<userData>/agents/claude`
  (`src/main/index.ts:76`) and `id` is the app-minted session UUID (`src/core/claude/source.ts:22-24,65-67`).
- **Reader — host-side.** `SpoolClaude` owns a `SpoolTail` over that dir
  (`src/core/claude/source.ts:18-19`), started with the source (`src/core/claude/source.ts:30-33`):
  `fs.watch` with a 1 s poll fallback (`src/core/claude/spool.ts:74-90`), byte-offset tail per
  file (`src/core/claude/spool.ts:114-135`), newline-agnostic record scanning
  (`src/core/claude/spool.ts:36-59`), folded into status/event updates
  (`src/core/claude/source.ts:69-77`). Core replays records on re-sync and app start
  (`src/core/core.ts:522-550`); `forget()` deletes the file when a session is removed
  (`src/core/claude/source.ts:51-59`).

### 4. (source item 4a) How the Grove CLI communicates with a running session

- Socket: `<userData>/grove.sock` (`src/main/index.ts:58`), handed to sessions as
  `GROVE_SOCKET` (`src/core/core.ts:171`); the CLI refuses to run without it
  (`src/cli/index.ts:59-63`); mode 0600, same user trust as the tmux socket (ADR
  0027:20-37).
- Protocol: one JSON request per connection `{v, id, method, params}` → `{id, ok, data}` /
  `{id, ok:false, error}` — `call()` (`src/cli/index.ts:9-10`) against `PROTOCOL`
  (`src/shared/cli.ts`), served by `startCliServer` (`src/main/cliServer.ts`, started
  `src/main/index.ts:81`); methods include `sessions.create/list/send`
  (`src/main/cliServer.ts:77-82`, `src/shared/cli.ts:8`). ADR 0027 fixes `{v:1,…}` and the
  exit-code contract.
- Session identity: `GROVE_SESSION_ID` in the caller's env (`src/core/core.ts:170`), read by
  the CLI for `ls` output (`src/cli/index.ts:23`); no other identity mechanism exists.

### 4b. The `Session` schema and how migrations work

- `Session` is the interface at `src/shared/types.ts:5-30`: persisted fields `id`,
  `projectId`, `kind`, `label`, `labelPinned`, `tmuxName` (always `grove-<id>`), `cwd:
  string | null`, `agentSessionId`, `feature`, `linkPinned`, `action`, `startedAt`,
  `endedAt`, `lastStatus`, `seenAt`, `lastContext`; live-only fields are commented "never
  saved" (`src/shared/types.ts:22-28`).
- Persistence: on every `sessions`/`ui` change, core strips the live-only fields and writes
  `{schemaVersion: 7, sessions, ui}` (`src/core/core.ts:188-191`,
  `src/shared/types.ts:127`).
- Migrations: a sequential chain `{1: v1ToV2, …, 6: v6ToV7}` passed to `readVersioned(file,
  7, …)` (`src/core/store/stateStore.ts:36-37`); each step is a small pure function, e.g.
  `v3ToV4` adds `cwd: null` to every session — the ADR 0029 migration
  (`src/core/store/stateStore.ts:21`). A file newer than the code's version is moved aside
  rather than read (ADR 0029:33).

### 5. What `TmuxBackend.create()` actually runs

`src/core/backend/tmux.ts:43-50` executes:

```
tmux -L <socket> -f <conf> new-session -d -s <name> -c <cwd>
     -x <cols> -y <rows> [-e K=V]... -- <argv>...
```

- `-L grove` is the dedicated socket (`src/core/backend/tmux.ts:29-32`, ADR 0003:20-24);
  `-f` is the app-shipped config, also `source-file`d onto a running server
  (`src/core/backend/tmux.ts:34-41`).
- Each `env` entry becomes its own `-e K=V` flag (`src/core/backend/tmux.ts:47`) — this is
  how `GROVE_SESSION_ID`/ `GROVE_SOCKET` reach the pane (ADR 0027:29-30).
- Everything after `--` is the pane's command (`src/core/backend/tmux.ts:48`): for agent
  sessions that is the login-shell wrapper from Q1 (`$SHELL -l -i -c 'exec …'`), for
  terminals tmux's own default shell.
- `-c <cwd>` sets the pane's starting directory before the command runs.
- tmux runs it under its server process; config details (`mouse on`, `status off`,
  `history-limit 50000`, `allow-passthrough on`, `remain-on-exit failed`) are ADR
  0003:21-24.

### 6. Session-creation entry points and where a per-session option would land

Three live paths, one funnel:

1. **UI (⌘T palette)**: `newSessionItems()` builds one item per project × kind
   (`src/renderer/src/paletteItems.ts:46-55`); picking one calls `session:create` with
   **only** `{projectId, kind, cols, rows}` (`src/renderer/src/App.tsx:110-111`, typed at
   `src/shared/ipc.ts:14`), handled at `src/main/ipc.ts:40`. ⌘J does the same for terminals
   (`src/renderer/src/App.tsx:78`).
2. **CLI (`grove new`)**: flags `--cwd --prompt --label --link --wait --timeout --json`
   (`src/cli/args.ts:18,54-63`), sent as `sessions.create` (`src/cli/index.ts:41-44`) and
   unpacked by the socket server (`src/main/cliServer.ts:77-82`).
3. **Workflow next-actions**: the workflow schema parses `actions` (with `label`, `prompt`,
   `cwd` templates) and `stage_actions` (`src/core/workflow/parse.ts:117-135`), but no code
   path consumes them to start a session — `Session.action` is typed and commented "always
   null" (`src/shared/types.ts:16`), and the feature page renders no action button
   (`src/renderer/src/components/FeaturePage.tsx:24-103`).

All three converge on `sessionCreate({projectId?, cwd?, kind, prompt?, label?, feature?,
cols, rows})` (`src/core/core.ts:68-70,612`); a new per-session option would cross the same
three type boundaries: `src/shared/ipc.ts:14` (UI), `src/shared/cli.ts` + `src/cli/args.ts`
(CLI), and the `sessionCreate` signature (`src/core/core.ts:68-70`).

### 7. How a session's working directory is determined

- `Session.cwd: string | null` — `null` means the project's path (`src/shared/types.ts:12`,
  ADR 0029:22-24).
- **Create**: with a `cwd` argument (CLI), core checks it is a directory
  (`src/core/core.ts:619`), resolves its project (`resolveProject`,
  `src/core/cliOps.ts:41`), and stores `fs.realpathSync(cwd)` unless it *is* the project
  path (then `null`); without `cwd` (UI), `dir` stays `null` (`src/core/core.ts:617-623`).
- **Backend/resume**: `backend.create` receives `cwd: dir ?? project.path`
  (`src/core/core.ts:637`) — tmux's `-c` (`src/core/backend/tmux.ts:45`); resume passes
  `session.cwd ?? project.path` (`src/core/core.ts:685`).
- **Read back**: `backend.cwds()` maps tmux name → `#{pane_current_path}`
  (`src/core/backend/tmux.ts:68-76`); core uses it for the branch field
  (`src/core/sessions.ts:42-53`) and as the diff's directory while running
  (`src/core/core.ts:409`).
- **Not** derived from `Session.cwd`: discovery watches `resolveRoot(project.path, …)`
  (`src/core/core.ts:253`) and autolink resolves writes against `project.path`
  (`src/core/core.ts:336`) — both key off the project, not the session (same as the worktree
  research, `../2026-10-08-worktree-support/02-research.md:61-97`).

### 8. Teardown/cleanup when a session ends

- `sessionKill`: `backend.kill(tmuxName)` then marks the session gone
  (`src/core/core.ts:654-661`); `sessionRemove` does the same, drops the session from state
  and calls `forgetAgents` (`src/core/core.ts:664-671`).
- `backend.kill` is **only** `tmux kill-session -t =<name>` (missing session = success,
  `src/core/backend/tmux.ts:78-86`) — no other cleanup hook exists in the backend.
- `forgetAgents` (`src/core/core.ts:584-587`) calls each source's `forget()`: Claude deletes
  its spool file (`src/core/claude/source.ts:51-59`); OpenCode's is a no-op
  (`src/core/opencode/client.ts:56`).
- Liveness is polled every 5 s (`src/core/core.ts:374-385,850-853`); `remain-on-exit failed`
  + `pane_dead` distinguishes a dead pane from a live session
  (`src/core/backend/tmux.ts:57-65`, ADR 0003:24).
- Killing the tmux session terminates the pane's process tree; nothing removes directories,
  containers or other external resources on teardown.

### 9. How diff/discovery/autolink resolve paths, and container-cwd effects

- **Diff**: `runDiff` picks *pane cwd while running*, else `project.path`
  (`src/core/core.ts:409`); `computeDiff` runs host-side `git rev-parse --show-toplevel`
  against that directory (`src/core/diff/compute.ts:20,29`). Two sub-resolutions key off
  `project.path`: `projectScope` (`src/core/diff/compute.ts:63-66`) and `setRendered`'s
  `path.relative(project.path, …)` (`src/core/diff/compute.ts:74-78`).
- **Discovery**: watchers/folder reads build from `resolveRoot(project.path, …)` per project
  (`src/core/core.ts:241-272`); sessions never contribute a path. **Autolink**: write paths
  are matched by `slugFor(paths, project.path, …)` (`src/core/core.ts:336`,
  `src/core/autolink.ts:22-32`).
- **All run host-side in Electron main.** tmux is a host process (ADR 0003), so
  `pane_current_path` is the `-c` argument core gave it — a host path
  (`src/core/core.ts:637`, `src/core/backend/tmux.ts:45,68-76`). Write-event paths come from
  inside the pane (OpenCode HTTP events `src/core/opencode/client.ts:100-113`; Claude spool
  records `src/core/claude/spool.ts:36-59`).
- **If a session's cwd were a bind-mounted path inside a container:**
  - Same-path mount (host == container path): nothing changes for host-side resolution —
    git, discovery, autolink and the viewer all see one path.
  - Container-only path (host `-c` pointing nowhere, or a container-internal reported cwd):
    host-side `git` fails → `computeDiff` returns `error`/`not-git`
    (`src/core/diff/compute.ts:20-34`) and `readBranch` returns `null`
    (`src/core/git.ts:6-22`).
  - Discovery/autolink ignore the pane cwd (keyed on `project.path`), but write-event paths
    are whatever the agent saw inside the pane — container-only paths would not resolve
    under `project.path` in `slugFor` (`src/core/autolink.ts:22-32`).

### 10. State of the worktree-support feature and intersections

- `../2026-10-08-worktree-support/02-research.md` is `status: approved, version: 1`; its
  folder holds only ticket/questions/research — no design/structure/plan artifacts, so
  implementation has not started.
- Established there: `Session.cwd` is already an independent field the session/diff/branch
  layers honor (`02-research.md:27-34`); **no git-worktree mechanics exist anywhere** in the
  codebase (`02-research.md:49-59`); discovery, the diff viewer's rendered paths and
  autolink resolve against `project.path` and would miss a sibling worktree
  (`02-research.md:61-97`); no GUI affordance for a custom cwd (`02-research.md:85-90`);
  `Project` is strictly one path ↔ one id (`02-research.md:92-97`).
- Mechanical intersections: both change what `sessionCreate` passes as `cwd`/the backend's
  `-c` (`src/core/core.ts:637`) — the sandbox's bind-mount source and a worktree's checkout
  directory are the *same* value; both depend on the same host-visible-path invariant (Q9);
  the two fields are independent and neither feature's artifacts reference the other.

## Current architecture

```mermaid
flowchart LR
  UI["Renderer ⌘T palette<br/>(projectId + kind only)"] -->|"IPC session:create"| CORE
  CL["grove new<br/>(--cwd --prompt …)"] -->|"JSON over grove.sock"| CORE["core.commands.sessionCreate<br/>core.ts:612"]
  CORE --> ARGV["AgentSource.argv()<br/>opencode | claude"]
  ARGV --> LOGIN["loginShellArgv()<br/>$SHELL -l -i -c 'exec …'"]
  CORE --> BE["backend.create(cwd, env)<br/>tmux.ts:43"]
  LOGIN --> BE
  BE --> TMUX["tmux -L grove server (host)"]
  TMUX --> PANE["pane: login shell → agent TUI"]
  ENV["cliEnv: GROVE_SESSION_ID,<br/>GROVE_SOCKET (-e flags)"] --> BE

  subgraph host["Host-side (Electron main)"]
    DIFF["diff compute<br/>git on pane cwd / project.path"]
    DISC["discovery watchers<br/>project.path"]
    LINK["autolink<br/>slugFor(paths, project.path)"]
    TAIL["SpoolTail (fs.watch + 1s poll)"]
    SRV["cliServer (grove.sock)"]
  end

  TMUX -->|"pane_current_path"| DIFF
  PANE -->|"Claude hooks append"| SPOOL[("agents/claude/&lt;id&gt;.jsonl")]
  SPOOL --> TAIL
  PANE -->|"grove CLI"| SRV
  SRV --> CORE
  PANE -->|"opencode TUI → shared service HTTP"| SVC["service.json<br/>loopback port"]
```

## Existing patterns to reuse

- **Argv-wrapping seam**: `loginShellArgv()` is the one place the executed command is
  assembled before `backend.create` (`src/core/env.ts:42-46`, `src/core/core.ts:634-637`); a
  per-session wrapper composes there the same way `pathPrefix` does.
- **Per-session env injection**: `cliEnv` + tmux `-e` (`src/core/core.ts:166-174`,
  `src/core/backend/tmux.ts:47`) is the established channel for pane-visible variables.
- **Per-launch config as an argv argument**: Claude receives generated settings JSON via
  `--settings` (`src/core/claude/hooks.ts:54`) — precedent for structured launch config
  without env.
- **Schema migration chain**: sequential v1→v7 functions with `readVersioned`
  (`src/core/store/stateStore.ts:36-37`); `cwd`'s v3→v4 is the direct template for a
  persisted per-session boolean (`src/core/store/stateStore.ts:21`, ADR 0029).
- **Command funnel**: every entry point converges on `sessionCreate`
  (`src/core/core.ts:612`), so one parameter reaches UI and CLI alike.
- **Testing seam**: `setupCore` injects a fake backend recording `create` calls
  (`src/core/sessionCreate.test.ts:9-10`, `src/core/testing/fakeBackend.ts`) plus fake agent
  sources — argv/env assertions run without tmux or a real agent.

## Constraints & invariants

- tmux, attach clients and node-pty are host processes; the pane command is the only
  per-session executable leaf (ADR 0003, `src/core/backend/tmux.ts:29-32,110-131`).
- `GROVE_SOCKET` + `GROVE_SESSION_ID` must be set in every session whose pane runs `grove`;
  the CLI hard-fails without the socket (`src/cli/index.ts:59-63`).
- The Claude spool path is baked into the launch argv as literal text
  (`src/core/claude/hooks.ts:41,47,54`), appended from inside the pane and tailed host-side
  (`src/core/claude/spool.ts:74-90`) — the same path must resolve to the same file on both
  sides.
- OpenCode sessions reach a **shared** host service over loopback HTTP with credentials from
  `service.json` under the user's home (`src/core/opencode/client.ts:8-10,152`, ADR
  0005:14-16).
- Host-side git, discovery, autolink and the viewer require the session's directory to be a
  real host path (`src/core/core.ts:253,336,409`, `src/core/diff/compute.ts:29`).
- `sessionCreate` rejects a `cwd` that isn't an existing directory and stores its realpath
  (`src/core/core.ts:619-623`); resume reuses the stored cwd and tmux name
  (`src/core/core.ts:683-685`).
- Every launch re-reads the user's login-shell environment; sessions pay shell startup each
  start (ADR 0010:24-32).
- State-file migrations are strictly ordered; a newer file version is moved aside, not read
  (ADR 0029:33, `src/core/store/stateStore.ts:37`).
- `backend.kill` performs only `tmux kill-session` (`src/core/backend/tmux.ts:78-86`);
  nothing else runs on teardown.

## Test landscape

- Run: `npm run test` (vitest run) and `npm run typecheck` (`package.json:13,8`).
- Covering this area: `sessionCreate.test.ts` (argv composition, cwd, resume, prompt),
  `cliEnv.test.ts` (exact `GROVE_*` env per kind, the `export PATH=…; exec` prefix),
  `env.test.ts` (`loginShellArgv` quoting), `backend/tmux.test.ts` (exact `tmux` argv from
  `create()`), `claude/hooks.test.ts` / `spool.test.ts` / `source.test.ts` (settings JSON,
  spool parsing/tailing, event folding), `sessions.test.ts` (create/resume/reconcile),
  `src/main/cliServer.test.ts` (`sessions.create` over the socket), and
  `src/core/claude/fixtures/*.jsonl` (real hook payloads).

## Relevant ADRs

- **ADR 0003** — tmux on a dedicated socket; the `SessionBackend` adapter and what
  create/kill is.
- **ADR 0010** — login-shell env; the `loginShellArgv` wrapper.
- **ADR 0016** — hook-spool files; the write/tail split and the
  `<userData>/agents/claude/<id>.jsonl` path.
- **ADR 0005** — shared OpenCode service; the TUI's loopback HTTP and `service.json`.
- **ADR 0021** — session diff from git CLI; host-side git on the session's directory.
- **ADR 0027** — `grove` CLI over the Unix socket; protocol, identity env, `new-session -e`.
- **ADR 0029** — `Session.cwd`; the v3→v4 migration precedent.
- **ADR 0017** — agent-neutral session id; the first state migration.

## Unknowns

- tmux's behavior when `-c` points at a host directory that doesn't exist (expected to fail
  `new-session`; not verified here).
- What `pane_current_path` reports when the pane command is an external container launcher —
  reasoned from the code (the wrapper is a host process), not observed.
- OpenCode/Claude behavior *inside* a containerized filesystem view (paths, git config,
  credential files) — no such run exists in this repo's tests or fixtures.
- Third-party mechanism capabilities (startup latency, network policy surface, mount
  semantics of any specific tool) are outside this codebase and were not verified in this
  pass.

## Spikes

### OpenCode's shared service, outside a container (2026-10-10)

**Question.** Two of D6's claims were reasoned, not observed: that a second
service evicts the incumbent registered in `service.json`, and that the service
is unreachable from a container. The first is pure OpenCode behaviour and needs
no container runtime; this spike settles it.

**Method.** `opencode serve --service` (2.0.20) run under a scratch
`XDG_STATE_HOME` and `XDG_CONFIG_HOME`, with the port pinned in
`<scratch>/config/opencode/service.json` so the live service was never contended.
The real `~/.local/state/opencode/service.json` mtime was unchanged
(`Oct 8 20:47:52`) and live pid 1075 was alive before and after.

**Answer — all four confirmed, one of them the opposite of expected.**

- `XDG_STATE_HOME` **is** honoured: the registration went to the scratch path
  and the real file was never written. This is what made the spike safe.
- The service binds `127.0.0.1` only: `TCP 127.0.0.1:49559 (LISTEN)`. A
  container's `127.0.0.1` is its own, so the default is unreachable from inside.
- The bind address **is configurable**: `{"port":N,"hostname":"0.0.0.0"}` in
  `<XDG_CONFIG_HOME>/opencode/service.json` gave
  `server listening on http://0.0.0.0:49558`, socket `*:49558`, and a
  registration of `url=http://0.0.0.0:49558`. The port is configurable the same
  way, and the service writes a generated `password` back into that config file.
- **A second registration evicts the incumbent.** A (pid 2677, port 49561) and
  B (pid 2703, port 49562) shared one `XDG_STATE_HOME`. Within 3 s A was dead
  with no listening socket, and the registration read
  `pid=2703 id=567b034c url=http://127.0.0.1:49562`. A's log held no shutdown
  line — a silent takeover.

**Evidence.** Registration fields are `{id, version, url, pid, password}`,
163 bytes, mode 0600. Config written by the spike, after the service started:
`{"port": 49557, "password": "…"}` — the service adds its own password there.
A's log: `server listening on http://127.0.0.1:49561` and nothing more.

**Recommendation.** D6's reasoning was right and is now measured: a sandboxed
OpenCode that starts its own service would evict the host's, taking status,
waiting, notifications and write-driven linking down for every OpenCode session
on the host. Two things this changes for the design:

- The eviction risk is **configurable away** rather than inherent. A host
  service bound to a routable address, plus a container pointed at it, removes
  the whole failure mode — no second service, no eviction. That is the path to
  OpenCode support later, and it needs `container`'s host-routing behaviour
  verified first (still unknown).
- grove must not let a sandboxed OpenCode reach `~/.local/state/opencode`
  read-write while D6 stands.

**Not covered.** Whether the credentials OpenCode needs survive the image, and
whether the agent behaves against a different filesystem. Those are covered by
the next spike.

### Apple's `container`: routing to a host, and cost (2026-10-10)

**Question.** D6's unblock needed a host service on a routable address. Three
things decide whether that is real: can a container reach a host port at all,
does authentication work across that boundary, and what does the runtime cost.

**Method.** `container` CLI 1.5.0, system service already running. A scratch
`opencode serve --service` pinned to `0.0.0.0:49558/9` under a scratch
`XDG_STATE_HOME`; an `alpine` container alongside. Live service (pid 1075) and
the real `service.json` (mtime `Oct 8 20:47:52`) verified untouched before and
after; no scratch container or service left running.

**Answer — the escape hatch is real, and it is cheap.**

- `container system status` → `running`, version 1.5.0. Subcommands are
  `run/create/exec/start/stop/rm`, `image`, `machine`, `network`, `volume`,
  `builder` — not Docker's `images`/`runtime`.
- **Cold start 14.4 s**, which included fetching a 66 MB init image. **Warm
  start 0.68 s** (`container run --rm alpine true`). The sub-second figure in
  the questions phase holds once the init image is local.
- **Default egress works, with DNS.** `wget https://api.anthropic.com/v1/models`
  returned `HTTP/1.1 401 Unauthorized` — the correct answer for an
  unauthenticated probe. `nslookup` resolved. So D5's "no egress restriction"
  is accurate, and the network is not the fragile part.
- **A container cannot reach a host's loopback.** Container gateway is
  `192.168.64.1`; `nc` to the live service on `49374` through it returned
  unreachable, as expected for a `127.0.0.1`-bound service.
- **A container CAN reach a host service bound to `0.0.0.0`.** With the scratch
  service on `0.0.0.0:49559`, from inside the container:
  `nc` to `192.168.64.1:49559` → **REACHED**; unauthenticated `GET /api/info` →
  `401`; with `Authorization: Basic opencode:<password>` → **`200 OK`** and the
  real body:
  `{"version":"2.0.20","pid":4799,"urls":["http://192.168.0.145:49559","http://192.168.64.1:49559"],…}`

**Evidence.** The service advertises every URL it can be reached on, and the
container's own gateway `192.168.64.1` is one of them. The `401`→`200` pair
isolates authentication as the only barrier, and grove already speaks exactly
that (`src/core/opencode/client.ts:152-153` reads `url`/`password`, Basic
`opencode:<password>`).

**Recommendation.** D6's exclusion no longer holds, and should be dropped in
favour of **OpenCode supported in the same slice as Claude**. The chain is
now measured end to end: `service.json` says the service is reachable at
`192.168.64.1`; a container can reach that address; the service answers with
`200` under the credentials grove already has. A sandboxed TUI can join the
host's shared service instead of starting its own, which is what removes the
eviction hazard. The requirement becomes: **bind the host's shared service to a
routable address**, and make the container's `service.json` read-only so it can
never register over the host's. Both are grove-side changes, neither needs the
agent to change.

**Still open.** Whether `container` supports deny-all egress plus a host proxy —
the D5 allow-list — which is the same "do we have an enforcement primitive"
question, now against a measured runtime rather than an assumed one. And
whether the agent's credentials survive the image, which is slice 1's job.

### Binding to the container bridge instead of `0.0.0.0` (2026-10-10)

**Question.** D6 as first written had grove write `{"hostname":"0.0.0.0"}`,
which binds the host's shared OpenCode service on **every** interface —
including the LAN. Is there a narrower address that still serves containers?

**Method.** The same scratch-service technique, with `hostname` set to the
container bridge address instead of `0.0.0.0`; an `alpine` container alongside;
the live service (pid 1075) and real `service.json` mtime verified untouched
before and after.

**Answer — yes, and it is strictly better.** The container's gateway (the host
side of the bridge) is `192.168.64.1`; the host's LAN address is `192.168.0.145`.
With `{"hostname":"192.168.64.1"}`:

- the service bound `TCP 192.168.64.1:49561 (LISTEN)` — one interface, not `*`;
- the container **reached** it at that address (`REACHED`);
- the host could **not** reach it via the LAN address
  (`192.168.0.145:49561` → `unreachable`);
- authenticated `GET /api/info` from the container returned
  `{"version":"2.0.20","pid":7477,"urls":["http://192.168.64.1:49561"],…}`.

**Evidence.** The earlier `0.0.0.0` run advertised `urls` containing **both**
`192.168.0.145` and `192.168.64.1` — the service itself listed a LAN-reachable
address. The bridge-scoped run advertised only `192.168.64.1`.

**Recommendation.** Bind the bridge address, never `0.0.0.0`. The container
subnet is a private VM interface that is not routable from the LAN, so the
service's exposure stops at "containers on this Mac" instead of "everyone on
this Wi-Fi network, subject to a password". The bridge address is discovered, not
hardcoded, and the port is the service's own. If discovery fails, grove must
refuse (`no-sandbox`) rather than fall back to `0.0.0.0`.

### A sandboxed agent working in a git worktree (2026-10-10)

**Question.** The hardest realistic case: a feature needing changes in two
repos, each worked in a worktree, both inside one sandbox. What breaks that the
worktree-only case does not?

**Method.** A throwaway worktree of this repo (`git worktree add --detach`), an
`alpine` + `git` image built locally, and containers with explicit mounts at
host-identical paths. All teardown verified: one worktree, no spike branches, no
containers, live service (pid 1075) untouched.

**Answer — three findings, one of them a security problem.**

- **A worktree's `.git` is a *file*, not a directory.** Here it read
  `gitdir: /Users/victor/git/grove/.git/worktrees/wt-probe`. Mounting the
  worktree alone gives `fatal: not a git repository: (null)` — the pointer names
  a path outside the mount. Mounting the worktree **and** the main repo's
  common dir, both at host-identical paths, works completely: `rev-parse
  --show-toplevel`, `--git-common-dir`, and a real `git commit` that the **host
  then sees** (`PROBE.txt` present, worktree HEAD advanced). So a worktree
  sandbox needs two mounts per repo, not one.
- **`--read-only-path` works nested inside a read-write mount.** With
  `--volume <common>:<common>` plus `--read-only-path <common>/hooks` and
  `/config`: writes to `refs/` succeeded, `git commit` succeeded, writes to
  `hooks/` and `config/` failed. The mechanism grove wants for the D6 carve-out
  is available.
- **Three follow-ups to that, measured the same day** — the two behaviours
  ADR 0038 listed as unmeasured, plus the fix it proposed:
  - **An absent carve-out path is tolerated.** `--read-only-path <nonexistent>`
    does not fail the run (exit 0, the container started and wrote), and a real
    carve-out in the same run still applied. This matters because
    `~/.gitconfig` may not exist on a given machine.
  - **Two nested carve-outs in one read-write volume work together.** With both
    `hooks/` and `config/` read-only, `refs/` stayed writable, `hooks/`
    rejected with `Read-only file system`, and `git checkout` + `git commit`
    inside a worktree still succeeded (`--show-toplevel` correct, commit landed).
  - **`core.hooksPath` neutralisation via `GIT_CONFIG_COUNT` works.** Control
    first: a `post-checkout` hook reached through `core.hooksPath` did run in the
    container, writing `ran uid=0`. With `GIT_CONFIG_COUNT=1`,
    `GIT_CONFIG_KEY_0=core.hooksPath`, `GIT_CONFIG_VALUE_0=/dev/null` the same
    checkout did **not** run it. The three `GIT_CONFIG_*` variables are visible
    in the container's `env`, so the agent can read them but not use them to
    re-enable hooks — they only add config. This converts the measured
    hook-execution property into a decision, as ADR 0038 proposed.
- **That carve-out does not stop hook execution.** A `post-checkout` hook
  already on the host **ran inside the sandbox** — with `hooks/` mounted
  read-only, `uid=0` — and wrote into the mounted worktree. Read-only stops the
  agent *editing* hooks; it cannot stop git *executing* one that is already
  there. This is the same finding Claude Code reaches, and it fixes it the same
  way: allow writes to the shared `.git` for refs and index, deny `hooks/` and
  `config` writes, and **know that an existing hostile hook still runs**.

**Evidence.** `git checkout -b` inside the container ran a host-authored
`post-checkout` that wrote a marker file into the worktree; the marker appeared
on the host. The control (no carve-out) behaved identically, so the carve-out is
what one would expect — and what is *not* sufficient.

**Recommendation.** A worktree sandbox is buildable: mount `<worktree>` and
`<main>/.git` at identical paths, mark `.git/hooks` and `.git/config` read-only,
and treat "host hooks execute inside the sandbox" as a **known property of this
feature** rather than a solved problem. This does not block the current
single-root design; it constrains any future multi-root or worktree scope, and it
is one more reason grove's own `gitconfig` is mounted but git *config* inside a
sandbox must never be writable.

**Also measured, incidentally.** `container build` needs the file named
`Dockerfile` (or `-f`); the first build of a two-line image took **28 s**, which
is the first-sandboxed-session cost the design quotes, not the 14 s of a bare
`container run`.

### Does an agent authenticate inside the sandbox, and where does it look for config? (2026-10-11)

**Question.** Two spikes above left this open — "Not covered: whether the credentials
OpenCode needs survive the image, and whether the agent behaves against a different
filesystem". Slice 1 answered neither, and § Risks claimed it would. Concretely:
(a) can a real agent complete a prompt inside `grove-sandbox`, with nothing but the
design's mount set; and (b) **where do the agents look for their own config**, given
grove mounts host paths at host-identical paths?

**Method.** `container` 1.5.0, image `grove-sandbox:cbcd1e51f27a` (unchanged), macOS
26.4.1. Every agent run under `script -q /dev/null container run --rm -i -t …`, because
`-i -t` needs a real controlling TTY and reports a false ENODEV without one. Host
credential stores enumerated first: `~/.claude`, `~/.claude.json`,
`~/.local/{share,state}/opencode`, `~/.config/opencode`, the `credential` table of the
154 MB `~/.local/share/opencode/opencode.db`, `security dump-keychain`, the pane env,
and `opencode auth list`. **The real Claude token was never read out of the Keychain** —
the env-var arm uses a deliberately invalid dummy, which is enough to prove the channel.

**Answer — one agent needs no credential at all, the other needs one grove must carry,
and a third finding hides underneath both.**

- **OpenCode carries no credential, anywhere, on this machine.** No `auth.json` or any
  `*auth*` file under its three data dirs; `credential` table exists in `opencode.db`
  with **0 rows**; no keychain entry; no `OPENCODE_API_KEY`; `opencode auth list` →
  *"No authenticated integrations"*. And yet host sessions run. The mechanism is a
  **client-identity gate, not a credential**: `https://opencode.ai/zen/v1` answers an
  unauthenticated curl with `403 FreeTierError: "OpenCode's free tier can only be used
  from within OpenCode"`. So the token is the *client itself*, which the image already
  has.
- **Measured in the container: it completes prompts with nothing mounted.**
  `env | grep -iE 'OPENCODE|API_KEY|AUTH'` → `(none)`; `opencode auth list` inside →
  `0 credentials`; `/root/.local/share/opencode/auth.json` absent **before and after** a
  successful turn. Two different free models both answered: `space-bunny-free` →
  `SPIKE-OK`, `big-pickle` → `ARM-A-2`. **A sandboxed OpenCode authenticates by
  existing.** There is nothing for grove to mount and nothing for it to refuse.
- **Claude is the opposite case, and the env channel is proven.** Its OAuth token is in
  the macOS Keychain (`svce = "Claude Code-credentials"`), which a Linux VM cannot read,
  and no `~/.claude/.credentials.json` exists on the host. Inside the container:
  - no credential → `Not logged in · Please run /login` (the slice-1 finding,
    reproduced headless under `-p`, not only in the TUI);
  - `-e CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-dummy-not-a-real-token` → the login gate
    **clears** and the failure moves to `API Error: 401 OAuth access token is invalid.`
    Claude Code accepts the variable, reads it, and sends it to the API. **The env
    channel works; only the token value was wrong.** `ANTHROPIC_API_KEY` and
    `ANTHROPIC_AUTH_TOKEN` are the other two the 2.1.285 binary reads.
- **The finding underneath both: the agent's own config mounts are inert.** The
  container's `HOME=/root` and `uid=0`, so the agents resolve `~` to `/root`, while grove
  mounts `~/.claude`, `~/.claude.json` and `~/.config/opencode` at **`/Users/victor/…`**.
  A run inside the container created `/root/.claude/`, `/root/.claude.json`,
  `/root/.config/opencode/opencode.jsonc` and a fresh `/root/.local/share/opencode/opencode.db`
  — all its own — while the host's `~/.claude` (0 entries modified) and `~/.claude.json`
  (mtime unchanged) were not touched at all. **A sandboxed agent currently runs with no
  host agent configuration whatsoever**: no `settings.json`, history, plugins, skills,
  commands or statusline. That also explains the credential result — there was never a
  credential file on that side of the mount to be missing.
- **And the fix for that is one env var per agent, using each agent's own documented
  mechanism.** OpenCode's CLI docs state that `opencode auth login` stores provider
  credentials in **`~/.local/share/opencode/auth.json`** — a path grove *already mounts*
  as `opencodeShare`. It is unreachable only because `XDG_DATA_HOME` still points at
  `/root`. Measured, with a scratch file holding a fake key so no real credential moved:
  `-e XDG_DATA_HOME=<the mounted path>` made the containerized agent report
  `Credentials <mounted>/auth.json` and list `● GitHub Copilot  api — 1 credentials`, and
  a `--read-only-path` on that file held (`Read-only file system`). `CLAUDE_CONFIG_DIR`
  is the equivalent lever for Claude and exists in the 2.1.285 binary. **So "log in to
  GitHub Copilot on the host and use it in the sandbox" is satisfiable without a single
  new mount** — it needs the config pointer, not a new volume.
- **Bare `-e VAR` forwards, and is invisible in argv.** `container run -e VAR` with no
  `=value` takes the value from the calling process's environment: measured
  `value=[forwarded-ok-12345]`, and still correct when the caller is
  `/bin/zsh -l -i -c` — exactly the pane grove builds, so a `.zshrc` export reaches the
  container. A bare `-e VAR` for a variable that **does not exist does not fail the run**
  (exit 0, `unset var ok`), so absence cannot be detected by attempting the run.

**Evidence.** `HOME=/root`, `whoami=root uid=0`; `/Users/victor/.config/opencode`
visible and populated while `$HOME` holds only the image's own `.bashrc`/`.profile`;
`opencode auth list` inside → `Credentials ~/.local/share/opencode/auth.json / 0
credentials`; `SPIKE-OK` and `ARM-A-2`; `Not logged in · Please run /login` against
`401 OAuth access token is invalid.`; `/root/.claude.json` (49 941 bytes) and
`/root/.config/opencode/opencode.jsonc` created while the host counterparts were
byte-for-byte untouched (0 entries modified in `~/.claude`, `~/.claude.json` mtime
unchanged); `XDG_DATA_HOME` redirect → `● GitHub Copilot  api — 1 credentials` read from
the mount, with `Read-only file system` on write.

**Recommendation.** The two agents are different problems and must not be given the same
answer. **OpenCode needs no credential channel of its own** — the free tier authenticates
by the client being opencode, and a host-side `opencode auth login` (the GitHub Copilot
case) reaches the sandbox through a config pointer, because grove already mounts the path
that holds it. **Claude forwards its token on the env channel**, which is the documented
container path and the only one measured to work. § Risks' claim that "slice 1 settles
both" was wrong about the mechanism, not merely unfinished.

### Can grove read Claude Code's token from the Keychain? (2026-10-11, research)

**Question.** The container measurement says the Claude token is Keychain-only. Before
grove ever considers reading it: **is that read reliable, supported, and safe?**

**Answer — no on all three counts, and the third is the one that decides it.**

- **It is not reliable.** Measured on this Mac: `security find-generic-password
  -s "Claude Code-credentials" -w` succeeds silently, exit 0, 828 bytes, no prompt. But
  that success is conditional on: the login keychain being unlocked (locked after
  reboot, under FileVault, or with "Lock after N minutes" enabled → `User interaction is
  not allowed`, OSStatus `-25308`); the keychain password being in sync with the account
  password or it does not auto-unlock; a GUI/Aqua session being available (SSH and
  headless have none); and `CLAUDE_CONFIG_DIR` matching — that variable keys the
  Keychain item too, so a session using it reads a **different** entry. An enterprise
  item pushed to the Data Protection keychain is invisible to `security` outright.
- **It is not supported.** Reading `Claude Code-credentials` from a third-party app
  appears in no Anthropic documentation. Claude Code creates the item via
  `/usr/bin/security add-generic-password` with no `-T` and no `-A`, so the only ACL is
  `/usr/bin/security`, which any same-user process can satisfy — this was reported to
  Anthropic (Silverfort, HackerOne 2026-06-25, CWE-732) as *"any macOS process can read
  stored credentials"*, and Anthropic **confirmed they are tracking a tightening of that
  ACL as a hardening improvement**. The silent read grove depends on today is an accident
  someone has publicly committed to removing. When it lands, grove's read starts
  prompting for the login password — or failing outright in a GUI-launched Electron app
  that cannot answer a prompt it never expected. Claude Desktop does this correctly via
  Electron `safeStorage`; the CLI does not.
- **It is not the supported container path, and the supported one is documented.**
  Anthropic's own devcontainer and CI docs specify `CLAUDE_CODE_OAUTH_TOKEN` from
  `claude setup-token`, and state it **takes precedence over Keychain-stored
  credentials**, explicitly anticipating it being kept in a shell profile. The same
  devcontainer page warns — in terms that match grove's threat model — that a container
  "do[es] not prevent a malicious project from exfiltrating anything accessible inside
  the container", and advises preferring repository-scoped or short-lived tokens.
- **A file fallback exists and it matters.** Claude Code's docs: when the Keychain
  rejects the write (locked, SSH), it stores the login in `~/.claude/.credentials.json` at
  mode `0600` — the same store Linux uses. So on some machines the credential *is* on the
  filesystem, inside the path grove already mounts.

**Evidence.** `security find-generic-password -s "Claude Code-credentials" -w` → exit 0,
828 bytes, empty stderr, no prompt; `security show-keychain-info login.keychain-db` →
`no-timeout`; not-found → exit **44**. `man security add-generic-password`: *"By default
the application which creates an item is trusted to access its data without warning. You
can remove this default access by explicitly specifying an empty app pathname: `-T ""`."*
Silverfort disclosure and Anthropic's confirmation:
https://www.silverfort.com/blog/skipping-the-lock-a-claude-code-cli-weakness-lets-any-macos-process-read-stored-credentials
Precedence and `setup-token`: https://code.claude.com/docs/en/authentication#authentication-precedence
and https://code.claude.com/docs/en/authentication#generate-a-long-lived-token
Container guidance: https://code.claude.com/docs/en/devcontainer
File fallback: https://code.claude.com/docs/en/authentication#credential-management

**Recommendation.** Do not read the Keychain. The supported channel is the env var, and
it is what grove should forward. Two consequences the design must carry: a sandbox must
**carve `~/.claude/.credentials.json` out read-only**, exactly as it already does for
`~/.gitconfig`, because a writable credentials file lets a sandboxed agent rewrite or
delete the human's login; and grove must **treat a missing forwarded credential as
`no-sandbox`, not as a fallback to reading the Keychain**, so that the day Anthropic's
ACL hardening lands grove fails with a message rather than a login-password prompt
nobody is there to answer.

**Unverified.** Whether the ACL hardening has since shipped; whether a GUI-launched
Electron app can perform the read today (not tested); the exact exit code for a locked
keychain (not testable without mutating keychain state).


## Open questions

None — all research questions in `01-questions.md` are answered above.
