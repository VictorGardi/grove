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
  - 05-plan.md@1
forced:
  - "size M / UI-state shape change in small flow: every decision, including the ui-state shape, was made by the human in grilling and recorded in ADR 0018 and 00-ticket.md; small flow chosen deliberately (2026-10-06)"
---

# Implementation: project page

## Progress

- [x] Slice 1 — Project page, three-way focus, Projects tab, breadcrumbs, ⌘B
- [ ] Slice 2 — Sessions board and the Features | Sessions switch
- [ ] Slice 3 — Rich feature cards
- [ ] Slice 4 — `CONTEXT.md`

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

## Open questions
