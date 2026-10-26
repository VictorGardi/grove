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

## Slice 3

Session: parent-child-jump-slice-3-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `familyOf` (src/renderer/src/family.ts) already returns `children` ordered running-by-rank then ended (newest first); the `ended` predicate is module-private. `SessionMeta` declares `family?: { parent; active; onJump }` and App.tsx:198 / SessionGrid.tsx:145 already spread the whole `familyOf` result in, so `children` reaches it undeclared. `ContextPopover` (components/ContextGauge.tsx:23) is the pattern: a wrapping div ref, a button trigger with `aria-expanded`, the position computed from the trigger rect on click into CSS variables `--top`/`--left`, a `createPortal` popover on `document.body` with `position: fixed`, and document `mousedown`-outside and `Escape` listeners while open. `noInlineStyles.test.ts` allows only CSS-variable style objects.

Implementer 1:
- [x] `src/renderer/src/family.ts`: export the ended predicate as `isEnded(s)`; add `childrenCount(n)` → "1 child" / "N children"
- [x] New `src/renderer/src/components/ChildrenPopover.tsx` + `ChildrenPopover.module.css` following `ContextPopover`: trigger `<button>` with the `childrenCount` text and `aria-expanded`, portal popover (`role="dialog"`, aria-label "Children") positioned through `--top`/`--left`, outside `mousedown` and `Escape` close; one `<button>` row per child with `StatusDot tone={statusTone(c)}`, truncated label, and "ended" when `isEnded(c)`; a row click calls `onJump(c.id)` and closes
- [x] `src/renderer/src/components/SessionMeta.tsx`: type `family` as `Family & { onJump }`; render `<ChildrenPopover children onJump />` after the active-child chip when `children` is non-empty
- [x] App.tsx and SessionGrid.tsx already pass `children` via the spread; no change unless typecheck says so
- [x] Extend `src/renderer/src/family.test.ts`: `childrenCount(1)`, `childrenCount(3)`; mixed running/ended order (running by rank, then ended); a parent whose children all ended has `active: null`
- [x] Extend `src/renderer/src/sessionMetaRender.test.ts`: the trigger renders "1 child" / "3 children"; the list body is not rendered while closed; a parent with only ended children renders "2 children" and no active chip; no trigger without children

Models passed: implementer: inherit; reviewer: inherit

### Review rounds

Round 1: 0 blocking; non-blocking applied: Escape is caught in the capture phase and swallowed so a focused terminal does not take it; the list's max-height accounts for its top so a low pane header cannot push rows off-screen; the trigger's hover colour matches the other chips; the trigger has a title.

Approved, 0 blocking, 0 fix rounds. Non-blocking left: the open list (row order, the "ended" mark) is not render-tested, since static markup cannot open it; covered by `familyOf` order tests and the manual check below. With one child the header shows both the active-child chip and "1 child", as the outcome specifies.

### Deviations

The popover prop is `kids`, not `children` (React reserves `children`). `family.ts` exports `isEnded` (the former private `ended`) for the "ended" mark. The list is 260px wide, scrolls past a max height, and the trigger stays underlined while open. App.tsx and SessionGrid.tsx are unchanged: they already spread the whole `familyOf` result.

### Verification

`npm test`: 97 files, 1149 tests pass, including the new cases in `family.test.ts` (count label for 1 and 3; running-by-rank then ended order; all-ended parent has no active child) and `sessionMetaRender.test.ts` ("1 child" / "3 children"; no list while closed; an all-ended parent renders "2 children" and no active chip; no trigger without children), and `noInlineStyles.test.ts`. `npm run typecheck`: passes (node and web). Models requested: implementer: inherit; reviewer: inherit.

### Left for the human

Manual check with `npm run dev`: open "N children" on a parent (header and grid pane), confirm running children come first and ended ones are marked, a row click focuses that child and closes the list, and an outside click or Escape closes it (also with a terminal focused in a grid pane).

## Slice 4

Session: parent-child-jump-slice-4-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `MenuAction` is a union in src/shared/ipc.ts:4-8. src/main/menu.ts `buildMenu(send, installCli, installSkill)` builds the template and calls `Menu.setApplicationMenu(Menu.buildFromTemplate(template))`; the Session submenu ends with "Next Waiting Session" (`CmdOrCtrl+.`); the View items are pushed after, plus dev-only items when `!app.isPackaged`. App.tsx `runAction` (:81) reads `useSlices.getState()` and dispatches on `a.type` with an if/else chain; `nextWaiting` is the model (`if (w) setFocused(w.id)`). `familyOf` in src/renderer/src/family.ts already gives `parent` and `active`; `active` ranks ties by later `lastFocusedAt`, which the main process sets on focus. No main-side test mocks electron yet.

Implementer 1:
- [x] `src/shared/ipc.ts`: add `{ type: 'familyJump' }` to `MenuAction`
- [x] `src/main/menu.ts`: Session submenu item "Jump to Parent / Active Child", accelerator `CmdOrCtrl+Shift+J`, after "Next Waiting Session", sending `{ type: 'familyJump' }`
- [x] `src/renderer/src/family.ts`: `familyJumpTarget(sessions, focusedId) → Session | null` (parent if it has one, else the active child, else null; null for a null/unknown id)
- [x] `src/renderer/src/App.tsx` `runAction`: on `familyJump`, `const t = familyJumpTarget(sessions, ui.focusedSessionId)`; `if (t) setFocused(t.id)`
- [x] Extend `src/renderer/src/family.test.ts`: active child for a parent, parent for a child, null for a lone session, null for a parent with only ended children, and the parent → child → parent → same active child round trip (bumping `lastFocusedAt` on each visited session)
- [x] New `src/main/menu.test.ts`: `vi.mock('electron')` capturing the template passed to `Menu.buildFromTemplate`; exactly one `CmdOrCtrl+Shift+J` that sends `familyJump`; every previous accelerator still present and all accelerators unique

Models passed: implementer: inherit; reviewer: inherit

### Review rounds

Round 1: 0 blocking; non-blocking applied: dropped a redundant unknown-id guard in `familyJumpTarget` (`familyOf` already gives nothing for an unknown id); the round-trip test now gives the earlier-started child an older `lastFocusedAt` so the first jump is decided by `lastFocusedAt`, not `startedAt`.

Approved, 0 blocking, 0 fix rounds. Non-blocking left: the menu test's list of earlier accelerators is hand-copied and can drift when shortcuts are added (the uniqueness check is the part that generalises); from a child whose parent has ended but still exists, ⌘⇧J goes to that ended parent, as the outcome specifies (case 7).

### Deviations

`familyJumpTarget` also returns null for a null or undefined focus. A session whose parent was removed and which has children of its own jumps to its active child (parent first, else active child, as planned).

### Verification

`npm test`: 98 files, 1156 tests pass, including the new `familyJumpTarget` cases in `family.test.ts` (active child for a parent, parent for a child, null for a lone session, unknown id and no focus, null for a parent with only ended children, and the parent → child → parent → same child round trip) and the new `src/main/menu.test.ts` (exactly one `CmdOrCtrl+Shift+J`, sending `familyJump`; every earlier accelerator present; all unique). `npm run typecheck`: passes (node and web). `npm run build`: passes. Models requested: implementer: inherit; reviewer: inherit.

### Left for the human

Manual check with `npm run dev`: focus a parent with a running child, press ⌘⇧J three times and confirm parent → child → parent → the same child; confirm ⌘⇧J does nothing on a lone session; confirm the Session menu lists "Jump to Parent / Active Child ⇧⌘J".

## Slice 5

Session: parent-child-jump-slice-5-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `SessionMeta.module.css` `.row` is a no-wrap flex row with no `overflow`; `.lead` is `0 1 auto`, `.branch` `0 2 auto` (max 28ch), `.feature` `0 3 auto`, `.status` `none`, the jump `.chip` `0 2 auto` with `min-width: 0` (so it shrinks at the branch's rate, and its dot and arrow can be squeezed), and `ChildrenPopover`'s `.wrap`/`.trigger` are `none`. In the main view the row sits in `ContentHeader`'s `.left` (`overflow: hidden`, nowrap), so it is clipped rather than wrapped; in a grid pane the row sits in `SessionGrid.module.css` `.header` (no overflow), so a narrow span-1 pane lets the row spill out. Grid wiring needs no change: `SessionGrid.tsx` passes `family={{ ...familyOf(all, x.id), onJump: onFocusPane }}`, `startPick` skips `<button>` targets (all chips and popover rows are buttons), and the pane's `onMouseDownCapture` focuses it first. The "holding focus" marker is already computed at Sidebar.tsx:517 (`holdsFocus` when the parent's group is collapsed and a hidden child is focused): confirmed, not rebuilt.

Implementer 1:
- [x] `src/renderer/src/components/SessionMeta.module.css`: `.row` gets `overflow: hidden` so a pane header never spills; `.chip` shrinks first (`flex: 0 4 auto`, a small `min-width` so the arrow and dot stay, its dot and arrow `flex: none`, the label ellipsis); `.lead` keeps a minimum (`min-width` of a few ch) so the lead and status keep space; comments say the shrink order (chips, then feature title, then branch, then lead)
- [x] `src/renderer/src/sessionMetaRender.test.ts`: a grid-pane configuration (`actions` set, `context` set) for a session that is both a child and a parent renders the "↑ parent" chip, the active-child chip and "N children" inside the one `SessionMeta` row, after the status and before the actions
- [x] `src/renderer/src/sessionMetaRender.test.ts` (or a sibling CSS test): reads `SessionMeta.module.css` and asserts the row does not wrap (no `flex-wrap: wrap`, `overflow: hidden`) and `.chip`'s flex-shrink is greater than `.branch`'s and `.lead`'s

Models passed: implementer: inherit; reviewer: inherit

### Review rounds

Round 1: 1 blocking: `overflow: hidden` on `.row` clipped the focus ring of the pane's round action buttons (the outline sits 2px outside them). Fix: dropped it (the grid `.pane` and `ContentHeader`'s `.left` already clip the row), the CSS test now asserts only no `flex-wrap: wrap`; also applied: accurate shrink-order comments, a chip minimum that fits arrow + 6px dot + two gaps, `.row > button:not(.chip) { flex: none }` so the pane's action buttons are never squeezed, a `flex-shrink` longhand fallback in the CSS test, the weak `endsWith('</div>')` check removed. Result: Verification passes.
Round 2: 0 blocking. Non-blocking applied: the shrink order stated once (on `.row`), the redundant `.chip > .truncate` rule dropped, the CSS test also asserts `.status` is `flex: none`, `.lead` has `min-width: 6ch` and `.row` has no `overflow: hidden`, the selector in the test helper is escaped and the row-class match cannot hit a class like "arrow".

Approved, 1 blocking, 1 fix round. Non-blocking left: in a very narrow span-1 pane the actions sit last and are clipped from the right before the lead gives way, as before this slice; the CSS test reads the stylesheet text, so it checks the rules, not the rendered layout.

### Deviations

`.row` does not get `overflow: hidden` (the slice plan's first step): it cut the focus rings; the pane and the content header already clip the row. Added `.row > button:not(.chip) { flex: none }` to keep the pane's action buttons whole. `SessionGrid.tsx` is unchanged: the slice 1 wiring already focuses the target and chips are buttons, so no drag starts.

### Verification

`npm test`: 98 files, 1159 tests pass, including the new grid-pane render test (a session that is both a child and a parent, with `actions` and `context` set: the "↑ parent" chip, the active-child chip and "1 child" render inside the one row, after the status and before the actions) and the row CSS test (no `flex-wrap: wrap`, no `overflow: hidden` on `.row`, `.chip` shrinks more than `.branch` and `.lead`, `.status` is `flex: none`, `.lead` keeps `min-width: 6ch`). `npm run typecheck`: passes (node and web). `npm run build`: passes. The collapsed-group "holding focus" marker is computed at Sidebar.tsx:517 (confirmed in the code, not rebuilt). Models requested: implementer: inherit; reviewer: inherit.

### Left for the human

Manual check with `npm run dev`: start a session, run `grove new claude --child` from it twice, open both in the grid with ⌘⇧G, confirm the parent's pane shows the chip and "2 children", clicking the chip focuses the child pane, dragging a pane by its title still works, and narrowing the window and a span-1 pane in a many-column grid keeps the header to one row. Then show the main view, collapse the parent's group in the sidebar, press ⌘⇧J from the parent and confirm the child is focused and the parent's kids toggle shows the "holding focus" marker.

## Final summary

- Slice 1: `2026-10-26-parent-child-jump: slice 1 — A parent's header shows its active child, and clicking it jumps there`: pure `familyOf` (parent, ranked children, active child) and an active-child chip in `SessionMeta`, used by the content header and every grid pane. Review: approved, 0 fix rounds. Deviations: an exported `Family` type; in a pane the chip jumps through `onFocusPane`.
- Slice 2: `2026-10-26-parent-child-jump: slice 2 — A child's header shows "↑ parent", and clicking it jumps to the parent`: an "↑ parent" chip on children (also for an ended parent, none for a removed one). Review: approved, 0 fix rounds. Deviations: one shared `.chip` class; the whole `familyOf` result is spread into the prop.
- Slice 3: `2026-10-26-parent-child-jump: slice 3 — "N children" opens a list of every child; clicking one jumps to it`: `ChildrenPopover` with the count, a portalled list (running by rank, then ended marked "ended"), closing on a jump, outside click or Escape. Review: approved, 0 fix rounds. Deviations: the prop is `kids`; `isEnded` exported.
- Slice 4: `2026-10-26-parent-child-jump: slice 4 — ⌘⇧J jumps parent → active child and child → parent`: `familyJump` menu action on `CmdOrCtrl+Shift+J` in the Session menu, `familyJumpTarget`, and a menu test that every accelerator stays present and unique. Review: approved, 0 fix rounds. Deviations: null focus also yields no target.
- Slice 5: `2026-10-26-parent-child-jump: slice 5 — Grid panes and the one-row header hold up`: the row's shrink order (chips fastest, then feature title, branch, lead; status never), chip minimum keeps arrow and dot, pane action buttons never squeezed, render and CSS tests. Review: approved, 1 fix round. Deviations: no `overflow: hidden` on the row (it clipped focus rings).

### Left for the human

- Slice 1: click the active-child chip in the header and in the parent's grid pane; the child is focused.
- Slice 3: open "N children" in the header and a pane; running first, ended marked; a row click focuses and closes; outside click and Escape close it (also with a terminal focused).
- Slice 4: ⌘⇧J three times from a parent goes parent → child → parent → the same child; nothing on a lone session; the Session menu lists "Jump to Parent / Active Child ⇧⌘J".
- Slice 5: the grid, drag, narrow-window and collapsed-group "holding focus" checks listed under Slice 5.

### PR description

Session family in the header: jump between a parent and its active child

A session that belongs to a family now shows it in its header and in every grid pane header, and lets you jump inside it in one step.

- A parent shows a chip for its active child (the running child that needs you most: waiting, then working, then idle, then plain running, then starting; ties by most recently viewed, then newest) and an "N children" control that lists every child, running first and ended last; clicking any entry focuses it.
- A child shows "↑ <parent>", also when the parent has ended; a child whose parent was removed shows nothing, as before.
- ⌘⇧J (Session → Jump to Parent / Active Child) goes parent → active child and child → parent, and does nothing on a session with no family or a parent whose children have all ended.
- The header stays one row: the chips shrink first and keep their arrow and status dot, the lead and status keep their space, and the grid pane's buttons keep their size and focus ring.
- All family facts come from one pure function (`src/renderer/src/family.ts`), so the header, the panes and the shortcut cannot disagree. No new persisted fields, IPC channels or CLI surface; the sidebar, palette and Ctrl+Tab are unchanged.

Verified: `npm test` (98 files, 1159 tests, new `family.test.ts`, `sessionMetaRender.test.ts`, `main/menu.test.ts`), `npm run typecheck`, `npm run build`. Left for the human: the manual checks in `04-run.md` (chip clicks in header and grid, the children list, ⌘⇧J round trip, drag and narrow-pane layout, the collapsed-group "holding focus" marker).

## Open questions
