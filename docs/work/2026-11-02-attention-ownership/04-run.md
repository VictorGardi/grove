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

## Open questions
