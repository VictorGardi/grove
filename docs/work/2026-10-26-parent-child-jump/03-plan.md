---
feature: 2026-10-26-parent-child-jump
phase: plan
status: approved
version: 1
created: 2026-10-26
updated: 2026-10-26
approved_at: 2026-10-26
based_on: [01-outcome.md@1, 02-research.md@1]
forced: []
---

# Plan: session children in the parent header, jump to the active child

Paths are relative to `src/`. The family facts (parent, children, active child) come from one pure function so the header, the grid panes and the shortcut cannot disagree. `SessionMeta` is the shared row for the content header and the grid pane header (SessionMeta.tsx:10-13), so the chips go there and both views get them.

## Decisions

### D1. The keyboard shortcut for the family jump

**Context.** The shortcut is a native menu accelerator (main/menu.ts). Once people build muscle memory for it, changing it is costly, so it is chosen now. It must not collide with the taken keys (⌘T, ⌘⇧T, ⌘J, ⌘N, ⌘W, ⌘1..9, Ctrl+Tab, ⌘., ⌘B, ⌘⇧B, ⌘⌥B, ⌘G, ⌘⇧G, ⌘K), and it must work on non-US keyboard layouts (a Swedish layout puts `;` and `:` behind Shift).

**Options.**
- A. ⌘⇧J ("jump"). Pros: a letter, so it works on every layout; free; sits under the Session menu next to Last Session and Next Waiting. Cons: shares a key with ⌘J (New Terminal), one Shift away.
- B. ⌘⇧. Pros: sits next to ⌘. (Next Waiting), both are "go where you're needed". Cons: Shift+. is `:` on Swedish and German layouts, so the accelerator may not fire or may need a different physical key.
- C. Ctrl+⇧Tab. Pros: pairs visually with Ctrl+Tab (Last Session). Cons: most apps use Ctrl+⇧Tab for "reverse of Ctrl+Tab", so it reads as a different action than it does.

**Pick:** A. ⌘⇧J

**Outcome impact.** The jump is ⌘⇧J on macOS (`CmdOrCtrl+Shift+J`, so Ctrl+Shift+J elsewhere), listed in the Session menu as "Jump to Parent / Active Child". The command palette gets no entry (brief non-goal). Nothing else changes.

No other one-way decisions: the active-child rule, the chips and the list are all derived in the renderer from data that already exists (`parentId`, live status, `lastFocusedAt`, `startedAt`), with no new persisted fields, IPC channels or CLI surface, so every other choice is cheap to change later.

## Slices

### Slice 1. A parent's header shows its active child, and clicking it jumps there

**Outcome.** Looking at a parent with at least one running child, the header row (and every grid pane header, since they share `SessionMeta`) shows a chip with the active child's status dot and label. Clicking it focuses that child exactly as a sidebar click does. Sessions with no running child, and sessions with no family, look as they do today.
**Thin end-to-end:** session data in the store -> pure `familyOf` rule -> `SessionMeta` chip -> click -> `setFocused` -> `ui:set` -> the child is shown. Deliberately missing: the "N children" control and list (slice 3), the "↑ parent" chip on children (slice 2), the shortcut (slice 4), grid-pane polish (slice 5).
**Files.**
- New `renderer/src/family.ts`: `familyOf(sessions, id) → { parent: Session | null, children: Session[], active: Session | null }`. `parent` is the session named by `parentId` if it still exists. `children` are all sessions with `parentId === id`, ordered running first by rank, then ended. A child is ended when `shownStatus` is `gone` or `failed`. Rank for running children: `waiting` (any `waitingFor`) < `working` < `idle` < `running` (a child with no live agent status, e.g. a terminal) < `starting`. Ties: later `lastFocusedAt` first (missing sorts last), then later `startedAt`. Ended children sort among themselves by later `startedAt` first, so the list never follows store order. `active` is the first running child, or null.
- New `renderer/src/family.test.ts`.
- `renderer/src/components/SessionMeta.tsx` (+ `SessionMeta.module.css`): new optional prop `family?: { active: Session | null; onJump: (id: string) => void }`, rendered after the status as a `<button>` chip (a button, so the grid's drag handler at SessionGrid.tsx:100 ignores it) with `StatusDot` (`statusTone`) and a truncated label; `title` gives the full label and status.
- `renderer/src/App.tsx` (session header, :225-237) and `renderer/src/components/SessionGrid.tsx` (:141): compute `familyOf(sessions, x.id)` and pass `family` with `onJump: setFocused` (grid: the pane's existing focus path, then `setFocused`).
- New `renderer/src/sessionMetaRender.test.ts`: renders `SessionMeta` with `renderToStaticMarkup` (it is hook-free).
**Verification.** `npm test` passes, including new tests: `familyOf` picks waiting over working over idle; a sole running child is active; ended and failed children are never active; ties go to the later `lastFocusedAt`, then later `startedAt`; a `waitingFor: 'done'` child beats a working child; ended children order by later `startedAt`; a parentless, childless session gets `{parent: null, children: [], active: null}`. The render test shows the chip with the child's label for a parent with a running child and no chip for a session without family. `npm run typecheck` passes. Manual check with `npm run dev`: in a session run `grove new claude --child`, focus the parent, click the chip in the header and confirm the child is focused; open both in the grid (⌘⇧G) and do the same from the parent's pane.

### Slice 2. A child's header shows "↑ parent", and clicking it jumps to the parent

**Outcome.** A child's header (and grid pane header) shows a chip "↑ <parent label>" that focuses the parent on click, whether the parent is running or ended. A child whose parent was removed is standalone (already true via `orphanChildren`) and shows no chip.
**Files.** `renderer/src/components/SessionMeta.tsx` (+ css): `family` prop gains `parent: Session | null`; render the up chip when set. `App.tsx`, `SessionGrid.tsx`: pass `parent` from `familyOf`. Extend `renderer/src/sessionMetaRender.test.ts` and `renderer/src/family.test.ts`.
**Verification.** `npm test` passes, including: a child renders "↑" and the parent's label; a child whose `parentId` names a session that no longer exists gets `parent: null` and no chip; an ended parent still renders the chip. `npm run typecheck` passes.

### Slice 3. "N children" opens a list of every child; clicking one jumps to it

**Outcome.** A parent's header shows "1 child" / "N children" after the active-child chip (or alone when every child has ended). Clicking it opens a list of every child with status dot and label, running ones first by rank, ended ones last and marked ended. Clicking any entry focuses it and closes the list; an outside click or Escape closes it.
**Files.**
- New `renderer/src/components/ChildrenPopover.tsx` (+ `.module.css`), following `ContextPopover` (components/ContextGauge.tsx:23): a button trigger, a portal popover positioned from the trigger rect, `mousedown` outside and `Escape` close it. Rows are `<button>`s (they must stay buttons: portal events still bubble through the grid pane's `onMouseDownCapture` and the header's `onPointerDown`, and `startPick` skips buttons; a row click in an unfocused pane focuses that pane first, then jumps, which is expected) showing `StatusDot` + label + "ended" for ended children; click calls `onJump(id)` and closes.
- New pure helper in `renderer/src/family.ts`: `childrenCount(n)` label ("1 child", "N children").
- `SessionMeta.tsx`: `family` gains `children: Session[]`; render `ChildrenPopover` when non-empty. `App.tsx`, `SessionGrid.tsx`: pass `children`.
- Extend `renderer/src/family.test.ts` and `renderer/src/sessionMetaRender.test.ts` (the trigger text renders; the popover body is not rendered while closed).
**Verification.** `npm test` passes, including: the count label for 1 and 3 children; children order is running-by-rank then ended; a parent whose children all ended renders "N children" and no active chip. `npm run typecheck` passes. `renderer/src/noInlineStyles.test.ts` passes (popover position goes through CSS variables, as `ContextPopover` does).

### Slice 4. ⌘⇧J jumps parent → active child and child → parent

**Outcome.** With a session focused, ⌘⇧J goes to its active child if it is a parent, to its parent if it is a child, and does nothing otherwise (no family, or a parent whose children have all ended). From a parent, pressing it three times goes parent → active child → parent → the same active child (the visited child has the newest `lastFocusedAt`, which wins ties). Existing shortcuts are unchanged.
**Files.**
- `shared/ipc.ts`: add `{ type: 'familyJump' }` to `MenuAction`.
- `main/menu.ts`: Session submenu item "Jump to Parent / Active Child", accelerator `CmdOrCtrl+Shift+J`, after "Next Waiting Session".
- `renderer/src/family.ts`: `familyJumpTarget(sessions, focusedId) → Session | null` (parent if the session has one, else the active child, else null).
- `renderer/src/App.tsx` `runAction`: on `familyJump`, `const t = familyJumpTarget(sessions, ui.focusedSessionId)`; `if (t) setFocused(t.id)`.
- Extend `renderer/src/family.test.ts`; new `main/menu.test.ts` with `vi.mock('electron')` capturing the template passed to `Menu.buildFromTemplate`.
**Verification.** `npm test` passes, including: `familyJumpTarget` returns the active child for a parent, the parent for a child, null for a lone session, null for a parent with only ended children, and parent → child → parent → the same active child round-trips; the menu has exactly one `CmdOrCtrl+Shift+J` and every previous accelerator is still present and unique. `npm run typecheck` and `npm run build` pass.

### Slice 5. Grid panes and the one-row header hold up

**Outcome.** In the grid, every pane header shows the same chips and list, and clicking a chip focuses the target without starting a pane drag. The header row stays one row when chips are added: chips and the branch truncate before wrapping. Jumping to a child hidden in a collapsed sidebar group shows the existing "holding focus" marker on the parent (already wired at Sidebar.tsx:517; confirmed, not rebuilt).
**Files.** `renderer/src/components/SessionMeta.module.css` (chip `min-width: 0`, ellipsis, `flex-shrink` order so the lead and status keep space), `renderer/src/components/SessionGrid.tsx` (only if slice 1 wiring needs adjusting for pane focus), `renderer/src/sessionMetaRender.test.ts`.
**Verification.** `npm test`, `npm run typecheck` and `npm run build` pass. The render test shows the chips inside the `SessionMeta` row in a grid-pane configuration (`actions` set). Manual check with `npm run dev`: start a session, run `grove new claude --child` from it twice, open both in the grid with ⌘⇧G, confirm the parent's pane shows the chip and "2 children", clicking the chip focuses the child pane, dragging a pane by its title still works, and narrowing the window and a span-1 pane in a many-column grid keeps the header to one row. Then show the main view, collapse the parent's group in the sidebar, press ⌘⇧J from the parent and confirm the child is focused and the parent's kids toggle shows the "holding focus" marker.

## Reviewer round log

- Round 1 (0 blocking, 9 non-blocking). Applied: manual click checks in slice 1; `waiting · done` and ended-order test cases; ended children ordered by `startedAt`; slice 4 round-trip restated and menu test committed to `main/menu.test.ts`; portal-bubbling note on popover rows; collapsed-group and narrow-pane manual checks in slice 5; cross-platform and no-palette notes on D1.
- CTO check (0 blocking).
- Human review 2026-10-26: no vetoes; D1 kept as ⌘⇧J.

## Deviations from the brief the human should know

- The brief ranks running children "waiting, then working, then idle" and puts starting last. A child with no live agent status (a plain terminal, shown as "running") is not mentioned; the plan ranks it after idle and before starting.
- "Waiting" includes finished-but-unseen children (`waiting · done`), as the sidebar does, so a child that just finished takes the chip.

## Risks and what is deliberately not done

- Jumping from a grid pane to a child that is not in the grid leaves the grid view, because the content area only shows the grid when it contains the focused session (navigation.ts `content()`). That is "the same as clicking that session elsewhere" per the brief; adding the child to the grid is not done.
- The header is one row in a fixed-height bar; with a long breadcrumb, branch and feature tag the chips get little room. Slice 5 makes them truncate first; very narrow windows will show mostly the dot.
- The active child is computed in the renderer only. The CLI (`grove`) does not learn about it; out of scope per the non-goals.
- No sidebar, rail, palette or Ctrl+Tab changes, no hand-pinned active child, no cycling through children, no deeper nesting, no notifications (brief non-goals).

## Open questions
