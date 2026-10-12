---
feature: 2026-10-08-agent-sandboxing
phase: structure
status: approved
version: 7
created: 2026-10-09
updated: 2026-10-12
approved_at: 2026-10-12
based_on:
  - 03-design.md@10
forced: []
---

# Agent session sandboxing — structure

## Slices

### Slice 1 — Tracer: a sandboxed Claude session runs end to end — DONE (58c4e1f)

- **Outcome:** `grove new claude --sandboxed` runs the agent inside an Apple
  `container` VM. Inside, the working directory, the hook spool and the Grove socket are
  at their host paths and nothing else of the host is; hooks still append to the host
  spool, so status and writes work in grove exactly as unsandboxed. The agent can also run
  grove's own CLI, which D7 mounts read-only. Sessions created without the flag are
  unchanged. A real `git commit` inside lands on the host.
  **It did not settle the credential risk** — it could not; the mechanism was Keychain-only
  and the config volumes turned out to be inert. That is slice 2.
- **Files:** `resources/sandbox/Dockerfile` (NEW, including the `grove` shim);
  `src/core/sandbox/{spec,image,argv}.ts` + tests (NEW); `src/shared/types.ts`,
  `src/core/sessions.ts`, `src/core/store/stateStore.ts` (v8→v9, v9);
  `src/core/core.ts` (seam, `sessionEnv` paths); `src/main/index.ts`,
  `src/shared/cli.ts`, `src/main/cliServer.ts`, `src/cli/{args,index}.ts`;
  `package.json` (`asarUnpack`).
- **Signatures:** `mountsFor`, `envFor`, `sandboxArgv`, `imageRef`, `ensureImage`,
  plus `gitCommonDir(dir): string | null` reused from
  `2026-10-08-worktree-support` (do not reimplement it).
- **Verify:** `npm test` (832 passing); `npm run typecheck`. Manual, measured 2026-10-11
  and recorded in `06-implementation.md`: grove's composed argv matches the design's
  Container spec; working directory at the host path; `~/.ssh` absent; a write outside the
  mount set does not reach the host; **`grove ls` answers from inside**; egress to
  `api.anthropic.com` returns 401 while host loopback refuses; `~/.gitconfig` and the CLI
  bundle are byte-identical after write attempts; `git rev-parse --show-toplevel` matches,
  `core.hooksPath` is neutralised, and a real `git commit` landed on the host's `master`.
- **Depends on:** nothing for the base path; the worktree path waits on
  `gitCommonDir` from `2026-10-08-worktree-support` slice 1.

### Slice 2 — A sandboxed session authenticates, or grove refuses (D8)

- **Outcome:** a sandboxed session gets past the login gate and completes a real prompt.
  The container's config pointers reach the host config grove **already** mounts, so the
  agent has the host's settings, plugins, skills and commands — and a host
  `opencode auth login` (GitHub Copilot, or any provider) works inside the sandbox with no
  grove action beyond the pointer. `settings.json`, `.credentials.json` and `auth.json` are
  carved out read-only, so the agent can read the human's authority and, **for a file the
  host actually has**, cannot rewrite it. When no credential is reachable, the create fails
  `no-sandbox` naming `claude setup-token` instead of opening a pane that dead-ends.
- **Measured caveat, now in the design (v9, D8):** `--read-only-path` enforces nothing for
  an absent target. `settings.json` exists and is enforced; `.credentials.json` does not
  exist on a Mac that keeps its login in the Keychain, so that carve-out does not bind
  there. The human chose to keep the mechanism and document the limitation — grove's own
  `no-sandbox` refusal plus Anthropic's credential precedence leave no reachable case where
  it bites. Not a slice defect, and not a slice-2 fix.
- **Files:** `src/core/sandbox/spec.ts` (`envFor` takes the kind; three carve-outs in
  `readOnlyPathsFor`), `src/core/sandbox/auth.ts` + test (NEW — the login-shell probe),
  `src/core/core.ts` (`sessionCreate` guard), `src/main/cliServer.ts` (`MESSAGES`),
  `src/renderer/src/App.tsx`, `src/renderer/src/components/SessionCard.tsx` (names the
  forwarded variable).
- **Signatures:** `envFor(kind, session, { paths })` gains the config pointers and the bare
  `-e` token forwards; `loginShellCredential(kind, { shell }): Promise<string | null>`.
- **Verify:** `npm test` — `sandbox/spec.test.ts` asserts `CLAUDE_CONFIG_DIR` for claude and
  `XDG_DATA_HOME`/`XDG_CONFIG_HOME` for opencode and **not** the other kind's, the three
  carve-outs, and that bare `-e` carries no `=value`; `sandbox/auth.test.ts` against a fake
  `$SHELL` script that prints set/unset, for each kind; `sessionCreate.test.ts` refuses
  `no-sandbox` when the probe returns null and succeeds when it returns a value;
  `cliServer.test.ts` maps the new message; `npm run typecheck`. **Manual, and it must be
  run under a real controlling TTY** — `container run -i -t` fails with ENODEV without one,
  which looks exactly like a broken mount subsystem, so use a real tmux pane via
  `npm run dev` or wrap the run in `script -q /dev/null`: `grove new claude --sandboxed
  --prompt "print pwd"` renders the TUI **past** the login screen and answers; the host's
  `settings.json` demonstrably applies inside; writing to `~/.claude/.credentials.json`
  from inside gives EROFS **on this host, where that file exists**; `opencode auth list`
  inside a sandboxed opencode pane lists the host's provider; and with
  `CLAUDE_CODE_OAUTH_TOKEN` and `ANTHROPIC_API_KEY` unset, the create fails with the
  message naming `claude setup-token`.
- **Depends on:** 1.

### Slice 3 — Resume stays sandboxed, and a downgrade says so — DONE (182c9a6)

- **Outcome:** a gone sandboxed session resumes inside the sandbox, using its stored
  working directory, mounts and agent session id. It never widens silently — and the
  half of that which is not the argv **says so**: `sessionResume` sets a **live-only
  `Session.sandboxNote`**, stripped in `set()` with the other live fields so it never
  reaches `state.json`, and the card renders a danger-toned **shield-off, "Not
  sandboxed"** from `sandboxView(session)` (`src/renderer/src/sessionStatus.ts`), the one
  place that decides what the mark shows. A live sandbox wins over a stale note.
- **Files:** `src/core/core.ts` (`sessionResume` seam), `src/shared/types.ts`
  (`sandboxNote`), `src/renderer/src/sessionStatus.ts` (`sandboxView`),
  `src/renderer/src/components/{SessionMeta,SandboxMark}.tsx` + its module css, and a
  `shield-off` glyph in `ui/Icon.tsx`. `src/core/sessions.ts` needed no change.
- **Signatures:** `sessionResume` reads `session.sandboxed`;
  `sandboxView(session): 'sandboxed' | 'lost' | 'none'`; `SandboxMark` takes the session,
  not a bare boolean.
- **Verify:** `npm test` — 876 passed / 78 files; `npm run typecheck`; `npm run build`.
  Manual, measured 2026-10-11 against the **real** `container` binary, the real Dockerfile
  and the real login shell: a resume with the image buildable keeps `sandboxed: true` and
  sets **no** note; a resume with the Dockerfile moved aside yields `sandboxed: false`, a
  `sandboxNote`, and a host-side pane argv — and `state.json` afterwards carries
  `sandboxed` only. The mark's actual markup was rendered and checked for all three
  states, dense (grid pane) included.
- **Depends on:** 1, 2.

### Slice 4 — Opting in from the UI, and seeing it on the card

- **Outcome:** the **new-session dialog carries a sandboxed checkbox**; a session card
  shows a sandbox tag naming what is isolated (the filesystem). **A human decision,
  2026-10-11**, taken after reviewing the form this slice originally specified — ⌘K
  listing a second "New sandboxed session" command that reuses the ⌘T kind list — and
  recorded here rather than swapped in silently: `MenuAction 'newSandboxedSession'` and
  the palette command **are not built**. ⌘T still starts a plain session.
- **Files:** `src/shared/ipc.ts`, `src/main/ipc.ts`,
  `src/renderer/src/components/NewSessionDialog.tsx` (the checkbox),
  `src/renderer/src/{paletteItems,App}.tsx`,
  `src/renderer/src/components/{ListRow,SessionCard}.tsx` (whichever renders the tag).
- **Signatures:** `'session:create'` gains `sandboxed?: boolean`;
  `newSessionItems(projects, projectId, sandboxed, create)` keeps the flag it already
  takes and the dialog reads it. No new `MenuAction`.
- **Verify:** `npm test` — `paletteItems.test.ts` asserts ⌘K still lists **no** sandboxed
  command and that a plain new session is unchanged, plus the dialog's flag-through;
  `npm run typecheck`; manual in `npm run dev`: ⌘K → New session → tick the box →
  Claude Code starts sandboxed and its card carries the tag; unticked, an ordinary
  session.
- **Depends on:** 1, 2.

### Slice 5 — Teardown, and pruning what a crash left behind

- **Outcome:** removing or killing a sandboxed session removes its container, so
  a session cannot leave a running VM; containers named `grove-*` with no live
  session are pruned when the app starts.
- **Files:** `src/core/sandbox/container.ts` + test (NEW), `src/core/core.ts`
  (`sessionKill`, `sessionRemove`, `start`).
- **Signatures:** `removeContainer(container, name)`,
  `pruneContainers(container, live)`.
- **Verify:** `npm test` (`sandbox/container.test.ts` against a fake `container`
  script on PATH — removes a named container, tolerates "no such container",
  prunes only `grove-*` names absent from the live set); `npm run typecheck`;
  manual in `npm run dev`: start a sandboxed session, ⌘W it, `container list`
  shows nothing; then `container run -d --name grove-orphan sleep 600`, restart
  the app, and it is gone.
- **Depends on:** 1, 2.

### Slice 6 — OpenCode in the sandbox, joining the host's service (D6)

- **Outcome:** `grove new opencode --sandboxed` runs an OpenCode session that joins the
  host's shared service over the container bridge instead of starting its own. grove runs
  `container system start` (idempotent), **waits for `bridge100` to exist**, **discovers**
  the gateway from `container network ls --format json` (`.status.ipv4Gateway` of network
  `default`, never hardcoded — a network on another subnet yields another gateway), then
  writes the bind address once into the service config — **never `0.0.0.0`** — and hands
  the container `OPENCODE_SERVER_PASSWORD` taken from the registration file, **and composes
  the container's `--server http://<bridge>:<port>` itself — the discovered gateway plus the
  registration's port.** The registration's own `url` names the host's loopback, so a client
  left to find the service falls back to `service.ensure` and dies with `EADDRNOTAVAIL`
  binding an address it may only connect to (measured 2026-10-12; `06-implementation.md`).
  **A machine with no host service registration is refused `no-sandbox`** — there is no port
  to compose a URL from, and nothing to join, since the read-only state dir stops the
  container starting its own (human, 2026-10-12). The
  container's `~/.local/state/opencode` stays read-only, so the sandbox can never evict
  the host's service. grove's status, waiting and linking for every other OpenCode
  session keep working. Authentication is slice 2's, not this slice's.
- **Files:** `src/core/sandbox/service.ts` + test (NEW — readiness wait, gateway
  discovery, the one-time bind), `src/core/sandbox/spec.ts` (read-only paths;
  `OPENCODE_SERVER_PASSWORD`), `src/main/index.ts` (`AgentPaths`), `src/core/core.ts`
  (bind on the first sandboxed OpenCode), `resources/sandbox/Dockerfile`
  (`@opencode/cli` in place of `opencode-ai`, pinned independently of the host's version).
- **Signatures:** `ensureServiceReachable({ configFile, container })` returning the gateway,
  `serviceEndpoint({ registrationFile, gateway }): { url; password } | null`,
  `readOnlyPathsFor(kind, paths)`.
- **Verify:** `npm test` — `sandbox/service.test.ts` against a fake `container` script on
  PATH: runs `system start`, polls `network ls` until a gateway appears, writes **that**
  address, is idempotent, retries then refuses once the budget is spent, never writes
  `0.0.0.0`, never touches the registration file; **and composes `http://<bridge>:<port>`
  from that gateway and the registration's `url`, with its `password`, or `null` when there
  is no registration**; `sandbox/spec.test.ts` —
  `--read-only-path` for the state dir and not for the rest, `OPENCODE_SERVER_PASSWORD`
  present for opencode and absent for claude; `npm run typecheck`. Manual in
  `npm run dev`: start an unsandboxed OpenCode session and note its status; start a
  sandboxed one and send it a prompt; confirm **both** show status, that
  `lsof -nP -iTCP -a -p $(pgrep -f 'opencode serve') -sTCP:LISTEN` shows the bridge address
  and not `*`, that the host's LAN address refuses, and that `stat` on the host's
  `service.json` is unchanged. **Then the cross-version check the spikes leave open:** the
  image's `@opencode/cli` client against the host's v2 service over `--server`, and
  `opencode auth list` inside a sandboxed pane listing the host's provider.
- **Depends on:** 1, 2, 3.

### Slice 7 — Failing loudly instead of running unguarded

- **Outcome:** asking for a sandbox that cannot be had fails with `no-sandbox`
  and a message saying what to do — a terminal kind; `container` not installed;
  the image build failing; a bridge still undiscoverable **after the retry budget**
  (D6 — grove starts the system itself, so "not started" is no longer a refusal);
  **no host OpenCode service registered, for a sandboxed OpenCode (D6, human 2026-10-12 —
  no port to compose a URL from and nothing to join)**; and
  no credential reachable for a Claude session. No path silently starts an
  unsandboxed pane, and no path opens a pane that cannot log in.
- **Files:** `src/core/sandbox/image.ts`, `src/core/core.ts` (`sessionCreate`
  guard), `src/main/cliServer.ts` (message map), `src/renderer/src/App.tsx`.
- **Signatures:** `sandboxAvailability(container): Promise<{ ok; error? }>`.
- **Verify:** `npm test` (`sessionCreate.test.ts` with a missing binary and with
  `kind: 'terminal'` → `no-sandbox`; with the auth probe returning null → `no-sandbox`;
  `cliServer.test.ts` message mapping, including the credential message naming
  `claude setup-token`); `npm run typecheck`; manual: `grove new terminal
  --sandboxed` prints a clear error and creates no session; with `container`
  absent, the same; with no credential in the shell, the same for claude.
- **Depends on:** 1, 2, 5.

## Deferred

- **Egress allow-list** (ADR 0036) — its own feature; additive to this argv shape.
- **The strict carve-out**: a read-only `~/.claude` parent with writable re-binds per
  subdirectory, which holds for absent targets too. Measured, and declined by the human
  (2026-10-11) in favour of documenting the limitation (D8): it must track a third
  party's directory layout and fails **closed and loud**. It buys a broader guarantee —
  nothing in `~/.claude` writable but the allow-list — so it is a feature of its own.
- Reading the macOS Keychain to obtain a Claude token — rejected on cited grounds in
  ADR 0040, and **not** to be revisited when Anthropic's ACL hardening lands: D8 never
  depends on that read, so the change costs grove nothing.
- Short-lived or repository-scoped credentials: grove names the variable it forwards but
  cannot enforce a lifetime. Claude Code's own `apiKeyHelper` and Workload Identity
  Federation are the upstream answers if grove ever needs to push here.
- **Running the container as a non-root uid.** The container is `uid=0`, so every
  inherited host hook runs as root inside the VM; two guarded hook families make that
  harmless today, and an unguarded one would not be. Apple's `container` can take
  `--user`. Noted 2026-10-11, not decided.
- A project-level "always sandbox" default; sandboxing terminal sessions.
- Installing `container` for the human. grove *does* run `container system start` itself
  (idempotent) before waiting for the bridge — slice 6.
- Container resource limits and image updates after the tag is built.
- Publishing the image to a registry instead of building it locally.

## Rollout / migration

State file v8 → v9 on first launch (slice 1): every saved session gains
`sandboxed: false` and launches exactly as before. (v9, not v8: v8 shipped for
`workflowStatus`.) No downgrade path — an older build moves a v9 file aside as
unknown, as with ADR 0029.

Sandboxing needs Apple Silicon, a recent macOS and the `container` CLI installed. Grove
installs none of that: it reports `no-sandbox` with the command to run, and never falls
back to an unsandboxed session. From slice 6 it does start the container system itself,
idempotently, and waits for the bridge to appear.

Slice 2 adds one more prerequisite, and it is the only one grove can check for a
human: a Claude credential reachable from the login shell. `claude setup-token`
puts one there; grove names the variable in the refusal and on the card rather than
quietly forwarding it.

Slice 6 changes one thing outside grove: the shared OpenCode service is bound to the
container bridge address so containers can reach it, and the container is handed its
password (D6). It stays password-authenticated, is not exposed on the LAN, and grove
makes the change once, on the first sandboxed OpenCode session — after starting the
container system and waiting for the bridge, which **does not exist for the first ~2½
minutes after login** (measured 2m24s), so that first session waits rather than failing.

## Open questions

None.
