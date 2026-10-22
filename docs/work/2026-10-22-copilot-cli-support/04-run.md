---
feature: 2026-10-22-copilot-cli-support
phase: run
status: draft
version: 1
created: 2026-10-22
updated: 2026-10-22
approved_at:
based_on: [03-plan.md@1]
forced: []
---

# Run: GitHub Copilot CLI as a third agent

Profile: inherit
Branch: run/2026-10-22-copilot-cli-support-inherit
Plan commit: 08ad2e723b8df2595b7805c5c308c260a0edcb7b
Roles:
- cto: claude, inherit
- researcher: claude, inherit
- planner: claude, inherit
- reviewer: claude, inherit
- implementer: claude, inherit

## Slice 1

Session: run/2026-10-22-copilot-cli-support-inherit-slice-1-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `AgentKind` is `Exclude<SessionKind,'terminal'>`, so adding `copilot` to `SessionKind` flows into the sandbox helpers (`spec.ts`, `auth.ts`, `launch.ts`), which branch `claude` else OpenCode; the CLI kind lists are duplicated in `args.ts` and `cliServer.ts`; `core.ts` `sessionCreate` is the one place a sandbox is refused by kind; sources register in `main/index.ts`.

Implementer 1 (done in this session by the planner, see Deviations):
- [x] `docs/work/2026-10-22-copilot-cli-support/02-research.md`: "Verified on a real install" section
- [x] `src/shared/types.ts`, `src/core/sessions.ts`, `src/core/agents/types.ts` (kind, `SandboxKind`, `isSandboxKind`, optional `preflight`)
- [x] `src/core/copilot/source.ts` (+ test): launch-only source, `--session-id` / `--resume=`, PATH check
- [x] `src/core/core.ts` (preflight before create; sandbox refusal via `isSandboxKind`), `src/main/index.ts` (register)
- [x] `src/cli/args.ts`, `src/main/cliServer.ts`, `src/shared/sandboxErrors.ts` (kind accepted, `no-copilot` message)
- [x] sandbox helpers refuse Copilot: `spec.ts` throws, `auth.ts` returns null, `launch.ts` returns refusal `kind`
- [x] renderer: only what the compiler required (`Sidebar.tsx` label, `Icon.tsx` icon)
- [x] tests beside each

Models passed: reviewer: inherit

### Review rounds

Round 1: fresh reviewer subagent, 0 blocking. Applied: positive `copilotOnPath` test.

approved, 0 blocking, 0 fix rounds. Non-blocking left: `--prompt`/label are accepted but dropped by the Copilot argv until Slice 2; the PATH probe uses `-l -i` like the pane (a hanging rc file would read as missing); no test yet wires the real `CopilotSource` into core or resumes a Copilot session (Slice 2).

### Deviations

- The slice was built directly by the planner session, not through an `implementer` subagent (small, tightly coupled chunk). The review was a fresh reviewer subagent.
- The `preflight()` hook on `AgentSource` is new (not in the plan): it is how a source refuses a create before any pane exists.
- Missing `copilot` is detected with the login shell (`command -v copilot`), not a signed-in check; see the gap list.
- The renderer gets a plain placeholder icon and the sidebar label only; the dialog and palette entries are Slice 3.

### Verification

- `npm run typecheck`: clean. `npm test`: 96 files, 1127 tests passed before the last test additions; `src/main/cliServer.test.ts` re-run after adding the Copilot test: 20 passed.
- New tests: Copilot never wrapped in a sandbox by flag (core refuses `no-sandbox-kind`), persisted opt-in / default (`sandboxOptIn.test.ts`: `sandboxable('copilot')` and `wantsSandbox` are false), each sandbox helper refuses Copilot (`spec.test.ts`, `auth.test.ts`, `launch.test.ts`); missing `copilot` message (`source.test.ts`, `sessionCreate.test.ts`, `cliServer.test.ts`, `sandboxErrors.test.ts`).
- Facts: each confirmed by running the real binary (copilot 1.0.102) or marked unverified in `02-research.md`.
- Models requested: none (all roles inherit).

### Left for the human

- Manual in the running app: `grove new copilot` opens a Copilot pane and a card appears (no status, by design); with `copilot` off PATH the command fails with the plain message and no pane. The child ran headless, so the Electron app was not driven.
- Signed-out: Copilot offers no read-only sign-in check, so there is no Grove message for it; Copilot's own login prompt shows in the pane. Listed as a gap.
- Gate choices (run rule 1), from the facts: D1 = A (hooks per launch via `--plugin-dir`, no edit to `~/.copilot/settings.json`; permissionRequest and agentStop exist; question and subagent signals unverified); D2 = A (`--session-id`, `--resume=<id>`); D3 = A (`~/.copilot/skills`, user level); D4 = A or B still open (agent file model unverified; `subagents.agents.<name>.model` in settings is a candidate).

## Gaps

- Signed-out Copilot is not detected by Grove (no way to read the keychain login); Copilot shows its own message.
- Status, attention, file links, model, prompt, resume UI: later slices.
- Sandbox: none for Copilot (non-goal).

## Open questions
