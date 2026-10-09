---
feature: 2026-10-08-agent-sandboxing
phase: design
status: draft
version: 1
created: 2026-10-09
updated: 2026-10-09
based_on:
  - 01-questions.md@1
  - 02-research.md@2
forced: []
---

# Agent session sandboxing — design

## Desired state

1. A session created as **sandboxed** runs its agent process inside an Apple
   `container` Linux VM: the pane's leaf command becomes
   `$SHELL -l -i -c 'exec container run … claude …'`.
2. Inside, the agent sees exactly its working directory at **the same absolute
   path**, its own agent config directory, the Claude hook spool and the Grove
   socket — all at host-identical paths. Nothing else of the host exists inside.
3. Opt-in is per session: `grove new claude --sandboxed`, or **New sandboxed
   session** in the palette, which reuses the existing ⌘T kind list. Default off.
4. A sandboxed session remembers it (`Session.sandboxed`), so resuming it launches
   it sandboxed again — a session never silently changes blast radius. Killing or
   removing it removes its container; crash orphans are pruned at app start.
5. Only Claude sessions can be sandboxed this round, and isolation is
   filesystem-only — Apple's container networking is unconstrained (ADR 0036).

## Non-goals

- OpenCode in the sandbox: its TUI must reach the host's **shared** service,
  which a container's loopback cannot, and registering over it kills the host's.
- Any egress restriction; Linux hosts; Docker / `sbx` / Seatbelt.
- Terminal-kind sessions; worktree pairing; multi-image or user images; GPU.

## System design

### The seam (`src/core/sandbox/`)

One module turns a session's agent argv into a container argv. It composes at the
seam `loginShellArgv` already owns (`core.ts:634-637`, `:684-685`), the way
`pathPrefix` does. `AgentSource`, `SessionBackend` and tmux are untouched.

```
sandboxArgv(spec, agentArgv) -> string[]       // the pane's leaf command
loginShellArgv(sandboxArgv(...), shellOpts()) // unchanged: finds `container` on the host PATH
backend.create({ ..., argv })                  // unchanged
```

The **host** login shell still runs (ADR 0010): `container` is a host binary, and
rc-file noise stays visible in the pane as today. The user's shell config is
*not* mounted, so a sandboxed agent gets the image's env, not the host's.

### Container spec

```
container run --rm -i -t --name <tmuxName> --workdir <cwd>
  --volume <cwd>:<cwd>                                  # rw; the host path, identical inside
  --volume <claudeHome>:<claudeHome>                    # ~/.claude: credentials, history, settings
  --volume <claudeJson>:<claudeJson>                    # ~/.claude.json
  --volume <gitconfig>:<gitconfig>                      # ~/.gitconfig: commits get the user's identity
  --volume <spoolDir>:<spoolDir>                        # <userData>/agents/claude — the hooks append here
  --volume <socketPath>:<socketPath>                    # <userData>/grove.sock
  -e GROVE_SESSION_ID -e GROVE_SOCKET -e TERM=xterm-256color
  <image> <agentArgv…>
```

All mounts are **rw** and **same-path**: the invariant every host subsystem
already assumes (`research` §9 — diff, discovery, autolink, viewer and spool all
resolve host paths). Nothing maps a host path to a container-only path.

### Image

`resources/sandbox/Dockerfile` builds `grove-sandbox:<hash>`, `<hash>` being a
truncated `sha256(Dockerfile)` — a content-addressed local tag. Content: a Linux
base with `git`, `ripgrep`, `jq` (the ADR 0032 statusline hook needs it),
`ca-certificates`, and pinned `opencode-ai` + `@anthropic-ai/claude-code` npm
globals. `container build` runs it once, on the first sandboxed launch, then the
tag is reused; a missing `container`/system or a failed build fails the create
with `no-sandbox` rather than falling back to an unsandboxed pane.

### Lifecycle

`--rm` covers a clean agent exit. `sessionKill`/`sessionRemove` additionally run
`container rm -f <tmuxName>` after `backend.kill` (SIGKILLing `container run`
does not fire `--rm`), ignoring "no such container". `core.start()` prunes any
container named `grove-*` with no live tmux session.

### Contracts

```ts
// src/shared/types.ts — persisted
interface Session { …; sandboxed: boolean }
interface StateFile { schemaVersion: 8; … }
// src/core/store/stateStore.ts
const v7ToV8 = (s) => ({ ...s, sessions: (s.sessions ?? []).map((x) => ({ ...x, sandboxed: false })) })

// src/core/core.ts — Claude only; else { ok: false, error: 'no-sandbox' }
sessionCreate(a: { …; sandboxed?: boolean })
// src/shared/cli.ts, src/cli/args.ts, src/shared/ipc.ts
'sessions.create'.params.sandboxed?: boolean          // grove new … --sandboxed
'session:create': [{ projectId; kind; cols; rows; sandboxed?: boolean }, Session]
```

`CoreOptions.sessionEnv` gains `spoolDir`, so core knows the spool directory to
mount (it currently only knows `socketPath` and `binDir`).

## Program design

### Call paths

```
CLI:    grove new claude --sandboxed → sessions.create{sandboxed} → sessionCreate
UI:     ⌘K "New sandboxed session" → quickNew{sandboxed} → ⌘T kind list → session:create → sessionCreate
Resume: sessionResume → sandboxArgv (from session.sandboxed) → loginShellArgv → backend.create
Kill:   sessionKill/Remove → backend.kill → container rm -f <tmuxName>
Start:  core.start → sandboxPrune(backend.list())
```

### File tree

```
src/core/sandbox/{spec,image,argv,container}.ts (+ tests)   NEW  SandboxSpec, mountsFor, envFor, sandboxArgv, imageRef, ensureImage, sandboxAvailability, removeContainer, pruneContainers
src/core/core.ts                                           MODIFIED  sandbox seam in sessionCreate/sessionResume, kill/remove teardown, start prune, sessionEnv.spoolDir
src/core/sessions.ts, src/shared/types.ts                  MODIFIED  Session.sandboxed, newSession{ sandboxed }, StateFile v8
src/core/store/stateStore.ts                               MODIFIED  v7ToV8, schemaVersion 8
src/shared/{cli,ipc}.ts, src/main/{index,ipc,cliServer}.ts MODIFIED  --sandboxed over sessions.create, sandboxed over session:create, spoolDir into sessionEnv
src/cli/{args,index}.ts                                    MODIFIED  --sandboxed through the CLI
src/renderer/src/{App.tsx,paletteItems.ts}                 MODIFIED  "New sandboxed session", quickNew.sandboxed
src/renderer/src/components/{ListRow,SessionCard}.tsx      MODIFIED  the sandbox tag
resources/sandbox/Dockerfile                               NEW       the sandbox image
```

### Key signatures

`spec.ts` builds mounts and env, `argv.ts` the container argv, `image.ts` the image and its availability, `container.ts` teardown:

```ts
mountsFor(kind: AgentKind, o: { cwd: string; socketPath: string; spoolDir: string; home: string }): string[]
envFor(session: Session, o: { socketPath: string }): Record<string, string>
sandboxArgv(o: { name: string; spec: SandboxSpec; agentArgv: string[] }): string[]
imageRef(dockerfile: string): string
ensureImage(o: { container: string; dir: string; tag: string }): Promise<void>
sandboxAvailability(container: string): Promise<{ ok: boolean; error?: 'no-sandbox' }>
removeContainer(container: string, name: string): Promise<void>
pruneContainers(container: string, live: Set<string>): Promise<void>
```

Tests assert argv and mount strings against a fake `container` — no VM in
`npm test`; slice 1 is where the real run gets verified.

## One-way decisions

**D1. Isolation runs the whole agent process in an Apple `container` VM**, built
from a content-addressed local image ([ADR 0034](../../adr/0034-agent-sessions-run-in-an-apple-container-sandbox.md)).
- Rejected: Seatbelt/bubblewrap (weaker, and the human chose Apple's CLI);
  `sbx`/Docker (needs Docker Desktop, seconds of startup); mounting the host's
  npm tree (macOS binaries cannot run in a Linux container).

**D2. Only the mount set sees the host, at host-identical paths**
([ADR 0035](../../adr/0035-sandbox-binds-mounts-at-identical-host-paths.md)).
- Rejected: a `/workspace` remap (breaks diff, discovery, autolink and the
  viewer, which all resolve `project.path`); mounting all of `$HOME` (hands the
  agent SSH keys, every credential store, every other project).

**D3. `Session.sandboxed` is persisted; the state file goes to v8**
([ADR 0033](../../adr/0033-sessions-persist-a-sandboxed-flag.md)).
- Rejected: a `sandbox` object on `Session` (schema surface for fields nothing
  reads yet); not persisting it (resume would silently widen the blast radius).

**D4. A new `core/sandbox` module owns the wrapper; agent sources and the
tmux backend stay unchanged** ([ADR 0034](../../adr/0034-agent-sessions-run-in-an-apple-container-sandbox.md)).
- Rejected: a sandboxed `SessionBackend` (questions already ruled it out — the
  backend's job is the pane, not the leaf); teaching each `AgentSource` about
  containers (leaks a launch concern into every agent adapter).

**D5. Isolation is filesystem-only this round; egress is whatever Apple's
container networking provides** ([ADR 0036](../../adr/0036-sandbox-isolation-is-filesystem-only.md)).
- Rejected: `--network none` (the agent cannot reach its own API); a host
  allow-list proxy (a second daemon, a new failure mode, out of proportion to a
  filesystem jail). Recorded as deferred, with the questions-phase answer noted.

**D6. Claude only this round.**
- Rejected: OpenCode — its TUI always talks to a server, by default the **shared**
  one registered in `~/.local/state/opencode/service.json` (ADR 0005), which a
  container's own `127.0.0.1` cannot reach. It would start its own service, and
  that service evicts the host's — status dies for every OpenCode session.

## Two-way decisions

| Decision | Choice |
|---|---|
| Default | Off; every existing session launches exactly as today |
| Entry points | `--sandboxed` (CLI) and **New sandboxed session** (palette → the ⌘T kind list); one extra command, no new component, no dialog |
| Refusals | Non-Claude kind, missing `container`, failed build → `no-sandbox`; never a silent unsandboxed fallback |
| Marker | A tag on the session card; not part of the label |
| Mount mode | Read-write everywhere, config and spool dirs included; `binDir` is not mounted (its launcher is a host file) |
| Worktrees | Untouched — a worktree is just another `Session.cwd` to bind-mount |

## Risks

- **Credentials.** Claude's macOS credentials live in the Keychain, which the
  container cannot read. Slice 1 proves whether a mounted `~/.claude` is enough;
  if not, the image needs a one-time `claude login`. This is the feature's main
  risk and the first slice exists to settle it.
- **Single-socket mount.** Mounting `grove.sock` as a file may not work; the
  fallback is mounting `<userData>` itself, which widens the mount set.
- **Kill semantics.** `container run` SIGKILLed leaves the container running;
  teardown is explicit for that reason, and `--rm` is belt-and-braces.
- **Startup cost.** The first sandboxed session pays an image build; every later
  one pays ~a second of VM start.
- **Isolation is honest only to the mount set**, not to the network (ADR 0036);
  the session tag says so.
- **Slow many-small-file I/O** over the bind mount on a heavy session.

## Open questions

None.