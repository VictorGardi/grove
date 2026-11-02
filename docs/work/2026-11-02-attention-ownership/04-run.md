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

## Open questions
