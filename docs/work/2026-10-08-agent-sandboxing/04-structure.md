---
feature: 2026-10-08-agent-sandboxing
phase: structure
status: approved
version: 5
created: 2026-10-09
updated: 2026-10-11
approved_at: 2026-10-11
based_on:
  - 03-design.md@8
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
  grove action beyond the pointer. `settings.json`, `.credentials.json` and `auth.json`
  are read-only, so the agent can read the human's authority but never rewrite it. When no
  credential is reachable, the create fails `no-sandbox` naming `claude setup-token`
  instead of opening a pane that dead-ends.
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
  `settings.json` demonstrably applies inside; writing to `settings.json` or
  `.credentials.json` from inside gives EROFS; `opencode auth list` inside a sandboxed
  opencode pane lists the host's provider; and with `CLAUDE_CODE_OAUTH_TOKEN` and
  `ANTHROPIC_API_KEY` unset, the create fails with the message naming
  `claude setup-token`.
- **Depends on:** 1.

### Slice 3 — Resume stays sandboxed

- **Outcome:** a gone sandboxed session resumes inside the sandbox, using its
  stored working directory, mounts and agent session id. Never widens silently.
- **Files:** `src/core/core.ts` (`sessionResume` seam), `src/core/sessions.ts`.
- **Signatures:** unchanged; `sessionResume` reads `session.sandboxed`.
- **Verify:** `npm test` (`sessionCreate.test.ts` resume case asserts the full container
  argv, D8's pointers included, and that an unsandboxed resume still has none);
  `npm run typecheck`; manual: end a sandboxed session, resume it, confirm in the pane
  that a write outside the project still fails and that the login gate is cleared.
- **Depends on:** 1, 2.

### Slice 4 — Opting in from the UI, and seeing it on the card

- **Outcome:** ⌘K lists **New sandboxed session**, which opens the existing ⌘T
  kind list in sandboxed mode and starts a sandboxed session; a session card
  shows a sandbox tag naming what is isolated (the filesystem).
- **Files:** `src/shared/ipc.ts`, `src/main/ipc.ts`,
  `src/renderer/src/{paletteItems,App}.tsx`,
  `src/renderer/src/components/{ListRow,SessionCard}.tsx` (whichever renders it).
- **Signatures:** `newSessionItems(projects, projectId, sandboxed, create)`,
  `MenuAction` `'newSandboxedSession'`, `'session:create'` gains
  `sandboxed?: boolean`.
- **Verify:** `npm test` (`paletteItems.test.ts` — the new command and that
  `newSessionItems` passes the flag through); `npm run typecheck`; manual in
  `npm run dev`: ⌘K → New sandboxed session → Claude Code starts sandboxed, and
  its card carries the tag; ⌘T still starts a plain session.
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

- **Outcome:** `grove new opencode --sandboxed` runs an OpenCode session that
  joins the host's shared service over the container bridge instead of starting
  its own. The host's service is bound to the **bridge address only** once, on
  the first such session — never `0.0.0.0` — so it is not exposed on the LAN;
  if the bridge cannot be discovered the create fails `no-sandbox`. The
  container's `service.json` is read-only, so the sandbox can never evict the
  host's service. grove's status, waiting and linking for every other OpenCode
  session keep working. Authentication is slice 2's, not this slice's.
- **Files:** `src/core/sandbox/service.ts` + test (NEW),
  `src/core/sandbox/spec.ts` (read-only paths), `src/main/index.ts`
  (`AgentPaths`), `src/core/core.ts` (bind on first sandboxed OpenCode).
- **Signatures:** `ensureServiceReachable({ configFile, bridge })`,
  `readOnlyPathsFor(kind, paths)`.
- **Verify:** `npm test` (`sandbox/service.test.ts` — writes the discovered
  bridge address once, is idempotent, refuses when the bridge is unknown, never
  writes `0.0.0.0`, never touches the registration file; `sandbox/spec.test.ts`
  — `--read-only-path` for the state dir and not for the rest);
  `npm run typecheck`; manual in `npm run dev`: start an unsandboxed OpenCode
  session, note its status; start a sandboxed one, send it a prompt, confirm
  **both** show status, `lsof -nP -iTCP -a -p $(pgrep -f 'opencode serve') -sTCP:LISTEN`
  shows the bridge address and not `*`, the host's LAN address refuses, and
  `stat` on the host's `service.json` is unchanged.
- **Depends on:** 1, 2, 3.

### Slice 7 — Failing loudly instead of running unguarded

- **Outcome:** asking for a sandbox that cannot be had fails with `no-sandbox`
  and a message saying what to do — a terminal kind; `container` not installed or
  its system not started; the image build failing; no credential reachable for a
  Claude session. No path silently starts an unsandboxed pane, and no path opens
  a pane that cannot log in.
- **Files:** `src/core/sandbox/image.ts`, `src/core/core.ts` (`sessionCreate`
  guard), `src/main/cliServer.ts` (message map), `src/renderer/src/App.tsx`.
- **Signatures:** `sandboxAvailability(container): Promise<{ ok; error? }>`.
- **Verify:** `npm test` (`sessionCreate.test.ts` with a missing binary and with
  `kind: 'terminal'` → `no-sandbox`; with the auth probe returning null → `no-sandbox`;
  `cliServer.test.ts` message mapping, including the credential message naming
  `claude setup-token`); `npm run typecheck`; manual: `grove new terminal
  --sandboxed` prints a clear error and creates no session; with `container`
  stopped, the same; with no credential in the shell, the same for claude.
- **Depends on:** 1, 2, 5.

## Deferred

- **Egress allow-list** (ADR 0036) — its own feature; additive to this argv shape.
- Reading the macOS Keychain to obtain a Claude token — rejected on cited grounds in
  ADR 0040, and **not** to be revisited when Anthropic's ACL hardening lands: D8 never
  depends on that read, so the change costs grove nothing.
- Short-lived or repository-scoped credentials: grove names the variable it forwards but
  cannot enforce a lifetime. Claude Code's own `apiKeyHelper` and Workload Identity
  Federation are the upstream answers if grove ever needs to push here.
- A new-session dialog with a checkbox, instead of a second palette command.
- A project-level "always sandbox" default; sandboxing terminal sessions.
- Installing `container`, or running `container system start` for the human.
- Container resource limits and image updates after the tag is built.
- Publishing the image to a registry instead of building it locally.

## Rollout / migration

State file v8 → v9 on first launch (slice 1): every saved session gains
`sandboxed: false` and launches exactly as before. (v9, not v8: v8 shipped for
`workflowStatus`.) No downgrade path — an older build moves a v9 file aside as
unknown, as with ADR 0029.

Sandboxing needs Apple Silicon, a recent macOS, the `container` CLI installed and
its system started. Grove installs none of that: it reports `no-sandbox` with the
command to run, and never falls back to an unsandboxed session.

Slice 2 adds one more prerequisite, and it is the only one grove can check for a
human: a Claude credential reachable from the login shell. `claude setup-token`
puts one there; grove names the variable in the refusal and on the card rather than
quietly forwarding it.

Slice 6 changes one thing outside grove: the shared OpenCode service is bound to
the container bridge address so containers can reach it (D6). It stays
password-authenticated, is not exposed on the LAN, and grove makes the change
once, on the first sandboxed OpenCode session.

## Open questions

None.
