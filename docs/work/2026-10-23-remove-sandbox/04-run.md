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

## Open questions
