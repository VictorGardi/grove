---
feature: 2026-10-09-session-workflow-status
phase: design
status: draft
version: 1
created: 2026-10-09
updated: 2026-10-09
approved_at:
based_on:
  - 01-questions.md@1
  - 02-research.md@1
forced: []
---

# Design: session workflow statuses

## Desired state

1. Every session has a persisted manual workflow status. New sessions and pre-feature sessions use `in-progress` by default.
2. Workflow status is separate from `lastStatus`, agent `status`, and `waitingFor`; live status continues to display as it does today.
3. Clicking the workflow marker opens a picker for Backlog, In Progress, Blocked, In Review, Cancelled, Done, or Pinned.
4. Choosing a value updates the session through the existing renderer → IPC → core path and survives restart.
5. The status marker appears in the sidebar cards, Sessions Board cards, and collapsed sidebar tiles. The existing grid-membership action remains independent.
6. Status selection has no side effects: it does not archive, clean up, sort, filter, or otherwise alter the session.

## Status presentation

Match the supplied Xirp picker image with a consistent circle/glyph per value:

| Status | Tone | Glyph |
|---|---|---|
| Backlog | muted gray | dashed ring |
| In Progress | yellow | partial ring |
| Blocked | orange | partial ring |
| In Review | green | review/clock glyph |
| Cancelled | muted gray | circled x |
| Done | blue | checked circle |
| Pinned | orange | pin |

Labels are present in the picker and accessible names/tooltips; the card marker itself remains compact.

## Non-goals

- No `In Review (Draft)` status.
- No status filters, sorting, grouping, cleanup rules, auto-transitions, or feature-card rollups.
- No change to the existing context gauge, agent status dot, or grid membership semantics.

## One-way decisions

- Store the workflow label as a required `Session` field and bump state schema with a migration that sets the default for existing sessions. This keeps status independent of volatile runtime signals and makes all seven labels durable.
- Use a typed IPC command to change status; the renderer does not mutate session state directly.
- Preserve the grid control and add a separate always-visible status marker in the card's top-left control cluster; grid membership can remain hover-only when not in the grid.
