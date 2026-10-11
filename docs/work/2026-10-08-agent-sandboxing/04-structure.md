---
feature: 2026-10-08-agent-sandboxing
phase: structure
status: approved
version: 4
created: 2026-10-09
updated: 2026-10-11
approved_at: 2026-10-11
based_on:
  - 03-design.md@7
forced: []
---

# Agent session sandboxing — structure

## Slices

### Slice 1 — Tracer: a sandboxed Claude session runs end to end

- **Outcome:** `grove new claude --sandboxed` runs the agent inside an Apple
  `container` VM. Inside, the working directory, `~/.claude`, `~/.gitconfig`, the
  hook spool and the Grove socket are at their host paths and nothing else of the
  host is; hooks still append to the host spool, so status and writes work in
  grove exactly as unsandboxed. The agent can also run grove's own CLI, which
  D7 mounts read-only. Sessions created without the flag are unchanged.
  Settles the credentials and single-socket-mount risks.
- **Files:** `resources/sandbox/Dockerfile` (NEW, including the `grove` shim);
  `src/core/sandbox/{spec,image,argv}.ts` + tests (NEW); `src/shared/types.ts`,
  `src/core/sessions.ts`, `src/core/store/stateStore.ts` (v8→v9, v9);
  `src/core/core.ts` (seam, `sessionEnv` paths); `src/main/index.ts`,
  `src/shared/cli.ts`, `src/main/cliServer.ts`, `src/cli/{args,index}.ts`;
  `package.json` (`asarUnpack`).
- **Signatures:** `mountsFor`, `envFor`, `sandboxArgv`, `imageRef`, `ensureImage`,
  plus `gitCommonDir(dir): string | null` reused from
  `2026-10-08-worktree-support` (do not reimplement it).
- **Verify:** `npm test` (`sandbox/{spec,argv,image}.test.ts`,
  `stateStore.test.ts` v8→v9, `sessionCreate.test.ts` asserting the container
  argv, `cliEnv.test.ts` unchanged for unsandboxed, `cli/args.test.ts`,
  `cliServer.test.ts`); `npm run typecheck`; manual in `npm run dev`:
  `grove new claude --sandboxed --prompt "print pwd"`, then in the pane —
  `ls $PWD` is the project, a `touch` there appears in grove's diff,
  `echo x > ~/Library/nope` fails, **`grove ls` answers**, `curl api.anthropic.com`
  succeeds while a host loopback port does not (the posture D5 assumes), and
  the card shows a status. **Then in the same pane: `git rev-parse
  --show-toplevel` matches and a real `git commit` lands** — the obligation
  ADR 0038 left, and the one this design previously failed to state. *(Both the
  socket mount and this git check are already measured at the mount-mechanics
  level on 2026-10-10; slice 1 repeats them driven by the real agent.)* Once
  worktree support lands, repeat with `--worktree --branch probe --sandboxed`
  and confirm git still works there, with `hooks/`/`config` read-only and a
  host hook not running (`core.hooksPath` neutralised).
- **Depends on:** nothing for the base path; the worktree path waits on
  `gitCommonDir` from `2026-10-08-worktree-support` slice 1.

### Slice 2 — Resume stays sandboxed

- **Outcome:** a gone sandboxed session resumes inside the sandbox, using its
  stored working directory, mounts and agent session id. Never widens silently.
- **Files:** `src/core/core.ts` (`sessionResume` seam), `src/core/sessions.ts`.
- **Signatures:** unchanged; `sessionResume` reads `session.sandboxed`.
- **Verify:** `npm test` (`sessionCreate.test.ts` resume case asserts
  `container run` argv and that an unsandboxed resume still has none);
  `npm run typecheck`; manual: end a sandboxed session, resume it, and confirm
  in the pane that a write outside the project still fails.
- **Depends on:** 1.

### Slice 3 — Opting in from the UI, and seeing it on the card

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
- **Depends on:** 1.

### Slice 4 — Teardown, and pruning what a crash left behind

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
- **Depends on:** 1.

### Slice 5 — OpenCode in the sandbox, joining the host's service (D6)

- **Outcome:** `grove new opencode --sandboxed` runs an OpenCode session that
  joins the host's shared service over the container bridge instead of starting
  its own. The host's service is bound to the **bridge address only** once, on
  the first such session — never `0.0.0.0` — so it is not exposed on the LAN;
  if the bridge cannot be discovered the create fails `no-sandbox`. The
  container's `service.json` is read-only, so the sandbox can never evict the
  host's service. grove's status, waiting and linking for every other OpenCode
  session keep working.
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
- **Depends on:** 1, 2.

### Slice 6 — Failing loudly instead of running unguarded

- **Outcome:** asking for a sandbox that cannot be had fails with `no-sandbox`
  and a message saying what to do — a terminal kind; `container` not installed or
  its system not started; the image build failing. No path silently starts an
  unsandboxed pane.
- **Files:** `src/core/sandbox/image.ts`, `src/core/core.ts` (`sessionCreate`
  guard), `src/main/cliServer.ts` (message map), `src/renderer/src/App.tsx`.
- **Signatures:** `sandboxAvailability(container): Promise<{ ok; error? }>`.
- **Verify:** `npm test` (`sessionCreate.test.ts` with a missing binary and with
  `kind: 'terminal'` → `no-sandbox`; `cliServer.test.ts` message mapping);
  `npm run typecheck`; manual: `grove new terminal --sandboxed` prints a clear
  error and creates no session; with `container` stopped, the same.
- **Depends on:** 1, 4.

## Deferred

- **Egress allow-list** (ADR 0036) — its own feature; additive to this argv shape.
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

Slice 5 changes one thing outside grove: the shared OpenCode service is bound to
the container bridge address so containers can reach it (D6). It stays
password-authenticated, is not exposed on the LAN, and grove makes the change
once, on the first sandboxed OpenCode session.

## Open questions

None.