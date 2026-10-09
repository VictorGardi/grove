---
feature: 2026-10-09-session-workflow-status
phase: design
status: draft
version: 3
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
5. The status marker is the card's top-left `icon` slot, on every session kind: agent cards (where the live-status circle was) and terminal cards (where the terminal glyph was). The Sessions Board card takes the same slot. The grid-membership action remains independent, and the kind glyph does not move. The collapsed sidebar rail does not show the marker: at 36px a tile already carries a kind glyph, a live dot and a grid square.
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
- No change to the context gauge or grid membership semantics.
- The card's live-status circle and terminal glyph are replaced by the status button, not kept alongside it. Live status keeps its own home on the bottom status line and the `agent-alert` badge; the collapsed rail tile keeps its own live dot at bottom-right.

## One-way decisions

- Store the workflow label as a required `Session` field and bump state schema with a migration that sets the default for existing sessions. This keeps status independent of volatile runtime signals and makes all seven labels durable.
- Use a typed IPC command to change status; the renderer does not mutate session state directly.
- The status button replaces the existing top-left `icon` slot rather than adding a control. Every session kind gets it, so the sidebar card loses its live-status circle and its terminal glyph, and the board card loses its kind glyph; live status is carried by the bottom status line and the `agent-alert` badge. Adding a separate marker beside the icon was rejected: it duplicates what the slot already does and widens every card.
- The collapsed rail is left alone. A marker there was tried and removed: the tile was carrying a fourth element and read as cluttered. The rail keeps its kind glyph, live dot and grid square.
