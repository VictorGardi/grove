---
feature: 2026-11-02-attention-ownership
phase: run
status: draft
version: 1
created: 2026-11-02
updated: 2026-11-02
approved_at:
based_on: [03-plan.md@1]
forced: []
---

# Run: attention ownership and sidebar zones

Profile: inherit
Branch: feature/2026-11-02-attention-ownership-inherit
Plan commit: ed1ea362b9fc9f5b07ad0db24cc04d087b115291
Roles:
- cto: claude, inherit
- researcher: claude, inherit
- planner: claude, inherit
- reviewer: claude, inherit
- implementer: claude, inherit

## Slice 1

Session: attention-ownership-slice-1-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `notifyTransitions` (`src/core/core.ts:589`) notifies on every entry to waiting off screen, for any session. `sessionStatus.ts` has `trackWaiting` and `longestWaiting` filtering on `shownStatus(s) === 'waiting'`; `Sidebar.tsx:247` counts the same way; `mostUrgent` ranks a waiting child above others. `Session.parentId` marks a child.

Implementer 1:
- [x] `src/core/core.ts`: in `notifyTransitions`, skip the popup when `s.parentId` is set and `s.waitingFor === 'done'` (still record `waitKey`)
- [x] `src/renderer/src/sessionStatus.ts`: add `countsAsWaiting(s)` (waiting, and not a child with `waitingFor === 'done'`); use it in `trackWaiting` and `longestWaiting`; make `mostUrgent` rank a finished child as non-urgent
- [x] `src/renderer/src/components/Sidebar.tsx`: `waitingCount` uses `countsAsWaiting`
- [x] tests in `src/core/sessions.test.ts` and `src/renderer/src/sessionStatus.test.ts`

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: fresh reviewer found no blocking findings; no fix needed.

Approved, 0 blocking, 0 fix rounds. Non-blocking left: `mostUrgent` ties between a finished child and a plain idle sibling depend on list order; Board, palette, `family.ts`, `workflow/derive.ts`, `tree.ts` and `sessionList.ts` still treat a finished child as waiting (outside "N waiting", popup and cmd+.; not in the plan); the child-and-done predicate is written in both `core.ts` and `sessionStatus.ts`; the core test covers OpenCode and terminal, not Claude or Copilot.

### Deviations

none

### Verification

`npm test` (108 files, 1328 tests) and `npm run typecheck` pass, with new tests for a child's done (no notify; top-level done and a child's permission still notify; terminal child), `countsAsWaiting`, `longestWaiting`, `trackWaiting`, `mostUrgent` and the unchanged finished look. Models requested: implementer inherit, reviewer inherit.

### Left for the human

Observable check: start a parent with `grove new claude --child`, let the child finish, and confirm no popup or sound and an unchanged "N waiting".

## Slice 2

Session: attention-ownership-slice-2-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `Session` live fields (`status`, `waitingFor`) are stripped before save in `core.ts` `set()`; `sessionWorkflowStatus` is the model for a session command (`core.ts`, `ipc.ts`, `src/shared/ipc.ts`); `toCli` in `cliServer.ts` builds `grove ls --json`.

Implementer 1:
- [x] `src/shared/zones.ts`: `zoneOf(session)` (override first; permission, question or unknown wait -> needs-you; finished top-level -> review, finished child -> none; `in-review` -> review; working -> running)
- [x] `src/shared/types.ts`: `Zone`, `Session.zone?` (live), `Session.zoneOverride?` (persisted)
- [x] `src/core/core.ts`: `withZones` on every sessions publish, `zone` stripped before save, `sessionSetZone` (null resets)
- [x] `src/shared/ipc.ts`, `src/main/ipc.ts`: `session:setZone`; `src/shared/cli.ts`, `src/main/cliServer.ts`: optional `zone` in `grove ls --json`
- [x] tests: `src/shared/zones.test.ts`, `src/core/sessions.test.ts`, `src/renderer/src/sessionStatus.test.ts`

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: fresh reviewer found no blocking findings; no fix needed.

Approved, 0 blocking, 0 fix rounds. Non-blocking left: no automated test of `zone` in `grove ls --json` (trivial `toCli` change); an override also wins on gone or starting rows (slice 3 may hide it there). The `countsAsWaiting` unchanged-by-override assertion the reviewer asked for is in `sessionStatus.test.ts`.

### Deviations

none

### Verification

`npm test` (109 files, 1339 tests) and `npm run typecheck` pass. Tests cover each zone rule, override precedence, unknown input -> needs-you, `countsAsWaiting` and `notify` unchanged by an override, `zone` absent from the state file, and the override kept across a restart and cleared by a reset. Models requested: implementer inherit, reviewer inherit.

### Left for the human

Observable check: `grove ls --json` shows `zone` per session (not run in the app here); an override set through `session:setZone` is in the state file after an app restart (covered by the core test, not run through the UI).

## Slice 3

Session: attention-ownership-slice-3-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: the sidebar is one 675-line `Sidebar.tsx` (project groups from `listGroups`, `SessionCard`, drag, options panel, a `N waiting` button); `zoneOf` and `Session.zone` (slice 2) are on every session; `sessionSort` defaults to `custom` in `DEFAULT_UI` (`types.ts`) and `loadState` spreads saved values over it, so a changed default reaches fresh state only. The Claude `UserPromptSubmit` hook record carries `prompt` (`claude/normalise.ts:87` drops it); `AgentEvent` has no prompt event; `core.ts` `onEvent` (~:624) is the one place events reach sessions. `Session.lastLine?` and `UiState.sidebarView?` are added to `types.ts` up front, and the default sort is `viewed-desc`.

Implementer 1 (data: last prompt line):
- [x] `src/core/agents/types.ts`: add `{ type: 'prompt'; sessionId: string; text: string }` to `AgentEvent`
- [x] `src/core/claude/normalise.ts`: emit it on `UserPromptSubmit` when `prompt` is a string; check `copilot/normalise.ts` and `opencode/normalise.ts` for prompt text in their records and emit the same event where it exists, else record in a code comment that it has none
- [x] `src/core/core.ts`: in `onEvent`, store the first line of `text` (trimmed, cut at 120) as `Session.lastLine` for that session and publish; ignore blank text; persisted (not stripped on save)
- [x] tests beside the normalisers and in `src/core/sessions.test.ts`: the event, the cut, persistence in the state file

Implementer 2 (renderer: zones view):
- [x] `src/renderer/src/zoneList.ts` (new, pure): `zoneSections(sessions, now?)` returning needs-you, review, a running count (working sessions, top-level and children), and `recent` (about 5 by `lastFocusedAt` desc, never-focused left out, none already in another zone or counted as a row, a session once); a finished child is no row; a child is a row only in needs-you; `rowTitle(s)` (a session whose label still has the default pattern `Terminal · HH:MM` / `Claude · HH:MM` / `OpenCode · …` / `Copilot · …` shows `lastLine` as the title when set) and `rowLine(s)` (`lastLine`, else label and status text)
- [x] `src/renderer/src/zoneList.test.ts`
- [x] `src/renderer/src/components/ZoneSection.tsx` (new): a titled section of rows (title, one line, status dot, click focuses); Running (handled) collapsed to a count that opens to its rows; run-parent card keeps the existing collapsed children line (`N children, M done`) in both views
- [x] `src/renderer/src/components/Sidebar.tsx`: Zones/Projects toggle in the header, zones the default (`ui.sidebarView !== 'projects'`), persisted through `ui:set`; the existing project tree unchanged in Projects view; the default-name title rule applied in the project tree's cards too; context menu "Move to zone" (Needs you, Ready to review, Running, Reset) over `session:setZone`
- [x] `src/core/ipc` or `ui:set` handling: confirm `sidebarView` passes through `ui:set` (add to any whitelist)

Models passed: implementer: inherit, reviewer: inherit
### Review rounds

Round 1: blocking: the run parent's children line was a static span in the zones view, not expandable (plan: opens to the children in both views). Fix: a toggle on the shared `ui.collapsed` + `kidsKey` mechanism with child rows, `childrenSummary` ("N children, M done") in both views. Also fixed: "Move to zone" offered Ready to review for a child (`zonesFor`), and a default-named row repeated its title as its line. Result: Verification passes.
Round 2: fresh reviewer, no blocking findings.

Approved, 1 blocking in round 1, 1 fix round. Non-blocking left: children are open by default in the zones view (shared key with the tree); no renderer test for the toggle itself; a waiting child shows both in Needs you and under its parent; a parent with no zone and no `lastFocusedAt` has no zones-view row (Projects still shows it); shift-click range skips kid and Running rows; `recent` includes gone sessions; a slash command or injected message sent as a prompt can become `lastLine`; Copilot's `prompt` field is verified only from fixtures; the `sessionSort` default is set in `DEFAULT_UI`, so only fresh state gets it.

### Deviations

- The `viewed-desc` default sits in `DEFAULT_UI` (`types.ts`), not `stateStore.ts` (equivalent: saved values win, fresh state gets the new default).
- A new `prompt` `AgentEvent` (ignored by `status.apply` and the change tracker) carries the prompt text; OpenCode has none, so its rows keep label and status text.
- Run-parent children open by default in zones view, matching the project tree.

### Verification

`npm test` (110 files, 1352 tests) and `npm run typecheck` pass. New tests cover `zoneList` (grouping, the collapsed running count, five-most-recent, no duplicates, title and line rules, `zonesFor`), `childrenSummary`, the `prompt` event for Claude and Copilot, and `lastLine` (first line, cut at 120, blank ignored, in the state file, kept after reload). Models requested: implementer inherit, reviewer inherit.

### Left for the human

Run the app: zones appear in order, the toggle returns to the project tree, a session in Needs you is not also under Where you were, a default-named session shows its last-prompt line as title and keeps it across a reload, after a restart the same five sessions and lines show, "Move to zone" changes a row and keeps it after restart, and the children line opens to the children. Not checked: the look of the new CSS.

## Slice 4

Session: attention-ownership-slice-4-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `grove` commands go CLI (`src/cli/args.ts`, `index.ts`) -> `CliMethods` (`src/shared/cli.ts`) -> `dispatch` in `src/main/cliServer.ts` -> `core.commands`. Live fields (`status`, `waitingFor`, `zone`) are stripped in `core.ts` `set()` before save. `notifyTransitions` records `waitKey` and fires the `notify` listeners; `src/main/index.ts:118` builds the popup body from `BODY[waitingFor]`. `zoneOf` already puts a permission or question wait in needs-you. `rowLine` (`zoneList.ts`) is the row's second line; `childrenSummary` (`family.ts`) is the parent's children line, rendered in `ZoneSection.tsx` and the `SessionCard` meta in `Sidebar.tsx`. `Session.attention` and `Session.progress` (live) are added to `types.ts` up front. An escalation records the `waitingFor` it was made on and is dropped in `set()` once the session is not waiting on that.

Implementer 1 (core and CLI):
- [x] `src/cli/args.ts`: `escalate <ref> <reason>` and `progress <ref> <done>/<total>` (non-empty reason; integers, total >= 1, done <= total), usage text; `src/cli/args.test.ts`
- [x] `src/shared/cli.ts`: `sessions.escalate`, `sessions.progress`; `src/cli/index.ts` calls them; `src/shared/sessionErrors.ts`: `not-waiting`
- [x] `src/core/core.ts`: commands `sessionEscalate` (only a session waiting on a permission or question, else `not-waiting`; reason first line, cut at 200; no popup if one already fired for that wait, otherwise fire `notify` once with the reason on the session unless it is on screen) and `sessionProgress`; `attention` and `progress` stripped before save; `attention` dropped in `set()` when the session stops waiting or waits on something else
- [x] `src/main/cliServer.ts`: dispatch both (`bad-params`, `not-found`, `not-waiting`); `src/main/index.ts`: popup body is `s.attention?.reason` when set
- [x] `src/shared/zones.ts`: a waiting session with an attention reason is in needs-you
- [x] tests: `src/main/cliServer.test.ts`, `src/core/sessions.test.ts`, `src/shared/zones.test.ts`

Implementer 2 (renderer):
- [x] `src/renderer/src/zoneList.ts`: `rowLine` of a waiting session is its attention reason, else "Needs permission" / "Has a question"
- [x] `src/renderer/src/family.ts`: `runProgress(parent, kids)` (the declared progress and the children marked done, null when none declared) and its label ("4 of 8 slices done, 3 children done")
- [x] `src/renderer/src/components/RunProgress.tsx` (+ css module): a bar and label, used in `ZoneSection.tsx` rows and the `Sidebar.tsx` `SessionCard` meta for a parent with `progress`
- [x] tests: `src/renderer/src/zoneList.test.ts`, `src/renderer/src/family.test.ts`

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: fresh reviewer found no blocking findings; no fix round.

Approved, 0 blocking, 0 fix rounds. Cheap non-blocking applied: escalate now also sets `waitKey`, so a later `notifyTransitions` cannot pop a second time for the same wait. Left: the progress bar in the project-tree card shares the nowrap `branchLine` row with the kids toggle and branch (may be cramped; not seen in the app); a reason starting with `-` needs `--`; `notified` entries of a session removed while waiting linger; a child going straight from one permission prompt to another keeps the old reason; `grove progress` is accepted on any session and stays until restart.

### Deviations

- The progress bar shows only when a parent declared progress; the children-done-out-of-children-seen fallback is not built (it would put a bar on every ordinary parent). The label is "N of M slices done" (plus ", K children done"), not "Slice N of M".
- The `zoneOf` attention rule is a no-op today (permission and question waits are already needs-you); kept as the plan lists it.

### Verification

`npm test` (110 files, 1364 tests) and `npm run typecheck` pass. New tests: CLI parsing for both commands; `sessions.escalate` (not-waiting, not-found, bad params) and `sessions.progress` (valid, and 5/4, 0 total, negative, fractional rejected); core: an escalation after a popup adds the reason with no second notify, an away child gets exactly one notify, an on-screen child none, the escalation clears when the wait ends and a later prompt notifies without the old reason, neither field is saved, a working session cannot be escalated; `zoneOf` for an escalated child; `rowLine` reason and both fallbacks; `runProgress`. Models requested: implementer inherit, reviewer inherit.

### Left for the human

Run the app: `grove escalate <child> "asks to drop the table"` on a child waiting on a permission shows that text in Needs you (one popup in total for that prompt) and exits non-zero on a working child; `grove progress <parent> 4/8` shows the bar in both views. Not checked: the look of the bar in the project-tree card.

## Slice 5

Session: attention-ownership-slice-5-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `notifyTransitions` (`src/core/core.ts:611`) pops on first sight of a waiting status and records `waitKey`/`notified`; `sessionEscalate` (~:1090) sets the live `attention` and relies on `notified`/`waitKey`. `set('sessions')` runs `withZones(dropStaleAttention(...))` and strips live fields before save (:256). `countsAsWaiting` and `shownStatus` live in `src/renderer/src/sessionStatus.ts`; `zoneOf` in `src/shared/zones.ts`. `grove send` goes CLI (`src/cli/index.ts:25`) -> `sessions.send` (`src/shared/cli.ts:12`, `src/main/cliServer.ts:113`) -> `commands.sendToSession`, with no caller identity. `ConfigFile` is rewritten at `core.ts:247` from `configWorkflow`/`configSounds`, so a new field must be kept there. `ZoneSection.tsx` renders parent cards with a children line and `RunProgress`.

Implementer 1 (core, CLI, config, shared; no renderer files):
- [x] `src/shared/types.ts`: `ConfigFile.escalateAfterSec?: number`; live `Session.held?: boolean`; live `Session.handled?: HandledPrompt[]` with `HandledPrompt = { childId, at (ISO), kind: 'permission' | 'question', screen (last 8 lines), sent }`
- [x] `src/core/core.ts`: read `escalateAfterSec` at start (default 60, 0 = off), keep it in the config rewrite; in `notifyTransitions` hold a child's (has `parentId`) permission or question: set `held`, capture the last 8 lines of the pane, start one timer per child; on expiry, if still on that wait, clear `held` and notify as before (unless escalated); a top-level session and `escalateAfterSec` 0 notify at once; `held` and `handled` stripped before save; held cleared when the wait ends
- [x] `src/core/core.ts`: a note-send hook (`noteSend(id, text, fromSessionId)`): when the target is held and the caller id equals its `parentId`, remember the text; when the wait then clears inside the window, append a `handled` entry to the parent (when, kind, screen, text); a clear with no such send adds nothing; `sessionEscalate` ends the hold and notifies at once
- [x] `src/shared/zones.ts`: a held child is `running`, not needs-you
- [x] `src/shared/cli.ts`, `src/cli/index.ts`, `src/main/cliServer.ts`: `grove send` passes `process.env.GROVE_SESSION_ID` as `from`; the server resolves it and passes it to core
- [x] tests in `src/core/sessions.test.ts` (fake timers) and `src/shared/zones.test.ts`, plus CLI arg or server tests where they exist

Implementer 2 (renderer; types from implementer 1 as above):
- [x] `src/renderer/src/sessionStatus.ts`: `shownStatus` returns `working` for a held session, so `countsAsWaiting`, cmd+., the dots and `mostUrgent` follow
- [x] `src/renderer/src/components/ZoneSection.tsx` (+ css): a parent card shows a handled badge with `handled.length`; opening it lists time, kind, the screen tail and the sent text per entry; Running (handled) heading counts working sessions as before
- [x] tests in `src/renderer/src/sessionStatus.test.ts` (and a component test if the folder has them)

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: fresh reviewer found no blocking findings; no fix needed.

Approved, 0 blocking, 0 fix rounds. Non-blocking left: `zoneList.ts` `rowLine` and `workflow/derive.ts` read raw `status === 'waiting'`, so a held child shows its prompt subtitle and turns a feature card to waiting for up to the window; the expiry notify lacks the `id !== lastOnScreen` check that escalate has; only the last text of several sends in one hold is recorded; `dropSessions` does not end a hold early (bounded by the window); `escalateAfterSec` above the `setTimeout` 32-bit limit fires at once; `handled` is live-only and unbounded; the screen capture is asynchronous, so a very fast clear can record an empty screen.

### Deviations

`commands.sendToSession` takes an optional `from` instead of a separate `core.noteSend`. The hold is skipped when the child is on screen or not primed (neither notified before). `handled` and `held` are live only. The handled list opens as an inline list, not a floating popover. No component test for the badge: the repo has no `.test.tsx` and vitest only includes `src/**/*.test.ts`. The existing child-permission test now advances fake timers past the window.

### Verification

`npm test` (110 files, 1374 tests) and `npm run typecheck` pass. New fake-timer tests: a send from the parent within the window gives no notify and one handled entry with screen tail and text; a clear with no send adds none; an unanswered prompt notifies once after the window and not before; a send from a non-parent adds none; escalate still notifies at once; held and handled are not saved; `escalateAfterSec` survives a config rewrite; 0 turns the hold off. Plus zones, `sessionStatus`, args and cliServer tests. Models requested: implementer inherit, reviewer inherit.

### Left for the human

Observable check: with a child on a permission prompt, it shows in Needs you with a popup only after the window passes; and a parent's `grove send` answer inside the window shows in its handled badge. Not run here (needs the app).

## Open questions
