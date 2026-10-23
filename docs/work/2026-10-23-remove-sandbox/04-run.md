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

## Open questions
