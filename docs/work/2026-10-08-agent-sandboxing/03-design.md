---
feature: 2026-10-08-agent-sandboxing
phase: design
status: approved
version: 7
created: 2026-10-09
updated: 2026-10-11
approved_at: 2026-10-11
based_on:
  - 01-questions.md@1
  - 02-research.md@5
forced:
  - "design exceeds designMaxLines (255 vs 220): v5 was already 222 at its approval, and D7 added the seventh one-way decision with its rationale and rejected options. Forced by the human rather than compressing approved rationale."
---

# Agent session sandboxing — design

## Desired state

1. A **sandboxed** session runs its agent inside an Apple `container` Linux VM:
   `$SHELL -l -i -c 'exec container run … claude …'`. Both agent kinds work.
2. Inside, it sees its working directory at **the same absolute path**, its own config
   dirs, the hook spool, the Grove socket and grove's own CLI (D7). Nothing else: no
   `~/.ssh`, no other project.
3. Opt-in is per session: `grove new claude --sandboxed`, or **New sandboxed session**
   in the palette, reusing the existing ⌘T kind list. Default off.
4. It remembers `Session.sandboxed`, so a resume launches it sandboxed again — a session
   never silently changes blast radius. Kill/remove drops its container; crash orphans
   are pruned at app start.
5. Isolation is filesystem-only (ADR 0036). A sandboxed OpenCode joins the host's shared
   service rather than starting one (D6). It commits locally; you push.

## Non-goals

- Any egress restriction; Linux hosts; Docker / `sbx` / Seatbelt.
- Terminal-kind sessions; user images; GPU; multi-repo sessions.
- Pairing sandbox with worktree *creation*. A sandboxed session may **run in** a worktree
  — that is D2's common-dir rule — but grove never creates one for it.

## System design

### The seam (`src/core/sandbox/`)

One module turns a session's agent argv into a container argv, composed at the seam
`loginShellArgv` already owns (`core.ts:634-637`, `:684-685`), the way `pathPrefix`
does. `AgentSource`, `SessionBackend` and tmux stay untouched: `sandboxArgv(spec,
agentArgv)` becomes the pane's leaf command inside the unchanged
`loginShellArgv(…, shellOpts())` and `backend.create({ …, argv })`. The **host** login
shell still runs (ADR 0010), so rc-file noise stays visible; the user's shell config is
*not* mounted, so the agent gets the image's env. The `grove.sock` single-file mount that ADR 0035 left
"unresolved, and the reason the first slice is a manual tracer" is **measured working**
(2026-10-10): a host AF_UNIX listener answered from inside the container. Mounting all
of `userData` is not needed and must not be taken.

### Container spec

```
container run --rm -i -t --name <tmuxName> --workdir <cwd>
  --volume <cwd>:<cwd>                    # rw; host path, identical inside
  --volume <commonDir>:<commonDir>        # rw; ONLY when <cwd> is a worktree (D2)
  --read-only-path <commonDir>/hooks      #   ditto — only when the two differ
  --read-only-path <commonDir>/config
  --volume <claudeHome>:<claudeHome>      # ~/.claude, ~/.claude.json
  --volume <opencodeData>:<opencodeData>  # ~/.local/share/opencode, ~/.config/opencode
  --read-only-path <gitconfig>            # ~/.gitconfig: identity in, never out
  --volume <spoolDir>:<spoolDir>          # <userData>/agents/claude — hooks append here
  --volume <socketPath>:<socketPath>      # <userData>/grove.sock
  --volume <cliBundle>:<cliBundle>        # grove's own CLI (D7): read-only, at its host path
  --read-only-path <opencodeState>        # ~/.local/state/opencode (D6)
  -e GROVE_SESSION_ID -e GROVE_SOCKET -e TERM=xterm-256color
  -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=core.hooksPath
  -e GIT_CONFIG_VALUE_0=<empty dir baked into the image>
  <image> <agentArgv…>
```

Mounts are **same-path** — the invariant every host subsystem already assumes
(`research` §9). Read-write except: OpenCode's state dir (D6); `~/.gitconfig`, since an
agent that can write it can set `core.hooksPath` for **every unsandboxed git run on the
host** afterwards; and a worktree's `.git/hooks` + `.git/config`. The three
`GIT_CONFIG_*` variables apply at git's command-line scope, overriding `~/.gitconfig`
and `.git/config` for **every** git invocation in the pane — which is what turns the
hook row below into a decision rather than a documented risk.

### Image

`resources/sandbox/Dockerfile` builds `grove-sandbox:<hash>`, `<hash>` a truncated
`sha256(Dockerfile)`. Content: a Linux base with `git`, `ripgrep`, `jq` (the ADR 0032
statusline hook needs it), `ca-certificates`, an **empty directory** for
`core.hooksPath` to point at, and pinned `opencode-ai` + `@anthropic-ai/claude-code`
globals. The npm globals mean the image already carries a Node runtime, which is what
makes D7 cheap. The Dockerfile also installs a three-line `/usr/local/bin/grove` shim
that `exec node <cliBundle> "$@"` — the same "a CLI the agent needs lives in the image"
pattern as `jq`, with the bundle itself mounted at run time so a grove upgrade never
invalidates the tag. Built once on first use; a missing `container` or failed build fails
`no-sandbox`, never an unsandboxed pane.

### Lifecycle, and the shared service (D6)

`--rm` covers a clean agent exit. `sessionKill`/`sessionRemove` also run
`container rm -f <tmuxName>` after `backend.kill` (SIGKILLing `container run` does not
fire `--rm`), ignoring "no such container". `core.start()` prunes `grove-*` containers
with no live tmux session. Before the first sandboxed **OpenCode** session, grove writes
`{"hostname":"<bridge>"}` once into the service config, `<bridge>` the discovered
container-gateway address (measured `192.168.64.1`) — **never `0.0.0.0`**, measured to
bind the service on the LAN. An undiscoverable bridge fails the create `no-sandbox`.

### Contracts

`Session.sandboxed: boolean` persisted, state file **v9**, `v8ToV9` defaulting it to
false (v8 shipped for `workflowStatus`). `sandboxed?: boolean` threads through
`sessionCreate` (agent kinds only) and both create boundaries. `CoreOptions.sessionEnv`
gains `spoolDir` and `opencodePaths`.

## Program design

Create (CLI or palette) → `sessionCreate` → `sandboxArgv` → `loginShellArgv` →
`backend.create`; resume repeats that seam from `session.sandboxed`; kill/remove adds
`container rm -f`; start prunes orphans; the first sandboxed OpenCode binds the shared
service (D6). Tests assert argv, mount and env strings against a fake `container`; slice
1 runs the real thing.

```
src/core/sandbox/{spec,image,argv,container,service}.ts (+ tests)  NEW  the sandbox module
src/core/git.ts                                            MODIFIED  gitCommonDir(dir) — the D2 derivation
src/core/core.ts, src/main/index.ts                       MODIFIED  seam, teardown, start prune, AgentPaths
src/core/sessions.ts, src/shared/types.ts, src/core/store/stateStore.ts  MODIFIED  Session.sandboxed, v8ToV9
src/shared/{cli,ipc}.ts, src/main/{ipc,cliServer}.ts, src/cli/{args,index}.ts  MODIFIED  --sandboxed
src/renderer/src/{App.tsx,paletteItems.ts} + components/{ListRow,SessionCard}.tsx  MODIFIED  palette item, card tag
resources/sandbox/Dockerfile                               NEW       the sandbox image + the grove shim (D7)
package.json                                               MODIFIED  asarUnpack gains out/main/cli.js (D7)
```

`AgentPaths` (`{ claudeHome, claudeJson, opencodeShare, opencodeConfig,
opencodeState, opencodeServiceConfig, gitconfig, spoolDir, socketPath, cliBundle }`) is
resolved once in main.

```ts
gitCommonDir(dir: string): string | null          // D2; no spawn, src/core/git.ts:18-26
mountsFor(kind, o: { cwd: string; commonDir: string | null; paths: AgentPaths }): string[]
readOnlyPathsFor(kind, o: { commonDir: string | null; paths: AgentPaths }): string[]
envFor(session, o: { socketPath: string }): Record<string, string>   // incl. GIT_CONFIG_*
sandboxArgv(o: { name: string; spec: SandboxSpec; agentArgv: string[] }): string[]
imageRef(dockerfile: string): string;  ensureImage(o: { container; dir; tag }): Promise<void>
sandboxAvailability(container: string): Promise<{ ok: boolean; error?: 'no-sandbox' }>
removeContainer(container, name): Promise<void>;  pruneContainers(container, live): Promise<void>
ensureServiceReachable(o: { configFile: string }): Promise<void>   // D6
```

Packaging consequence of D7: `out/main/cli.js` must exist as a real file for
`--volume` to bind it. In `electron-vite dev` it does. A packaged build puts it inside
`app.asar`, which cannot be bind-mounted, so `package.json` gains
`out/main/cli.js` to `build.asarUnpack`.

## One-way decisions

**D1. The whole agent process runs in an Apple `container` VM**, from a
content-addressed local image ([ADR 0034](../../adr/0034-agent-sessions-run-in-an-apple-container-sandbox.md)).
- Rejected: Seatbelt/bubblewrap (weaker, human chose Apple's CLI); `sbx`/Docker (needs
  Docker Desktop, seconds of startup); the host's npm tree (macOS binaries cannot run
  in a Linux container).

**D2. Only the mount set sees the host, at host-identical paths**: the session's working
directory, plus — when that directory is a `git worktree` — the git **common dir** of
its repository, with `hooks/` and `config` read-only
([ADR 0035](../../adr/0035-sandbox-binds-mounts-at-identical-host-paths.md)).
- Measured: a worktree's `.git` is a *file* naming `<main>/.git/worktrees/<name>`, a
  path outside the mount, so mounting the worktree alone gives `fatal: not a git
  repository: (null)`. Mounting the worktree **and** the common dir, both at
  host-identical paths, works completely — `--show-toplevel`, `--git-common-dir`, and a
  real `git commit` the host then sees (`02-research.md` § Spikes).
- The common dir is **not an extra root**: it is a sibling inside the same repository,
  mounted only when it differs from the working directory. The same-path invariant is
  untouched.
- **Rejected: a `/workspace` remap** (breaks diff, discovery, autolink and viewer,
  which resolve `project.path`); **mounting all of `$HOME`** (SSH keys, every credential
  store, every project); **extra roots for multi-repo work** — measured feasible, but
  the mount set becomes a per-session list, re-opening "what did this agent touch" and
  needing a schema field. Multi-repo is rejected at design level in
  `2026-10-08-worktree-support`: grove's unit of work is the feature folder, so a
  two-repo task is two features.

**D3. `Session.sandboxed` is persisted; the state file goes to v9**
([ADR 0033](../../adr/0033-sessions-persist-a-sandboxed-flag.md)). Rejected: a `sandbox`
object on `Session`; not persisting it (resume would silently widen the blast radius).

**D4. A new `core/sandbox` module owns the wrapper; agent sources and the tmux backend
are unchanged** ([ADR 0034](../../adr/0034-agent-sessions-run-in-an-apple-container-sandbox.md)).
- Rejected: a sandboxed `SessionBackend` (the backend owns the pane, not the leaf);
  teaching each `AgentSource` about containers (leaks a launch concern into every adapter).

**D5. Isolation is filesystem-only; egress is Apple's default**
([ADR 0036](../../adr/0036-sandbox-isolation-is-filesystem-only.md)). Measured: egress
reaches `api.anthropic.com`. Rejected: `--network none`; an allow-list proxy now (no
enforcement primitive). Deferred.

**D6. OpenCode is supported, by making it join the host's service instead of starting
its own**, bound to the **container bridge address only**
([ADR 0034](../../adr/0034-agent-sessions-run-in-an-apple-container-sandbox.md)).
- Rejected: leaving OpenCode out (measured reachable); a sandboxed TUI registering its
  own service (a second registration **evicts** the incumbent); `0.0.0.0` (measured to
  expose the service on the LAN).
- Costs: the shared service must leave loopback, and the container's `service.json` must
  be read-only. Both grove-side.

**D7. The sandbox also mounts grove's own CLI, read-only, at its host path**
([ADR 0039](../../adr/0039-the-sandbox-mounts-groves-own-cli.md)). A sandboxed agent
keeps the full `grove` surface — `ls`, `new`, `send`, `wait`, `read`, `focus`, `kill`.
- Measured: `out/main/cli.js` is self-contained (node builtins only, 10 KB), so it runs
  under plain `node`; the image already carries a Node runtime for its pinned agent npm
  globals. The `binDir` launcher stays host-only — it execs the macOS Electron binary,
  which cannot run in a Linux container — so the image gets a three-line `grove` shim
  instead, and the bundle is **mounted** rather than baked, so a grove upgrade never
  invalidates the tag. `package.json` gains `out/main/cli.js` to `build.asarUnpack`,
  since a packaged build would otherwise put it inside `app.asar`, unmountable.
- The socket mount and `GROVE_SOCKET`/`GROVE_SESSION_ID` were already committed by ADR
  0035; they were inert without a client, and this is what makes them live.
- Rejected: **sandboxed sessions lose the CLI** (simplest, and what this design recorded
  by omission — but Q5 chose to keep it, and orchestration is worth *more* inside a
  sandbox, where a helper session is where risky work can be contained); a separate
  minimal Linux client (forks ADR 0027's frozen command surface into a second
  implementation that will drift); baking the bundle in (rebuilds per grove release).

## Two-way decisions

| Decision | Choice |
|---|---|
| Default | Off; every existing session launches as today |
| Entry points | `--sandboxed` (CLI) and **New sandboxed session** (palette → ⌘T kind list) |
| Refusals | Terminal kind, missing `container`, failed build, undiscoverable bridge → `no-sandbox`; never a silent fallback |
| Marker | A tag on the session card; not part of the label |
| Mount mode | Read-write, except OpenCode's state dir, `~/.gitconfig`, a worktree's `.git/hooks` + `.git/config`, and grove's own CLI bundle (D7, read-only). `binDir` stays unmounted — the host launcher is macOS-only and has no business inside |
| Worktrees | Supported by D2 — the worktree **and** its repo's common dir, host-identical, hooks/config read-only. Slice 1 must verify `git rev-parse --show-toplevel` **and a real `git commit`** inside it before a worktree path ships; its verify currently runs no git command at all |
| Git hooks | Neutralised by env: `GIT_CONFIG_COUNT=1`, `KEY_0=core.hooksPath`, `VALUE_0=<empty dir in the image>`. Command-line scope, beating `~/.gitconfig` and `.git/config` for every git call in the pane. A repo that legitimately uses `core.hooksPath` stops running hooks inside the sandbox — the same class of divergence as shipping no rc files |
| Shared-service bind | Grove writes the bridge address, **with a consent prompt** the first time |
| Git push | No SSH agent or credential helper inside: a grove choice, not a container limit. Commit locally, push from the host |

## Risks

- **Credentials.** Claude's macOS credentials live in the Keychain, the container cannot
  read it; OpenCode's may not survive the image. Slice 1 settles both.
- **Rebinding the shared service.** D6 moves it onto the container bridge — private, but
  machine-wide, hence consent.
- **`--read-only-path` is Experimental**, and its two risky cases are now measured: an
  **absent** path is tolerated (covering a missing `~/.gitconfig`), and **two nested
  carve-outs in one read-write volume** work together. Slice 1 asserts both.
- **Git hooks run inside the sandbox** unless neutralised. Measured: a host
  `post-checkout` hook ran as `uid=0` even with `hooks/` read-only. grove pins
  `core.hooksPath=/dev/null` via `GIT_CONFIG_COUNT`/`KEY_0`/`VALUE_0`, which stops it
  (measured). A repo using `core.hooksPath` loses those hooks — the same divergence as
  shipping no rc files.
- **Startup cost.** First session pays the image build (28 s), later ~0.7 s.
- **Isolation is honest only to the mount set**, not the network (ADR 0036).
- **One repository per session** (D2): no SSH agent or credential helper inside, and
  multi-repo is out of scope.

## Open questions

None.