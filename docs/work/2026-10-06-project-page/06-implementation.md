---
feature: 2026-10-06-project-page
phase: implementation
status: draft
version: 1
created: 2026-10-06
updated: 2026-10-06
approved_at:
based_on:
  - 01-questions.md@1
  - 05-plan.md@4
forced:
  - "size M / UI-state shape change in small flow: every decision, including the ui-state shape, was made by the human in grilling and recorded in ADR 0018 and 00-ticket.md; small flow chosen deliberately (2026-10-06)"
---

# Implementation: project page

## Progress

- [x] Slice 1 — Project page, three-way focus, Projects tab, breadcrumbs, ⌘B
- [x] Slice 2 — Sessions board and the Features | Sessions switch
- [x] Slice 3 — Rich feature cards
- [x] Slice 4 — `CONTEXT.md`

## Slice 1

Deviations:

- A focused feature that disappears from discovery is **not** rewritten in
  core to `focusedProject`. The renderer's `content()` falls back to that
  feature's project page instead. Rewriting in core would also fire on a
  transient workflow error (no items) and lose the focus for good. The
  visible result matches the plan.
- `featureSummary` (`featureLabels.ts`) was only used by the removed sidebar
  feature row, so it was deleted, along with the sidebar's `.children`,
  `.chevron` and `.iconFeature` styles.
- `Tag` gained an optional `onClick` (renders a button) for the clickable
  parent tag; `ContentHeader` exports `HeaderCrumb`.
- The empty state with no projects now says "Add a project with the folder ＋
  in the sidebar" (there's always a project page once a project exists).
- Tests run outside the sandbox: the OpenCode client tests bind a local port.

## Slice 2

Deviations:

- "Time in state" for live sessions is counted from when the renderer first
  saw the current status (app start, session creation, or the last status
  change), since no status-change time is persisted; ended sessions use
  `endedAt`. Restarting the app resets live durations.
- The Sessions board's feature tag uses the feature's group colour (its own
  slug for a group feature, else its parent's), like the sidebar card.
- `tree.ts` now imports `shownStatus` from `sessionStatus.ts`.

## Slice 3

Deviations:

- "Progress for group features" (decision 4) adds nothing to the board:
  group features are not board cards. Their progress stays on their feature
  page header.
- The card-state tones (`CARD_STATE_TONES` in `featureLabels.ts`) reuse the
  existing status palette; no new tokens.

## Slice 4

Deviations:

- `CONTEXT.md` is edited but **not committed**: its committed Terms list is
  empty and every entry is uncommitted human work (including other features'
  entries), so committing only this slice's lines isn't possible. It goes in
  with the human's next commit of that file.

## Final checks (2026-10-07)

`npm run typecheck`, `npm test` (30 files, 290 tests) and `npm run build`
pass. No lint command is configured. Tests run outside the sandbox (the
OpenCode client tests bind a local port).

## PR description

**Project page replaces the global Board mode** (ADR 0018)

The board was a global List/Board mode, so sidebar clicks updated focus
behind it and showed nothing, opening a card left no way back, and there was
no shortcut. Now the board is a place:

- **Project page**: the content area for one project, with a Features |
  Sessions switch. The features board has one column per workflow stage with
  Xirp-style cards (card state, title, parent tag, linked-session dots, amber
  "Input required" when a linked session waits). The sessions board has
  Waiting | Working | Idle | Ended columns with time in status.
- **Three exclusive focuses** in UI state (session, feature, project;
  `view` removed). With nothing focused, the first project's page shows;
  removing the focused session lands on its project's page. Old state files
  load (`view` dropped, the old features tab reads as projects).
- **Sidebar**: Sessions | Projects. Projects rows show live and waiting
  counts and open the project page. The Features tree is gone.
- **Parent/child**: a card's parent tag opens the parent's page; a feature
  page links to its parent and lists its children. Generic group kinds only.
- **Breadcrumb up-links** (project › parent › feature; project › linked
  feature › session) instead of a back button.
- **⌘B** (View › Project Board) opens the context project's page and, on it,
  switches the board.

Slices: 1 project page, focus model, Projects tab, breadcrumbs, ⌘B;
2 sessions board and switch; 3 rich feature cards; 4 `CONTEXT.md`.

How to verify: `npm test`, `npm run typecheck`, `npm run build`; then
`npm run dev` and follow the manual checks under each slice in `05-plan.md`.

## Open questions
