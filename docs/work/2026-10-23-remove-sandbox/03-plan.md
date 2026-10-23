---
feature: 2026-10-23-remove-sandbox
phase: plan
status: approved
version: 1
created: 2026-10-23
updated: 2026-10-23
approved_at: 2026-10-23
based_on: [01-outcome.md@1, 02-research.md@1]
forced: []
---

# Plan: remove the sandbox feature

## Decisions

### D1. How old sandboxed sessions leave the list

**Context.** The brief says sessions that were started in a sandbox are dropped from the list on upgrade. The state file is at schema version 9, and a file whose version is not the current one and has no migration is moved aside and replaced by empty state, which would wipe every session.

**Options.**
- A. Bump the state file to version 10 with a migration that removes every session whose `sandboxed` is true and strips the `sandboxed` field from the rest. Pros: follows the repo's existing pattern (nine migrations so far); the field is gone from stored data; one pure, testable function. Cons: an older Grove build can no longer read the file after upgrading.
- B. Keep version 9 and filter sandboxed sessions out when the file is loaded. Pros: older builds can still read the file. Cons: the stored data keeps the field and the old sessions until the next save; the filter would have to live forever.
- C. Keep version 9 and ignore the field. Pros: smallest change. Cons: old sandboxed sessions stay in the list, which contradicts the brief.

**Pick:** A

**Outcome impact.** After upgrading, sandboxed sessions are gone from the list and no trace of the field is stored. Downgrading to an older Grove build is not supported, as with every earlier version bump.

### D2. How the one-time cleanup runs and what it may remove

**Context.** The brief wants leftover containers, the built image and the OpenCode setting cleaned up once on first launch. The sandbox code that knows about them is being deleted, so the cleanup needs a small separate piece that exists only for the transition. "Once" needs a memory, and the cleanup must never touch anything that is not Grove's.

**Options.**
- A. A small separate module, run at startup, guarded by a marker file in Grove's own data folder that is written after the attempt finishes. It removes only containers whose name starts with `grove-` (the boundary the sandbox already used) and only images tagged `grove-sandbox:`. Pros: exactly once, independent of the state file; a machine without `container` simply finishes and records it; the module can be deleted in a later release. Cons: one more file in the data folder.
- B. Run the cleanup only when the state file was migrated from version 9 to 10. Pros: no marker. Cons: a machine where the cleanup failed or the migration ran in a test build is never retried; couples cleanup to the migration.
- C. Run the cleanup on every launch and let it find nothing to do. Pros: self-healing. Cons: spawns the `container` tool on every launch for ever; contradicts "a second launch does nothing".

**Pick:** A

**Outcome impact.** On first launch after upgrade the machine is tidied once; later launches do nothing. Containers that are still running are stopped, which ends the terminal panes of the dropped sessions.

### D3. When the OpenCode `service.json` is restored

**Context.** Grove wrote `hostname` (the container network gateway) into the user's own `service.json` so sandboxed OpenCode sessions could reach the host service, and never recorded the value. The brief says restore it only if it still holds the value Grove wrote. The file also holds `password` and `port` written by OpenCode, which must survive.

**Options.**
- A. Ask `container` for the default network's gateway now; if the file's `hostname` equals it, remove only the `hostname` key and keep every other key. If `container` is not available, or the values differ, leave the file alone. Pros: only touches a value that is provably the bridge address Grove would have written; keeps the user's own settings. Cons: if the gateway has changed since, a stale entry stays (documented in the ADR).
- B. Remove `hostname` whenever it looks like a private bridge address. Pros: catches changed gateways. Cons: can remove an address the user set on purpose.
- C. Never touch the file; document it. Pros: Grove never edits a file it does not own on the way out. Cons: contradicts the brief and may leave OpenCode pointing at an address that no longer exists.

**Pick:** A

**Outcome impact.** A user whose OpenCode still points at the old bridge address gets it removed; a user's own setting is never overwritten.

### D4. What happens to the shared error-message file

**Context.** `src/shared/sandboxErrors.ts` holds the error-code table for every session error (not-found, no-copilot, worktree-failed and others) next to the sandbox entries. The brief says no sandbox-related strings remain, and the file name itself says sandbox. Five files import it.

**Options.**
- A. Delete the sandbox entries and rename the file (and its test) to `sessionErrors.ts`, updating the five importers. Pros: no sandbox word left in the codebase; the name matches what the file holds. Cons: touches five importing files and the test.
- B. Delete the sandbox entries and keep the file name. Pros: smaller diff. Cons: a misleading name stays and the "no sandbox strings" check needs an exception.

**Pick:** A

**Outcome impact.** None visible to the user; the final search for the word finds nothing outside the unrelated iframe and CSP uses.

### D5. What the socket does with the old `sandboxed` parameter

**Context.** The brief says the socket option gets the same treatment as the command-line flag (the normal unknown-option error, no special message). Today the socket server ignores any parameter it does not know, so simply deleting the code would silently start an ordinary session for a script that still sends `sandboxed: true`, which is the false-safety case the human rejected for the flag.

**Options.**
- A. Reject any `sessions.create` request that carries a `sandboxed` key with `bad-params` and the generic message `unknown parameter: sandboxed`. Pros: matches the flag's loud failure; old scripts and agents notice; no provider pointer, as chosen. Cons: one small check kept in the server, which names the old key.
- B. Ignore it like every other unknown parameter. Pros: no leftover code. Cons: an old caller asking for isolation silently gets none.
- C. Reject only when the value is `true`. Pros: tolerates `sandboxed: false` from old callers. Cons: a special case that needs explaining; `false` is the default anyway.

**Pick:** A

**Outcome impact.** A script or agent that still asks for a sandbox over the socket gets an error and no session; one that sends nothing is unaffected.

## Slices

### Slice 1. Nobody can ask for a sandboxed session

**Outcome.** The launch palette and new-session dialog have no sandbox control or ⌥S shortcut; `grove new --sandboxed` fails with the normal unknown-option error; the socket rejects a `sessions.create` that carries `sandboxed` (D5); core always starts and resumes sessions on the host.
**Thin end-to-end:** UI (palette, dialog) -> IPC and CLI/socket params -> core session create and resume. Deliberately missing: deleting the sandbox module and its wiring in `core.ts` and `main/index.ts`, the stored `sandboxed`/`sandboxNote` fields, the state migration, the session-header and card mark, the one-time cleanup, the error-file rename and the docs. Between slices 1 and 3 old sandboxed sessions would resume on the host; nothing is released between slices.
**Files.** Delete `src/renderer/src/sandboxOptIn.ts` and its test, `components/SandboxToggle.tsx` and css, `components/ui/Switch.tsx` and css, and the `--switch-track` token in `tokens.css` (first check with a repo-wide search that nothing else imports `Switch`; delete it last in the slice, after `NewSessionDialog` and `SandboxToggle` no longer import it). Suggested order inside the slice: core, then CLI and socket, then UI. Edit `src/core/core.ts` (the `sandboxed` create param, the sandbox branch in session create and in resume, so both always use `loginShellArgv`), `src/shared/ipc.ts`, `src/shared/cli.ts`, `src/cli/args.ts` (option, help line, field), `src/cli/index.ts`, `src/main/cliServer.ts` (answer `bad-params` with `unknown parameter: sandboxed` when the request carries a `sandboxed` key (D5)), `src/renderer/src/App.tsx`, `components/LaunchPalette.tsx` and css, `components/NewSessionDialog.tsx` and css, `components/ui/Modal.tsx` (the switch-specific key handling), and the tests `sessionCreate.test.ts` (sandbox cases removed; `core.ts` still holds `sandboxDeps` and the sandbox imports until slice 2, so unused imports are expected between slices 1 and 2), `cliServer.test.ts` (a `sandboxed` request is rejected), `args.test.ts` (`--sandboxed` is an unknown option).
**Verification.** `npm run typecheck && npm test` pass; `grep -rn "SandboxToggle\|sandboxOptIn\|wantsSandbox\|quickSandbox" src` finds nothing; `grep -rn "sandboxed" src/cli src/shared/ipc.ts src/shared/cli.ts` finds only the negative test in `args.test.ts`; the args test shows `--sandboxed` rejected as an unknown option and the cliServer test shows `sandboxed` rejected with `bad-params`. Slice 1 also owns removing the resume downgrade (`LOST_SANDBOX`, the `sandboxNote` it set), so slice 3's type removal compiles.

### Slice 2. Delete the sandbox module

**Outcome.** The sandbox module, its resources and its wiring are gone; nothing at startup or on kill and remove touches containers.
**Files.** Delete `src/core/sandbox/` (all 14 files) and `resources/sandbox/Dockerfile`. Edit `src/core/core.ts` (imports, including `LOST_SANDBOX` and `SandboxDeps`, `CoreOptions.sandbox`, the `Partial<AgentPaths>` part of `sessionEnv`, `sandboxDeps`, `dropContainer` and its calls in kill and remove, the startup `pruneContainers`, the `gitCommonDir` import if now unused), `src/core/agents/types.ts` (`SandboxKind`, `isSandboxKind`), `src/main/index.ts` (the `AgentPaths` import, the extra paths that only fed the sandbox, the `sandbox` option; keep every path used elsewhere in the file). `opencodeCliConfig`, `opencodeModelEnv`, `socketPath` and `binDir` stay: `cliEnv` and the shell options use them.
**Verification.** `npm run typecheck && npm test && npm run build` pass; `grep -rn "sandboxArgvFor\|isSandboxKind\|pruneContainers\|removeContainer\|AgentPaths\|core/sandbox" src` finds nothing.

### Slice 3. Stored data and session marks

**Outcome.** The stored session no longer has a `sandboxed` flag or note; the state file is version 10; sandboxed sessions are absent after loading an old file; the session header and cards show no sandbox mark.
**Files.** `src/shared/types.ts` (`Session.sandboxed`, `sandboxNote`), `src/core/sessions.ts`, `src/core/store/stateStore.ts` (migration `v9ToV10`, version 10) and `stateStore.test.ts` (a version 9 file with one sandboxed and one ordinary session loads with only the ordinary one, field stripped; remove the old "keeps a sandboxed session sandboxed" case), `src/core/core.ts` (the persist-strip of `sandboxNote`), `src/renderer/src/sessionStatus.ts` (`sandboxView`) and its test block, delete `components/ui/SandboxMark.tsx` and css, edit `components/SessionMeta.tsx`, and the `sandboxed: false` fixtures in the navigation, railBars, sessionList, tree, sessionStatus and contextGauge tests.
**Verification.** `npm run typecheck && npm test` pass; the new migration test passes; `grep -rln "sandboxed\|sandboxNote\|sandboxView\|SandboxMark" src` lists only `stateStore.ts`, `stateStore.test.ts` and the files that slice 5 still has to change (`sandboxErrors.ts` and its importers' tests), plus the intended `sandboxed` check in `cliServer.ts` and the negative tests in `args.test.ts` and `cliServer.test.ts`.

### Slice 4. One-time leftover cleanup

**Outcome.** On the first launch after upgrade, old `grove-` containers are stopped and removed, `grove-sandbox:` images are removed, and the OpenCode `hostname` is removed when it equals the default network gateway; a marker file stops it running again; a machine without `container`, or a `container` that does not answer in time, finishes quietly with the marker written.
**Files.** Add `src/core/legacySandboxCleanup.ts` and its test with a fake command runner (cases: containers and image present; `container` missing; a call that times out; `hostname` equal to the gateway; `hostname` different; `password` and `port` preserved in the file; a container whose name does not start with `grove-` is left alone; marker present means zero calls; the marker is written after every attempt). The module carries its own copy of what it needs from the deleted code: the `grove-` name prefix, the `grove-sandbox:` image prefix and the default network name `default` with its `ipv4Gateway` lookup through `container network ls --format json` (read before slice 2 deletes it, from `src/core/sandbox/service.ts`, and also available as `git show 6d3c4c8:src/core/sandbox/service.ts`). Call it from `src/main/index.ts` at startup without awaiting it (fire and forget, started after the state is loaded, every external call under a 10 second timeout; if the marker write itself fails the cleanup reruns next launch, which is harmless), with the data-folder marker path and the service file path already known there.
**Verification.** `npm run typecheck && npm test` pass; the new test file passes; manually, launching `npm run dev` from a terminal with a stub `container` script first on PATH (a GUI-launched app does not inherit that PATH) that records its calls, a first launch makes the expected calls, writes `sandbox-cleanup.done` in the app's data folder, and on a second launch the stub's call log stays empty; also by hand, a leftover sandboxed pane closes when its container is removed and does not reappear in the session list.

### Slice 5. Shared error names and leftover wording

**Outcome.** No sandbox error codes, comments or CSS remain in the code.
**Files.** Rename `src/shared/sandboxErrors.ts` and its test to `sessionErrors` and remove the `no-sandbox-*` entries (and their test assertions); update the importers `src/main/cliServer.ts`, `cliServer.test.ts`, `src/renderer/src/App.tsx` and `components/ParentPicker.tsx`; reword the comments in `src/shared/opencodeSession.ts`, `src/main/menu.ts`, `src/renderer/src/paletteItems.test.ts` and `src/core/core.ts`; remove any now-unused css rules in `NewSessionDialog.module.css` and `LaunchPalette.module.css`.
**Verification.** `npm run typecheck && npm test && npm run build` pass; the repo-wide code search in "Allowed leftovers" below finds only what that list names.

### Slice 6. Docs and history

**Outcome.** README and CONTEXT.md no longer describe the sandbox; ADR 0045 records the removal; the old ADRs and the two backlog tasks are marked.
**Files.** `README.md` (the launch-dialog lines, the "Sandboxed sessions" bullet, the `--sandboxed` example, the Apple container prerequisite; one sentence saying isolation is left to each provider, written without the word "sandbox"); `CONTEXT.md` (remove **Sandboxed session**, **Sandbox spec**, **Container bridge**, and the sandbox mentions in the launch-dialog and session-creation lines; keep the iframe sandbox line); add `docs/adr/0045-sandboxing-is-left-to-each-provider.md` from the template, Status "Accepted", with Context, Decision and Consequences naming the one-time cleanup and its limits (D3); leave ADRs 0037 and 0044 untouched (they mention the sandbox in passing); set ADRs 0033, 0034, 0035, 0036, 0039 and 0040 to `Superseded by [0045](./0045-sandboxing-is-left-to-each-provider.md)` with the repo's appended "Superseded." paragraph; move `.grove/tasks/backlog/T-196.md` to `.grove/tasks/archive/` with `status: archived` and the reason in the file; for T-191, which already has an archived copy that differs only in `status`, delete the backlog copy and add the reason to the archived one.
**Verification.** `grep -rniE "sandbox" README.md CONTEXT.md` finds only the iframe line; every sandbox ADR except 0038 (already superseded) shows `Superseded by [0045]` and each link resolves; `.grove/tasks/backlog` has neither T-191 nor T-196.

### Slice 7. Final sweep

**Outcome.** The whole tree passes and the brief's checks hold end to end.
**Files.** No planned edits; fixes only for anything the checks find.
**Verification.** `npm run typecheck && npm test && npm run build` pass; the repo-wide code search in "Allowed leftovers" below finds only what that list names; a human starts `npm run dev` and confirms the launch palette and dialog show no sandbox control (not checkable unattended).

### Allowed leftovers

The code search is `grep -rniE "sandbox" src resources scripts package.json electron.vite.config.ts`. It may find only: the artifact viewer iframe and CSP (`ArtifactViewer.tsx`, `artifacts.ts`); the JSONL fixtures under `src/core/claude/fixtures/`; the unrelated comment in `src/core/discovery/watcher.test.ts`; the transitional code that exists to remove what the sandbox left behind (`stateStore.ts` and its test for the version 10 migration, `legacySandboxCleanup.ts`, its test and the one call to it in `src/main/index.ts`); and the old-parameter rejection and its two negative tests (`cliServer.ts`, `args.test.ts`, `cliServer.test.ts`).

## Reviewer round log

- Round 1 (3 blocking, 8 non-blocking). Blocking: socket silently ignoring `sandboxed` contradicted the human's pick → fixed by rejecting it with `bad-params` in slice 1; verification greps would hit the migration and cleanup module → fixed by an explicit "Allowed leftovers" list and a deviation entry; T-191 already archived, so a move would collide → fixed by deleting the backlog copy and annotating the archived one. Applied non-blocking: slice 1 split into entry points (1) and module deletion (2); `Switch` importer check; cleanup runs in the background with timeouts and always writes the marker; the cleanup module carries its own gateway lookup; orphan panes and reconcile named in risks.
- Round 2 (3 blocking, 10 non-blocking). Blocking: slice 3 grep would list the socket check and negative tests → fixed by naming them in its expected list; "Allowed leftovers" missed `cliServer.ts` → fixed by adding it; socket behaviour was a silent one-way choice → fixed by new decision D5 with a generic message. Applied non-blocking: unused imports between slices 1 and 2, extra entry-point grep, `LOST_SANDBOX` owned by slice 1, marker name and empty call log, 10 second timeout, gateway lookup source, ADRs 0037 and 0044 untouched, dev-start marked a human check.
- Round 3 (1 blocking, 9 non-blocking). Blocking: the final greps would hit the cleanup call in `src/main/index.ts` → fixed by adding it to "Allowed leftovers". Applied non-blocking: order inside slice 1 and `Switch` deleted last, how to launch with a stub PATH, a non-`grove-` container test, worktrees and tmux sessions of dropped sessions named in risks, docs sentence avoids the word.
- CTO check (0 blocking).

## Deviations from the brief the human should know

- "No sandbox-related code or strings remain" has named exceptions: the version 10 state migration and its test, the transitional cleanup module and its test (it must name the old image prefix and `grove-` containers to remove them), and the two tests asserting the old flag and socket key are rejected. They are listed under "Allowed leftovers". The cleanup module is meant to be deleted in a later release.
- The brief says "a second launch does nothing": the plan reads this as "runs no cleanup", with a marker file recording that it ran.
- The socket rejection of the old option is the human's choice in D5; its message is generic (`unknown parameter: sandboxed`), with no pointer to providers.
- Between slices 1 and 3 the stored flag still exists, so old sandboxed sessions would run on the host if the app were launched at that point. Nothing is released between slices.

## Risks and what is deliberately not done

- Panes of dropped sessions: stopping their containers ends the `container run` process in each terminal pane, including a pane the user is looking at on that first launch (the session is dropped anyway); whether the pane then closes depends on the terminal multiplexer's settings. Startup reconciles saved sessions against live tmux sessions, so an unlisted pane is not re-adopted. Both are checked by hand in slice 4.
- The cleanup runs in the background with timeouts so a slow `container` cannot delay launch; it writes the marker even when the tool is missing or times out, so a machine where it failed is not retried.
- A changed gateway leaves a stale `hostname` in `service.json` (D3 option A); stated in ADR 0045.
- No replacement isolation, no deprecation message for the old flag, no change to the artifact viewer iframe sandbox or CSP, no rewrite of the other work folders that mention the word (the brief's non-goals).
- Worktrees and tmux sessions that belong to dropped sessions are left as they are; only containers, the image and the OpenCode setting are cleaned.
- Older Grove builds cannot read the version 10 state file (D1).

## Open questions
