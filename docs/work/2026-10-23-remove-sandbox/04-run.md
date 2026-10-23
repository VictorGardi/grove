---
feature: 2026-10-23-remove-sandbox
phase: run
status: draft
version: 1
created: 2026-10-23
updated: 2026-10-23
approved_at:
based_on: [03-plan.md@1]
forced: []
---

# Run: remove the sandbox feature

Profile: inherit
Branch: feature/2026-10-23-remove-sandbox-inherit
Plan commit: c4d1005f23bc78802a86ccb8e9d234d80bc61094
Roles:
- cto: claude, inherit
- researcher: claude, inherit
- planner: claude, inherit
- reviewer: claude, inherit
- implementer: claude, inherit

## Slice 1

Session: remove-sandbox-slice-1-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `core.ts` has `sandboxed` on `sessionCreate` params, a sandbox branch in create (~L851-870) and resume (~L915-941, with `LOST_SANDBOX`/`sandboxNote`); CLI `args.ts`/`index.ts`/`shared/cli.ts`/`shared/ipc.ts` carry `sandboxed`; `cliServer.ts` passes `params.sandboxed === true`; the renderer has `sandboxOptIn.ts`, `SandboxToggle`, `Switch` (used by `NewSessionDialog` and `SandboxToggle`), `LaunchPalette` ⌥S and `App.tsx` `quickSandbox`.

Implementer 1 (core, CLI, socket):
- [x] `src/core/core.ts`: drop `sandboxed` param, sandbox branches in create and resume (always `loginShellArgv`), `LOST_SANDBOX` resume downgrade
- [x] `src/shared/ipc.ts`, `src/shared/cli.ts`, `src/cli/args.ts`, `src/cli/index.ts`: remove `sandboxed`
- [x] `src/main/cliServer.ts`: reject `sandboxed` key with `bad-params` `unknown parameter: sandboxed`
- [x] tests: `sessionCreate.test.ts`, `cliServer.test.ts`, `args.test.ts`

Implementer 2 (renderer):
- [x] delete `sandboxOptIn.ts`+test, `SandboxToggle.tsx`+css, `ui/Switch.tsx`+css, `--switch-track` token
- [x] edit `App.tsx`, `LaunchPalette.tsx`+css, `NewSessionDialog.tsx`+css, `ui/Modal.tsx`

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: no blocking findings; two stale comments in `LaunchPalette.tsx` fixed.

Approved, 0 blocking, 0 fix rounds. Non-blocking left: no test asserts "always host" with sandbox deps configured (the code that makes it testable goes in slice 2).

### Deviations

`sandboxDeps` and the `gitCommonDir` import in `core.ts` were removed in this slice (they became unused and failed typecheck); slice 2 no longer needs to. Otherwise none.

### Verification

`npm run typecheck` and `npm test` pass (98 files, 1148 tests; one unrelated timing flake on a first run passed on rerun). `grep SandboxToggle|sandboxOptIn|wantsSandbox|quickSandbox src` finds nothing; `grep sandboxed src/cli src/shared/ipc.ts src/shared/cli.ts` finds only the negative test in `args.test.ts`. `args.test.ts` shows `--sandboxed` as an unknown option; `cliServer.test.ts` shows `sandboxed` rejected with `bad-params`. Subagents (implementer x2, reviewer) requested with the inherited model.

### Left for the human

none

## Slice 2

Session: remove-sandbox-slice-2-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `core.ts` still imports `pruneContainers`/`removeContainer`/`AgentPaths` from `./sandbox/*`, has `CoreOptions.sandbox`, `sessionEnv` typed with `Partial<AgentPaths>`, `dropContainer` (kill/remove) and a startup `pruneContainers`; `agents/types.ts` has `SandboxKind`/`isSandboxKind`; `main/index.ts` builds `agentPaths` and passes `sandbox:`. Slice 1 already removed `sandboxDeps`, `LOST_SANDBOX` and the `gitCommonDir` import.

Implementer 1:
- [x] delete `src/core/sandbox/` and `resources/sandbox/`
- [x] `src/core/core.ts`: imports, `CoreOptions.sandbox`, `sessionEnv` type, `dropContainer` and calls, startup prune
- [x] `src/core/agents/types.ts`: `SandboxKind`, `isSandboxKind`
- [x] `src/main/index.ts`: `AgentPaths`, `agentPaths`, `sandbox` option; `sessionEnv: { binDir, socketPath }`

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: no blocking findings. Verdict: approved, 0 fix rounds. Non-blocking, left for later slices: sandbox/VM wording in `opencodeSession.ts`, `sessionStatus.ts`, `SandboxMark.tsx`, `sandboxErrors.ts` (slices 3 and 5); the `sandboxNote` persist-strip comment in `core.ts` (slice 3).

### Deviations

none

### Verification

`npm run typecheck`, `npm test` (91 files, 1080 tests) and `npm run build` pass; `grep -rn "sandboxArgvFor\|isSandboxKind\|pruneContainers\|removeContainer\|AgentPaths\|core/sandbox" src` finds nothing. Subagents (implementer, reviewer) requested with the inherited model.

### Left for the human

none

## Slice 3

Session: remove-sandbox-slice-3-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `Session.sandboxed` and `sandboxNote` live in `shared/types.ts`; `newSession` in `core/sessions.ts` takes and sets `sandboxed`; `stateStore.ts` is at version 9 (`v8ToV9` adds `sandboxed`) and `core.ts` strips `sandboxNote` and writes `schemaVersion: 9` on persist; `sessionStatus.ts` has `sandboxView`, used only by `ui/SandboxMark.tsx`, which `SessionMeta.tsx` renders; six renderer tests carry `sandboxed: false` fixtures.

Implementer 1:
- [x] `src/shared/types.ts`: remove `sandboxed` and `sandboxNote`
- [x] `src/core/sessions.ts`: drop the `sandboxed` option and field
- [x] `src/core/store/stateStore.ts`: add `v9ToV10` (drop sessions with `sandboxed === true`, strip the field from the rest), version 10 in `loadState`; `core.ts`: `schemaVersion: 10`, drop the `sandboxNote` strip
- [x] `stateStore.test.ts`: v9 file with one sandboxed and one ordinary session loads with only the ordinary one, field stripped, version 10; remove the v8 and "keeps a sandboxed session" cases and update other `schemaVersion: 9` literals
- [x] `sessionStatus.ts` and its test: remove `sandboxView` and its describe block
- [x] delete `ui/SandboxMark.tsx` and css; edit `SessionMeta.tsx` (import, usage, comment)
- [x] remove `sandboxed: false` from the navigation, railBars, sessionList, tree, sessionStatus and contextGauge test fixtures

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: no blocking findings. Verdict: approved, 0 fix rounds. Non-blocking: an empty `.dense {}` rule left in `SessionMeta.module.css` (removed); the "ADR 0045" comment in the migration points at an ADR written in slice 6 (left); `sandboxErrors.ts` wording is slice 5.

### Deviations

`dense` became unused in `SessionMeta` once `SandboxMark` was gone (typecheck failed on it), so it was removed from its props and from the one caller in `SessionGrid.tsx`; its dead css rule was removed too. `v8ToV9` became an identity step. `projectUi.test.ts` had a `schemaVersion: 9` literal, now 10; the "unknown schemaVersion" test case moved from 10 to 11.

### Verification

`npm run typecheck` and `npm test` pass (91 files, 1075 tests); the new v9 migration test passes. `grep -rln "sandboxed\|sandboxNote\|sandboxView\|SandboxMark" src` lists only `stateStore.ts`, `stateStore.test.ts`, `cliServer.ts`, `cliServer.test.ts`, `args.test.ts`, `sandboxErrors.ts`, `opencodeSession.ts`, the artifact iframe files and a JSONL fixture. Subagents (implementer, reviewer) requested with the inherited model.

### Left for the human

none

## Slice 4

Session: remove-sandbox-slice-4-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `src/core/sandbox/` is gone; the old `service.ts` (git `6d3c4c8`) read the gateway from `container network ls --format json` (network `default`, `status.ipv4Gateway`) and wrote `hostname` into `$XDG_CONFIG_HOME/opencode/service.json` (not the state-dir registration file that `serviceFilePath` returns); the old `container.ts` listed with `container list --all --quiet`, removed with `container rm -f <name>`, and only touched names matching `/^grove-/`; the image tag was `grove-sandbox:<hash>`. `src/main/index.ts` builds `home` and calls `await core.start()`; the binary was the bare name `container`.

Implementer 1:
- [x] add `src/core/legacySandboxCleanup.ts`: `runLegacySandboxCleanup({ markerPath, configFile, container?, run?, timeoutMs? })`, an injectable command runner (default `execFile` with 10 s timeout, resolves `{ ok, stdout }`, never rejects); steps: skip with zero calls if marker exists; `container list --all --quiet` then `container rm -f` for names starting `grove-` only; `container image ls --quiet` (or `--format json` equivalent) then `container image rm` for tags starting `grove-sandbox:`; gateway lookup; if the config file's `hostname` equals the gateway remove only that key and rewrite keeping other keys (mode 0600); write the marker last, after every attempt; never throws
- [x] `src/core/legacySandboxCleanup.test.ts` with a fake runner covering the cases in the plan
- [x] `src/main/index.ts`: after `await core.start()`, call it without awaiting (`void ….catch(() => {})`), marker `path.join(app.getPath('userData'), 'sandbox-cleanup.done')`, config file `path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'opencode', 'service.json')`

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: two findings called blocking. (1) "Wrong `service.json` path": rejected; the old code (git `6d3c4c8`, `main/index.ts`) wrote `hostname` into `$XDG_CONFIG_HOME/opencode/service.json`, the config, not the state-dir registration file that `serviceFilePath` returns, so the path stays. (2) bare `container` lookup under a GUI launch's minimal PATH: fixed with `findBin('container', process.env) ?? 'container'` (`/usr/local/bin` is in `FIXED_DIRS`), plus a test running the real runner against a missing binary. The one-line fix was not re-reviewed by a fresh reviewer. Non-blocking left: no tests for a missing or malformed config file; `.catch(() => {})` at the call site is redundant but harmless.

### Deviations

The container binary is resolved with `findBin` in `src/main/index.ts` (not in the plan). Otherwise none.

### Verification

`npm run typecheck`, `npm test` (92 files, 1083 tests) and `npm run build` pass; the new test file has 8 tests. Reviewer confirmed the `container` output formats (`list --all --quiet`, `image ls --quiet`, `network ls --format json`) against the installed CLI and that `rm -f` removes running containers. Subagents (implementer, reviewer) requested with the inherited model.

### Left for the human

The manual checks from the plan: launch `npm run dev` with a stub `container` first on PATH, confirm the first launch makes the expected calls and writes `sandbox-cleanup.done` in the data folder, and the second launch makes none; confirm a leftover sandboxed pane closes when its container is removed and does not reappear in the session list.

## Slice 5

Session: remove-sandbox-slice-5-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `src/shared/sandboxErrors.ts` (with its test) holds the generic session error table plus eight `no-sandbox*` entries; it is imported by `cliServer.ts`, `cliServer.test.ts`, `App.tsx` and `ParentPicker.tsx`. `opencodeSession.ts` (header comment), `menu.ts` (L25 comment) still mention the sandbox; the `paletteItems.test.ts`, `core.ts` and the two css modules showed no `sandbox` match in a case-insensitive search, so they are checked for VM, container or isolation wording only.

Implementer 1:
- [x] `git mv` `sandboxErrors.ts` and `sandboxErrors.test.ts` to `sessionErrors`; remove all `no-sandbox*` entries and their comments, keep the rest; trim the test to the remaining entries and drop the sandbox assertions
- [x] update the four importers
- [x] reword the comments in `opencodeSession.ts` and `menu.ts` (and any in `paletteItems.test.ts`, `core.ts`) that mention sandbox, VM or container
- [x] remove unused css rules in `NewSessionDialog.module.css` and `LaunchPalette.module.css`

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: no blocking findings. Verdict: approved, 0 fix rounds. Non-blocking left: the two renamed files have no trailing newline (as before); the "ADR 0045" comment in `stateStore.ts` points at the ADR slice 6 writes.

### Deviations

The css modules needed no change: slice 1 had already removed the unused sandbox rules. `paletteItems.test.ts` and `core.ts` had no sandbox wording left to reword. Otherwise none.

### Verification

`npm run typecheck`, `npm test` (92 files, 1081 tests) and `npm run build` pass. `grep -rniE "sandbox" src resources scripts package.json electron.vite.config.ts` finds only the allowed leftovers (artifact iframe and CSP, fixtures, `watcher.test.ts`, `stateStore.ts` and its test, `legacySandboxCleanup.ts`, its test and the call in `src/main/index.ts`, the `sandboxed` rejection in `cliServer.ts` and its two negative tests). Subagents (implementer, reviewer) requested with the inherited model.

### Left for the human

none

## Slice 6

Session: remove-sandbox-slice-6-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `README.md` mentions the sandbox on lines 14, 22, 40, 59 and 75; `CONTEXT.md` on lines 42, 44 and 53-71 (three definitions) plus the unrelated iframe line 165. ADRs 0033-0036, 0039 and 0040 are `Accepted`; 0038 is already superseded and keeps its own status. The ADR template is `docs/adr/0000-template.md`; the repo's one superseded ADR (0038) uses `Superseded by [NNNN](./file.md)` in Status and a `Superseded.` paragraph under Decision. `.grove/tasks/backlog` holds T-191 and T-196; `.grove/tasks/archive/T-191.md` differs from the backlog copy only in `status`; T-196 has no archived copy.

Implementer 1:
- [x] `README.md`: remove the sandbox wording from the launch-dialog lines, the "Sandboxed sessions" bullet, the `--sandboxed` example and the Apple container prerequisite; add one sentence saying isolation is left to each provider, without the word "sandbox"
- [x] `CONTEXT.md`: remove the three sandbox definitions and the sandbox mentions in the launch-dialog and session-creation lines; keep the iframe line
- [x] add `docs/adr/0045-sandboxing-is-left-to-each-provider.md` (Accepted; Context, Decision, Consequences with the one-time cleanup and its limits from D3)
- [x] mark ADRs 0033, 0034, 0035, 0036, 0039, 0040 `Superseded by [0045](./0045-sandboxing-is-left-to-each-provider.md)` with a `Superseded.` paragraph
- [x] `git mv` T-196 to the archive with `status: archived` and the reason; delete the backlog T-191 and add the reason to the archived one

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: no blocking findings. Verdict: approved, 0 blocking, 0 fix rounds. Non-blocking left: the README Isolation sentence is a loose paragraph under a one-bullet list (renders fine).

### Deviations

none

### Verification

`grep -rniE "sandbox" README.md CONTEXT.md` finds only the iframe line in `CONTEXT.md`; ADRs 0033, 0034, 0035, 0036, 0039 and 0040 each show `Superseded by [0045]` and the link resolves; `.grove/tasks/backlog` has neither T-191 nor T-196; the ADR's version 10 and error-message claims match `stateStore.ts` and `cliServer.ts`. Subagents (implementer, reviewer) requested with the inherited model.

### Left for the human

none

## Slice 7

Session: remove-sandbox-slice-7-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: slices 1-6 are committed and the tree is clean; the plan lists no edits for this slice, only the final checks.

Implementer 1:
- [x] run the typecheck, tests and build, and the repo-wide sandbox search from "Allowed leftovers"; fix anything found (nothing found)

Models passed: none (no code changed, so no implementer or reviewer subagent was needed)

### Review rounds

No review round: the slice changes no source, only this log.

Approved, 0 blocking, 0 fix rounds. Non-blocking left: none.

### Deviations

No subagents were used, since the slice has no edits to build or review.

### Verification

`npm run typecheck`, `npm test` (92 files, 1081 tests) and `npm run build` pass. `grep -rniE "sandbox" src resources scripts package.json electron.vite.config.ts` finds only the allowed leftovers: `ArtifactViewer.tsx` and `artifacts.ts` (iframe and CSP), `watcher.test.ts`, `stateStore.ts` and its test, `legacySandboxCleanup.ts`, its test and the call in `src/main/index.ts`, the `sandboxed` rejection in `cliServer.ts` with its test and the one in `args.test.ts`. The JSONL fixtures under `src/core/claude/fixtures/` were excluded from the listing as allowed.

### Left for the human

Start `npm run dev` and confirm the launch palette and new-session dialog show no sandbox control. Also the slice 4 manual checks above (stub `container` on PATH, marker written, second launch silent; leftover pane closes and does not reappear).

## Final summary

- Slice 1: `2026-10-23-remove-sandbox: slice 1 — Nobody can ask for a sandboxed session`: palette, dialog, `--sandboxed` and the socket key are gone (socket rejects `sandboxed`); core always runs on the host. Review: approved, 0 fix rounds. Deviations: `sandboxDeps` removed early.
- Slice 2: `2026-10-23-remove-sandbox: slice 2 — Delete the sandbox module`: `src/core/sandbox/`, its resources and wiring deleted. Review: approved, 0 fix rounds. Deviations: none.
- Slice 3: `2026-10-23-remove-sandbox: slice 3 — Stored data and session marks`: state file version 10 drops sandboxed sessions; mark and fields removed. Review: approved, 0 fix rounds. Deviations: unused `dense` prop removed.
- Slice 4: `2026-10-23-remove-sandbox: slice 4 — One-time leftover cleanup`: `legacySandboxCleanup` removes `grove-` containers, `grove-sandbox:` images and a matching OpenCode `hostname`, once, guarded by a marker. Review: approved after one fix, not re-reviewed by a fresh reviewer. Deviations: container binary resolved with `findBin`.
- Slice 5: `2026-10-23-remove-sandbox: slice 5 — Shared error names and leftover wording`: `sandboxErrors` renamed to `sessionErrors` without sandbox entries; comments reworded. Review: approved, 0 fix rounds. Deviations: css needed no change.
- Slice 6: `2026-10-23-remove-sandbox: slice 6 — Docs and history`: README and CONTEXT cleaned, ADR 0045 added, six ADRs superseded, T-191 and T-196 closed. Review: approved, 0 fix rounds. Deviations: none.
- Slice 7: `2026-10-23-remove-sandbox: slice 7 — Final sweep`: typecheck, tests, build and the sandbox search all clean. Review: none needed. Deviations: no subagents used.

### Left for the human

- `npm run dev`: the palette and dialog show no sandbox control.
- Slice 4 manual checks: stub `container` first on PATH; first launch makes the expected calls and writes `sandbox-cleanup.done`, second launch makes none; a leftover sandboxed pane closes and does not reappear.

### PR description

Remove the sandbox feature

Grove no longer offers sandboxed sessions; isolation is left to each provider.

- Slice 1: removes the sandbox toggle, ⌥S, `--sandboxed` and the socket `sandboxed` key (rejected with `bad-params`); sessions always run on the host.
- Slice 2: deletes the sandbox module, its Dockerfile and wiring.
- Slice 3: state file moves to version 10; sandboxed sessions are dropped and the field stripped; the session mark is gone.
- Slice 4: a one-time, marker-guarded cleanup removes old `grove-` containers, `grove-sandbox:` images and the OpenCode `hostname` when it equals the default network gateway.
- Slice 5: `sandboxErrors` becomes `sessionErrors`, with no sandbox codes.
- Slice 6: README and CONTEXT cleaned; ADR 0045 supersedes 0033-0036, 0039 and 0040; T-191 and T-196 closed.
- Slice 7: final sweep, no changes.

Verified with typecheck, tests (1081) and build, and a repo-wide search that finds only the allowed leftovers (artifact iframe and CSP, the migration, the cleanup module, the rejection of the old parameter and their tests). Left for the human: start `npm run dev` and check the launch UI; the slice 4 manual cleanup checks. Older Grove builds cannot read the version 10 state file.

## Open questions
