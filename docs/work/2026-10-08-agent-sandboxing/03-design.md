---
feature: 2026-10-08-agent-sandboxing
phase: design
status: approved
version: 8
created: 2026-10-09
updated: 2026-10-11
approved_at: 2026-10-11
based_on:
  - 01-questions.md@1
  - 02-research.md@6
forced:
  - "design exceeds designMaxLines (255 vs 220): v5 was already 222 at its approval, and D7 added the seventh one-way decision with its rationale and rejected options. Forced by the human rather than compressing approved rationale."
  - "design exceeds designMaxLines again (v8, D8): the human declined to compress approved rationale once already, and D8 must carry its measured evidence and rejected options or the next session re-derives the Keychain question. Approved rationale left intact; new material written as tightly as the subject allows."
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
6. A sandboxed session **authenticates the way that agent already authenticates on the
   host** (D8), and grove refuses `no-sandbox` rather than opening a pane that cannot log
   in.

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
  --read-only-path <claudeHome>/settings.json        # D8: an agent that can write hooks
  --read-only-path <claudeHome>/.credentials.json    # D8: an agent that can rewrite your login
  --volume <opencodeData>:<opencodeData>  # ~/.local/share/opencode, ~/.config/opencode
  --read-only-path <opencodeShare>/auth.json         # D8: read your provider logins, not edit
  --read-only-path <gitconfig>            # ~/.gitconfig: identity in, never out
  --volume <spoolDir>:<spoolDir>          # <userData>/agents/claude — hooks append here
  --volume <socketPath>:<socketPath>      # <userData>/grove.sock
  --volume <cliBundle>:<cliBundle>        # grove's own CLI (D7): read-only, at its host path
  --read-only-path <opencodeState>        # ~/.local/state/opencode (D6)
  -e GROVE_SESSION_ID -e GROVE_SOCKET -e TERM=xterm-256color
  -e CLAUDE_CONFIG_DIR=<claudeHome>                              # D8: claude only
  -e XDG_DATA_HOME=<~/.local/share> -e XDG_CONFIG_HOME=<~/.config>   # D8: opencode only
  -e CLAUDE_CODE_OAUTH_TOKEN -e ANTHROPIC_API_KEY                 # D8: claude only, bare
  -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=core.hooksPath
  -e GIT_CONFIG_VALUE_0=<empty dir baked into the image>
  <image> <agentArgv…>
```

Mounts are **same-path** — the invariant every host subsystem already assumes
(`research` §9). Read-write except: OpenCode's state dir (D6); `~/.gitconfig`, since an
agent that can write it can set `core.hooksPath` for **every unsandboxed git run on the
host** afterwards; a worktree's `.git/hooks` + `.git/config`; and — new in D8, because D8
makes the agent config volumes reachable for the first time — the three files that carry
**authority** rather than state (`settings.json`, `.credentials.json`, `auth.json`). Same
principle, same reason. The three `GIT_CONFIG_*` variables apply at git's command-line
scope, overriding `~/.gitconfig` and `.git/config` for **every** git invocation in the
pane — which is what turns the hook row below into a decision rather than a documented
risk.

### Authentication (D8)

The container runs `uid=0` with `HOME=/root`, so both agents resolve `~` to `/root` while
grove mounts the host's config at `/Users/victor/…`. **Measured: those volumes are present
and never read**, so a sandboxed agent runs with none of the host's settings, plugins,
skills, commands — or credentials. One env var per agent points each at the paths grove
*already* mounts, via each agent's own documented mechanism: **no new mount, and ADR 0035's
same-path invariant untouched.** Credentials then arrive by whichever channel that agent
already has.

- **OpenCode needs no channel of its own.** With no login at all, the Zen free tier
  authenticates by the client *being* opencode — measured in the real container, two
  models, `0 credentials`, no `auth.json` before or after. With a host
  `opencode auth login` (say GitHub Copilot), the credential sits in
  `~/.local/share/opencode/auth.json`, inside a directory grove already mounts — measured
  read from the mount and listed as authenticated. The XDG redirect makes both true.
- **Claude forwards a token and never reads the Keychain.** `CLAUDE_CODE_OAUTH_TOKEN` and
  `ANTHROPIC_API_KEY` go in **bare**: `container run -e VAR` with no `=value` takes the
  value from the calling process's environment, measured working through
  `$SHELL -l -i -c` — the pane grove already builds. The value comes from the user's own
  shell profile, never appears in argv or `ps`, and is the channel Anthropic documents for
  containers. `CLAUDE_CONFIG_DIR` additionally reaches `.credentials.json`, the store
  Claude Code uses when the Keychain rejects the write.
- **Grove refuses.** `sandboxed` + `kind: 'claude'` + no credential reachable →
  `no-sandbox` naming `claude setup-token`. OpenCode cannot reach that state. grove probes
  the login-shell env rather than attempting a run, because a bare `-e VAR` for an absent
  variable **does not fail the run** (measured, exit 0).

grove cannot distinguish a one-year `setup-token` from a short-lived one, and Anthropic's
own container guidance prefers short-lived, repository-scoped tokens. It therefore **names
the variable it forwards**; the naming is the whole mitigation.

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
gains `spoolDir` and `opencodePaths`. `envFor` and `readOnlyPathsFor` both take the agent
kind now, since D8's config pointers and credential carve-outs are per-agent.

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
envFor(kind, session, o: { paths: AgentPaths }): Record<string, string>  // incl. GIT_CONFIG_*, D8
loginShellCredential(kind, o: { shell: string }): Promise<string | null>  // D8 probe, or null
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

**D8. A sandboxed session authenticates through each agent's own supported channel —
a config pointer at the paths grove already mounts, plus the env var for a credential
that exists nowhere on disk — and grove refuses `no-sandbox` rather than opening a pane
that cannot log in** ([ADR 0040](../../adr/0040-sandboxed-sessions-authenticate-through-the-agents-own-channel.md)).
- Measured, in the real container, after slice 1 left "Slice 1 settles both" unfulfilled:
  the Claude TUI reached `Not logged in · Please run /login`, and OpenCode completed two
  prompts with `0 credentials` and no `auth.json` before or after.
- The mechanism is not what § Risks assumed. Claude Code keeps its OAuth token in the
  **macOS Keychain**, which a Linux VM cannot read. OpenCode's Zen free tier is gated on
  the client being opencode, not on a credential at all — a raw curl to
  `opencode.ai/zen/v1` gets `403 FreeTierError`, and this Mac has no `auth.json`, no
  `credential` row in `opencode.db`, no keychain entry and no `OPENCODE_API_KEY`.
- The cause of *both* is that the container's `HOME` is `/root`: the config volumes grove
  has always mounted were present and unread. One env var per agent fixes it
  (`CLAUDE_CONFIG_DIR`; `XDG_DATA_HOME`/`XDG_CONFIG_HOME`), each documented by its own
  agent, measured working, and reusing mounts that already exist.
- **Reading the Keychain is rejected on cited grounds, not taste.** It appears in no
  Anthropic documentation; Claude Code creates the item with no `-T`/`-A`, so any
  same-user process can read it — reported to Anthropic (Silverfort, HackerOne 2026-06-25)
  as *"any macOS process can read stored credentials"*, and Anthropic **confirmed they are
  tightening that ACL**. It is also conditionally unavailable (locked keychain after
  reboot or under FileVault, keychain password out of sync, no Aqua session, a
  `CLAUDE_CONFIG_DIR` session reading a different item, a Data Protection keychain entry
  invisible to `security`). grove's read would break as a silent, remote change.
- The channel chosen is Anthropic's documented one for containers, which is **stated to
  take precedence over Keychain-stored credentials** and is expected to live in a shell
  profile. Forwarded **bare**, so the value comes from the pane's login shell and never
  enters argv or `ps`.
- Consequence grove carries: **`.credentials.json`, `settings.json` and `auth.json` become
  read-only carve-outs.** Each is authority rather than state — a writable one lets a
  sandboxed agent rewrite the human's login, or install a `settings.json` hook that runs
  in every later *unsandboxed* session, which is exactly why `~/.gitconfig` is already
  read-only.
- Rejected: **grove reads the Keychain** (above); **grove writes a credential file from
  it** (converts an ephemeral env var into a durable secret at rest, readable by the
  sandbox — strictly worse than what it replaces); **a token baked into the image** (the
  image is content-addressed by grove, so the secret would ship in the shared tag);
  **a one-time interactive login inside the container** (measured dead — it writes to
  `/root`, destroyed on exit, so *every* session would have to log in again).

## Two-way decisions

| Decision | Choice |
|---|---|
| Default | Off; every existing session launches as today |
| Entry points | `--sandboxed` (CLI) and **New sandboxed session** (palette → ⌘T kind list) |
| Refusals | Terminal kind, missing `container`, failed build, undiscoverable bridge, no reachable Claude credential → `no-sandbox`; never a silent fallback |
| Credential check | grove probes the login-shell env (`$SHELL -l -i -c`, the interpreter the pane uses) rather than attempting a run, because a bare `-e VAR` for an absent variable does not fail the run |
| Credential visibility | grove **names the variable it forwards** on the card and in the `no-sandbox` message; it cannot tell a one-year `setup-token` from a short-lived one, so transparency is the mitigation |
| Marker | A tag on the session card; not part of the label |
| Mount mode | Read-write, except OpenCode's state dir, `~/.gitconfig`, a worktree's `.git/hooks` + `.git/config`, grove's own CLI bundle (D7), and — per D8 — `settings.json`, `.credentials.json` and `auth.json`: the files that carry authority rather than state. `binDir` stays unmounted — the host launcher is macOS-only and has no business inside |
| Agent config | `CLAUDE_CONFIG_DIR` / `XDG_DATA_HOME` + `XDG_CONFIG_HOME` point at the mounts grove already has (D8). **Consequence, accepted:** a sandboxed agent now gets the host's settings, plugins, skills, commands and history, which until now it silently did not |
| Worktrees | Supported by D2 — the worktree **and** its repo's common dir, host-identical, hooks/config read-only. Slice 1 verified `git rev-parse --show-toplevel`, `core.hooksPath` neutralisation and a real `git commit` landing on the host for a **plain checkout**; the worktree form is still unverified and repeats with `--worktree --branch probe --sandboxed` |
| Git hooks | Neutralised by env: `GIT_CONFIG_COUNT=1`, `KEY_0=core.hooksPath`, `VALUE_0=<empty dir in the image>`. Command-line scope, beating `~/.gitconfig` and `.git/config` for every git call in the pane. A repo that legitimately uses `core.hooksPath` stops running hooks inside the sandbox — the same class of divergence as shipping no rc files |
| Shared-service bind | Grove writes the bridge address, **with a consent prompt** the first time |
| Git push | No SSH agent or credential helper inside: a grove choice, not a container limit. Commit locally, push from the host |

## Risks

- **A token inside the VM is plaintext in the agent's environment.** Inherent to a sandboxed
  agent that can reach a model at all, and not new host exposure — the pane's login shell
  already carries it. Anthropic's container guidance prefers short-lived,
  repository-scoped tokens and grove cannot tell one from a `setup-token`'s one-year token,
  hence the naming rather than enforcement.
- **`.claude` and `.config/opencode` become reachable for the first time** (D8): mounted
  all along, inert. The agent can now read your Claude history and transcripts for every
  project and write into them. Only the three authority files are carved out.
- **Rebinding the shared service.** D6 moves it onto the container bridge — private, but
  machine-wide, hence consent.
- **`--read-only-path` is Experimental**, and its cases are measured: an **absent** path is
  tolerated (covering a missing `~/.gitconfig`, and a missing `auth.json` on a machine with
  no host login), and **two nested carve-outs in one read-write volume** work together.
  Slice 1 asserts both.
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