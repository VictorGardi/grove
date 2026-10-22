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

## Slice 2

Session: run/2026-10-22-copilot-cli-support-inherit-slice-2-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `core.ts` `sessionCreate` already passes `{ prompt, name, model }` to `source.argv` and stores `launchModel`; `sessionResume` already passes `{ model: session.launchModel }`. Only `CopilotSource.argv` ignored the options, and `args.ts` / `cliServer.ts` allow-listed `--model` to claude and opencode.

Implementer 1 (done in this session by the planner, see Deviations):
- [x] `src/core/copilot/source.ts` (+ test): `--model <m>` on start and resume, `--interactive=<prompt>` on start only
- [x] `src/cli/args.ts`, `src/main/cliServer.ts` (+ tests): `--model` allowed for every agent kind, still refused for terminal
- [x] `src/core/sessionCreate.test.ts`: real `CopilotSource`, model and prompt in the argv, resume reuses id and model
- [x] `resources/skills/grove/SKILL.md`, `src/shared/types.ts` comment

Models passed: reviewer: inherit

### Review rounds

Round 1: fresh reviewer subagent, 0 blocking. Ran the real binary: a prompt starting with `-` passes through the `--interactive=` form.

approved, 0 blocking, 0 fix rounds. Non-blocking left: `name` is ignored (Copilot has `--name`, possible follow-up); an unavailable `--model` fails fast in the pane and the session shows gone; resuming a session Copilot never persisted (killed before its first turn) errors in the pane.

### Deviations

- Built directly by the planner session, not through an `implementer` subagent (small, tightly coupled). Review was a fresh reviewer subagent.
- `--interactive=<prompt>` is used instead of `-i <prompt>` so a prompt starting with `-` is safe.

### Verification

- `npm run typecheck`: clean. `npm test`: 96 files, 1130 tests passed (before the last test-typing fix); `src/core/sessionCreate.test.ts` re-run: 51 passed.
- Models requested: none (all roles inherit).

### Left for the human

- Manual in the running app: `grove new copilot --model <m> --prompt "do X"` shows both applied; kill the pane, resume from the app, the conversation continues (resume was verified only with `-p` runs, not in an interactive pane); `grove new terminal --model m` is refused (covered by tests).

## Slice 3

Session: run/2026-10-22-copilot-cli-support-inherit-slice-3-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `NewSessionDialog.tsx` and `LaunchPalette.tsx` each held their own `KINDS` list; the palette finds a shortcut by `e.code`, so display order and shortcut are independent. The `copilot` icon and `SessionKind` member already existed from slice 1; `sandboxable` was already false for Copilot.

Implementer 1 (done in this session by the planner, see Deviations):
- [x] `src/renderer/src/launchKinds.ts` (+ test): one shared list, order Claude, OpenCode, Copilot, Terminal; Digit1, Digit2, Digit4 (Copilot), Digit3 (Terminal)
- [x] `NewSessionDialog.tsx`, `LaunchPalette.tsx`: use the shared list
- [x] `sandboxOptIn.ts` (+ test): `noSandboxReason`; used by `SandboxToggle.tsx` label and a hint line in the dialog
- [x] `usualKind.ts` (+ test): Copilot counts as an agent for the repo's usual kind

Models passed: reviewer: inherit

### Review rounds

Round 1: fresh reviewer subagent, 0 blocking.

approved, 0 blocking, 0 fix rounds. Non-blocking left: dialog still shows the VM text for Copilot (dimmed, with the reason below); no render test for the four kinds; the Copilot icon is still the slice-1 placeholder.

### Deviations

- Built directly by the planner session, not through an `implementer` subagent (small, tightly coupled). Review was a fresh reviewer subagent.
- The two `KINDS` lists were merged into `src/renderer/src/launchKinds.ts` (not in the plan) so the order and shortcuts are testable. `Sidebar.tsx` needed no change (label and icon came in slice 1).
- `usualKind` now preselects Copilot when it is the repo's most recent agent; `KIND_DEFAULT` is still `claude`.

### Verification

- `npm run typecheck`: clean. `npm test`: 97 files, 1134 passed, 1 failed (`pruneContainers` in `src/core/sandbox`, timing under load); re-run of `src/core/sandbox` alone: 68 passed. Unrelated to this slice.
- Models requested: none (all roles inherit).

### Left for the human

- Manual in the running app (headless child, not driven): open the dialog and palette, pick Copilot by mouse and by ⌥4, check ⌥3 still opens Terminal, check the sandbox switch is disabled for Copilot with its reason, and Claude and OpenCode launch as before.

## Slice 4

Session: run/2026-10-22-copilot-cli-support-inherit-slice-4-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `SpoolClaude` + `SpoolTail` + `step()` is the pattern (hooks append `{"t","e"}` records to `<dir>/<id>.jsonl`, tailed and folded); `CopilotSource` was launch-only. Real Copilot payloads were captured first (see `02-research.md`, "Hook payloads, Slice 4"): they do not name their event, so the hook command stamps it.

Implementer 1 (done in this session by the planner, see Deviations):
- [x] `src/core/copilot/hooks.ts`: per-session plugin (`plugin.json`, `hooks.json`), one stamping hook command per event
- [x] `src/core/copilot/normalise.ts` (+ test): fold for working/done, permission attention, write paths
- [x] `src/core/copilot/source.ts` (+ test): `--plugin-dir` in the argv (start and resume), spool tail, snapshot, `lastWrites`, `forget` removes spool and plugin
- [x] `src/main/index.ts`: `CopilotSource({ dir })` under `agents/copilot`; `sessionCreate.test.ts` argv updated

Models passed: reviewer: inherit

### Review rounds

Round 1: fresh reviewer subagent, 0 blocking. Applied: hook command never fails Copilot and survives empty or multi-line stdin; `preToolUse` no longer closes attention (parallel calls) and sets working when the prompt hook was missed; `sessionStart` clears a stale turn; JSON-string `toolArgs` read; relative paths with no cwd dropped; tests for each.

approved, 0 blocking, 0 fix rounds. Non-blocking left: Copilot fires `permissionRequest` for auto-approved calls too, so under `--allow-all-tools` a long tool call shows attention for its duration; a denied request stays open until the next tool result, end of turn or prompt; `<id>.plugin` is left behind if a create is refused after `argv()`, and orphaned spools of sessions removed while the app was off are not swept; a late hook append after `forget` can recreate a spool; spools grow without bound (as Claude's).

### Deviations

- Built directly by the planner session, not through an `implementer` subagent (small, tightly coupled). Review was a fresh reviewer subagent.
- Reuses `SpoolTail` and `SpoolRecord` from `src/core/claude/spool.ts` instead of a copy.
- No `src/core/testing/fakeAgentSource.ts` change was needed.

### Verification

- `npm run typecheck`: clean. `npm test`: 98 files, 1146 tests passed.
- New tests: normaliser (prompt, agentStop with and without prompt, permission open/close/denied/parallel, `apply_patch` writes incl. multi-file and `Move to`, failed and non-write tools, `edit`/`create` args, `sessionStart`, `sessionEnd`), source (plugin written, hook command run for real with quotes, empty and multi-line stdin and an unwritable spool; spool tail to snapshot, `lastWrites`, events, `forget`).
- Real binary (copilot 1.0.102, `-p`): the plugin generated by `CopilotSource` wrote spool records for sessionStart, userPromptSubmitted, preToolUse, permissionRequest, postToolUse, agentStop, sessionEnd.
- Models requested: none (all roles inherit).

### Left for the human

- Manual in the running app (headless child, not driven): send a prompt in a Copilot pane and watch the card go working then done; trigger a permission request (no `--allow-all`) and see attention, then approve and see it clear; edit a file in a feature folder and see the session link to it. Hooks via `--plugin-dir` were only run with `-p`, not in an interactive pane; if the pane shows no status, that is the first thing to check.
- Gaps found: no question attention (no verified `ask_user` signal), no subagent busy marks, no context gauge, aborted turns are unverified (the next prompt, `agentStop` or `sessionStart` resets the card), `edit`/`create` write shapes unverified (only `apply_patch` seen).

## Slice 5

Session: run/2026-10-22-copilot-cli-support-inherit-slice-5-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `installSkill()` in `src/main/index.ts` listed two skills folders inline (Claude, OpenCode) and `installAgentSkill` links the bundled `grove` skill into each. In the skills repo, `install.sh` has modes `claude` (default) and `opencode`; `uninstall.sh` scans two dirs; `shared/roles.md` is copied into `grove-auto` and `grove-run` references by `sync-shared.sh`. D3 = A (user-level `~/.copilot/skills`) was the gate choice; no generated files are written, so nothing needs an `info/exclude` entry in this slice.

Implementer 1 (done in this session by the planner, see Deviations):
- [x] App: `src/main/launcher.ts` `agentSkillsDirs(home, env)` (adds `$COPILOT_HOME/skills`, default `~/.copilot/skills`), used by `src/main/index.ts`; test in `launcher.test.ts`
- [x] App: `resources/skills/grove/SKILL.md` (description, `wait` and `send` notes for Copilot)
- [x] Skills repo (branch `run/2026-10-22-copilot-cli-support`, worktree `~/.grove/worktrees/grove-skills/run-2026-10-22-copilot-cli-support`, one commit): `install.sh --target copilot-only`, `uninstall.sh` covers the Copilot folder, `shared/roles.md` "In Copilot" (+ synced copies), `scripts/validate.sh` round-trip check, README note
- [x] Skills that name Claude tools, found by grep and patched: `grove-approve` (disable-model-invocation note), `grove-auto` (question tool, researcher spawn, model rule), `grove-run` (permission note, child question tool), `grove-run/references/slice-mode.md` (question tool). The other skills only say "the equivalent in other agents" and needed no change.

Models passed: reviewer: inherit

### Review rounds

Round 1: fresh reviewer subagent, 2 blocking: (a) the new `validate.sh` block overrode only `HOME`, so a set `COPILOT_HOME` would hit the developer's real folder; (b) `roles.md` claimed `/fleet`, `/tasks`, `/subagents` and interactive-pane permission behaviour that no verified fact backs. Fixed: `COPILOT_HOME` pinned to the temp dir in the check; claims removed or marked unverified. Also applied: helper comment placement, Copilot pointer in the model rules, clearer `grove-approve` wording. Re-checked by running `validate.sh` with a bogus `COPILOT_HOME` (nothing written outside the temp dir); no second reviewer round (fixes were wording and a test guard).

approved, 0 blocking after fixes, 1 fix round. Non-blocking left: `install.sh` accepts unknown targets silently (as before); the app writes into `$COPILOT_HOME` only if the Electron process has that variable (a GUI launch usually does not); the `grove` skill's "working and done only" and `roles.md`'s "should show as waiting" must be re-read together after the interactive check.

### Deviations

- Built directly by the planner session, not through an `implementer` subagent (small, coupled). Review was a fresh reviewer subagent.
- Helper `agentSkillsDirs` extracted (not in the plan) so the Copilot folder is testable.
- `install.sh --target copilot-only` is explicit; the default install does not write to `~/.copilot` (chosen so no new home folder is written without being asked). Copilot has no command wrappers, so `commands/` is not linked in that mode.
- The question tool and subagent tool of Copilot could not be named: in a `-p` run the model reports it has no `ask_user`. `roles.md` says so; subagent roles in Copilot inherit the session model until Slice 6 verifies a route.

### Verification

- App: `npm run typecheck` clean; `npm test`: 98 files, 1147 passed.
- Skills: `bash scripts/validate.sh` OK, including the new check: default install leaves `~/.copilot` absent; `--target copilot-only` links every skill and writes only `skills/`; `uninstall.sh` removes exactly those links (negative run with the uninstall dir removed fails the check as intended).
- Real binary (copilot 1.0.103): with `COPILOT_HOME` set to a temp dir holding links to the app's `grove` skill and `grove-run`, `copilot skill list` listed both under "Personal skills".
- Models requested: none (all roles inherit).

### Left for the human

- Manual: from an interactive Copilot session, run the `grove` skill to start another session, send it a message, wait for it, and read its screen (not run: this child is headless and a Copilot interactive pane was not driven). Run `./install.sh --target copilot-only` in `~/git/grove-skills` (after merging the branch) to get the workflow skills in Copilot; the app's "Install Agent Skill…" menu now also links `grove` into `~/.copilot/skills`.
- Review the skills repo commit on branch `run/2026-10-22-copilot-cli-support` (`~/.grove/worktrees/grove-skills/run-2026-10-22-copilot-cli-support`).

## Gaps

- Signed-out Copilot is not detected by Grove (no way to read the keychain login); Copilot shows its own message.
- Status (working, done), permission attention and file links work through hooks; question attention, subagent marks and context gauge are not signalled. Resume UI: later slices.
- Resume in an interactive pane is untested against the real app; an unavailable model fails in the pane.
- Sandbox: none for Copilot (non-goal).
- Copilot question tool and subagent-by-role spawning: not verified; `roles.md` "In Copilot" says so. Workflow skills that need blind subagents depend on the latter (Slice 6).
- Copilot skills install is user-level only and explicit for the skills repo (`--target copilot-only`).

## Open questions
