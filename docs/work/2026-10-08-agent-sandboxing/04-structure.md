---
feature: 2026-10-08-agent-sandboxing
phase: structure
status: draft
version: 1
created: 2026-10-09
updated: 2026-10-09
based_on:
  - 03-design.md@1
forced: []
---

# Agent session sandboxing — structure

## Slices

### Slice 1 — Tracer: `grove new claude --sandboxed` runs the agent inside the sandbox

- **Outcome:** a session created with `--sandboxed` runs its Claude process
  inside an Apple `container` VM. Inside, the working directory, `~/.claude`,
  `~/.gitconfig`, the hook spool and the Grove socket are at their host paths and
  nothing else of the host is; the hooks still append to the host spool, so the
  session's status and writes work in grove exactly as an unsandboxed one.
  Every session created without the flag launches exactly as it does today.
  Settles the credentials and single-file socket-mount risks.
- **Files:** `resources/sandbox/Dockerfile` (NEW);
  `src/core/sandbox/{spec,image,argv}.ts` + tests (NEW);
  `src/shared/types.ts`, `src/core/sessions.ts`,
  `src/core/store/stateStore.ts` (v7→v8, v8);
  `src/core/core.ts` (seam in `sessionCreate`, `sessionEnv.spoolDir`);
  `src/main/index.ts`, `src/shared/cli.ts`, `src/main/cliServer.ts`,
  `src/cli/{args,index}.ts`.
- **Signatures:** `mountsFor`, `envFor`, `sandboxArgv`, `imageRef`, `ensureImage`.
- **Verify:** `npm test` (`sandbox/spec.test.ts`, `sandbox/argv.test.ts`,
  `sandbox/image.test.ts`, `stateStore.test.ts` v7→v8, `sessionCreate.test.ts`
  asserting the container argv, `cliEnv.test.ts` unchanged for unsandboxed
  sessions, `cli/args.test.ts`, `cliServer.test.ts`); `npm run typecheck`;
  manual in `npm run dev`: `grove new claude --sandboxed --prompt "print pwd"`,
  then in the pane — `ls $PWD` is the project, `touch` a file there and it
  appears in grove's diff, `echo x > ~/Library/nope` fails, `grove ls` from
  inside the pane answers, `curl api.anthropic.com` succeeds while a host
  loopback port does not (recording the network posture D5 assumes), and the
  session card shows a status.
- **Depends on:** none.

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

### Slice 5 — Failing loudly instead of running unguarded

- **Outcome:** asking for a sandbox that cannot be had fails with `no-sandbox`
  and a message that says what to do — a non-Claude kind; `container` not
  installed or its system not started; the image build failing. No path silently
  starts an unsandboxed pane.
- **Files:** `src/core/sandbox/image.ts`, `src/core/core.ts` (`sessionCreate`
  guard), `src/main/cliServer.ts` (message map), `src/renderer/src/App.tsx`
  (error surface).
- **Signatures:** `sandboxAvailability(container): Promise<{ ok; error? }>`.
- **Verify:** `npm test` (`sessionCreate.test.ts` with a missing binary and with
  `kind: 'opencode'` → `no-sandbox`; `cliServer.test.ts` message mapping);
  `npm run typecheck`; manual: `grove new opencode --sandboxed` prints a clear
  error and creates no session; with `container` stopped, the same.
- **Depends on:** 1, 4.

## Deferred

- **OpenCode in the sandbox** — needs a per-session service with a published
  port; the per-kind mount table is already shaped for it.
- **Egress allow-list** (ADR 0036) — its own feature; additive to this argv
  shape.
- A new-session dialog with a checkbox, instead of a second palette command.
- A project-level "always sandbox" default; sandboxing terminal sessions.
- Installing `container`, or running `container system start` for the human.
- Container resource limits and image updates after the tag is built.

## Rollout / migration

State file v7 → v8 on first launch (slice 1): every saved session gains
`sandboxed: false` and launches exactly as before. No downgrade path — an older
build moves a v8 file aside as unknown, as with ADR 0029.

Sandboxing needs Apple Silicon, a recent macOS, the `container` CLI installed and
its system started. Grove installs none of that: it reports `no-sandbox` with the
command to run, and never falls back to an unsandboxed session.

## Open questions

None.