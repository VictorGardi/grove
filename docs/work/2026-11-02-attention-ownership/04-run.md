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

## Open questions
