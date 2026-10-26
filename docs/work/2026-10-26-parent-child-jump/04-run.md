---
feature: 2026-10-26-parent-child-jump
phase: run
status: draft
version: 1
created: 2026-10-26
updated: 2026-10-26
approved_at:
based_on: [03-plan.md@1]
forced: []
---

# Run: session children in the parent header, jump to the active child

Profile: inherit
Branch: feature/2026-10-26-parent-child-jump-inherit
Plan commit: bc21be36b1bce86833d9784ca1a812be768b5075
Roles:
- cto: claude, inherit
- researcher: claude, inherit
- planner: claude, inherit
- reviewer: claude, inherit
- implementer: claude, inherit

## Slice 1

Session: parent-child-jump-slice-1-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `SessionMeta` (src/renderer/src/components/SessionMeta.tsx) is a hook-free row: lead, branch, feature, status (`StatusDot` + `statusView` label), spacer, context, actions. The content header renders it at App.tsx:192-195 with `sessions` and `setFocused` in scope from `useSlices()`. `SessionGrid` renders it per pane at SessionGrid.tsx:141; its `sessions` prop holds only the grid members, so the full list must come from `useSlices()`; the pane's `onMouseDownCapture` already focuses the pane before any click, and `startPick` skips `<button>` targets. `sessionStatus.ts` has `shownStatus` (failed/gone/starting/live status/running) and `statusTone` (waiting·done → finished). `Session` has `parentId`, `lastFocusedAt`, `startedAt`, `waitingFor`. Render tests use `renderToStaticMarkup` in node (boardRender.test.ts).

Implementer 1:
- [x] New `src/renderer/src/family.ts`: `familyOf(sessions, id)` with parent, ranked children (waiting < working < idle < running < starting; ties later `lastFocusedAt`, missing last, then later `startedAt`; ended = gone/failed after, by later `startedAt`) and `active`
- [x] New `src/renderer/src/family.test.ts` with every case named in the slice Verification
- [x] `src/renderer/src/components/SessionMeta.tsx` + `SessionMeta.module.css`: optional `family?: { active: Session | null; onJump: (id: string) => void }`, a `<button>` chip after the status with `StatusDot tone={statusTone(active)}` and a truncated label, `title` with full label and status
- [x] `src/renderer/src/App.tsx` session header: pass `family={{ active: familyOf(sessions, id).active, onJump: setFocused }}`
- [x] `src/renderer/src/components/SessionGrid.tsx`: take all sessions from `useSlices()`, pass `family` with `onJump: onFocusPane`
- [x] New `src/renderer/src/sessionMetaRender.test.ts`: chip with child label for a parent with a running child; no chip without family

Models passed: implementer: inherit; reviewer: inherit

### Review rounds

Round 1: 0 blocking; non-blocking applied: malformed ISO times sort last instead of NaN (family.ts), a test for identical `lastFocusedAt` broken by `startedAt`, corrected the chip's CSS comment.

Approved, 0 blocking, 0 fix rounds. Non-blocking left: redundant `family &&` guard in SessionMeta.tsx (TypeScript needs it for `family.onJump`); the click path is not unit-tested (node-only render tests), covered by the manual check below.

### Deviations

`family.ts` also exports a `Family` interface; one extra test checks the parent is found only while it still exists, one checks starting ranks after running. In a grid pane the chip jumps through `onFocusPane` (which is `setFocused`); in an unfocused pane the pane's existing mousedown focus fires first, then the jump.

### Verification

`npm test`: 97 files, 1137 tests pass (new `family.test.ts`, `sessionMetaRender.test.ts`). `npm run typecheck`: passes (node and web). Models requested: implementer: inherit; reviewer: inherit.

### Left for the human

Manual check with `npm run dev`: in a session run `grove new claude --child`, focus the parent, click the chip in the header and confirm the child is focused; open both in the grid (⌘⇧G) and do the same from the parent's pane.

## Slice 2

Session: parent-child-jump-slice-2-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `familyOf` (src/renderer/src/family.ts) already returns `parent` (the session named by `parentId` while it still exists, else null), so a removed parent already yields null. `SessionMeta` takes `family?: { active; onJump }` and renders the active-child `<button>` chip (`.child` in SessionMeta.module.css) after the status. App.tsx:198 and SessionGrid.tsx:145 pass only `familyOf(...).active`. `statusView`/`statusTone` give an ended parent a gone/failed label and tone, so the chip renders the same for ended parents. Render tests use `renderToStaticMarkup` (sessionMetaRender.test.ts).

Implementer 1:
- [x] `src/renderer/src/components/SessionMeta.tsx`: `family` gains `parent: Session | null`; when set, render a `<button>` "↑ <parent label>" chip (aria-label `Jump to parent <label>`, title with label and status, `StatusDot` with `statusTone(parent)`), click calls `family.onJump(parent.id)`; reuse the `.child` chip style (rename or share a class in `SessionMeta.module.css`)
- [x] `src/renderer/src/App.tsx` and `src/renderer/src/components/SessionGrid.tsx`: compute `familyOf` once and pass `{ parent, active, onJump }`
- [x] Extend `src/renderer/src/sessionMetaRender.test.ts`: a child renders "↑" and the parent's label; an ended (gone) parent still renders the chip; `parent: null` renders no up chip
- [x] Extend `src/renderer/src/family.test.ts`: a child whose `parentId` names a missing session gets `parent: null`; an ended parent is still returned

Models passed: implementer: inherit; reviewer: inherit

### Review rounds

Round 1: 0 blocking. Approved, 0 fix rounds. Non-blocking left: the `family` prop gets the whole `familyOf` result spread in (so `children` rides along undeclared; slice 3 declares it, typing the prop as `Family & { onJump }` is the cleaner option then); the ended-parent render test checks the aria-label but not the status in the title; the removed-parent `familyOf` test relies on the helper's default `parentId`.

### Deviations

The active-child chip's `.child` class is now a shared `.chip` class used by both chips. App.tsx and SessionGrid.tsx pass `{ ...familyOf(...), onJump }` instead of picking `parent` and `active`. On a session that is both a child and a parent, the up chip comes first, then the active-child chip.

### Verification

`npm test`: 97 files, 1142 tests pass (new cases in `family.test.ts` and `sessionMetaRender.test.ts`: a child renders "↑" and the parent's label; a missing parent gives `parent: null` and no chip; an ended parent still renders the chip). `npm run typecheck`: passes (node and web). Models requested: implementer: inherit; reviewer: inherit.

### Left for the human

none

## Open questions
