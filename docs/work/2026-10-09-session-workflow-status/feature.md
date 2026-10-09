---
kind: feature
flow: standard
created: 2026-10-09
---

# Session workflow statuses

## Goal

Let a person manually mark each session with a persistent workflow status, including pinning it for later.

## Outcome

Session cards show an Xirp-style workflow status marker. Clicking it opens a picker for Backlog, In Progress, Blocked, In Review, Cancelled, Done, or Pinned. The status is independent of live agent status and does not trigger lifecycle actions.

## Scope

- Persist workflow status with session state; legacy sessions default to In Progress.
- Show and edit status in all session-card views.
- Preserve the existing grid-membership control.
- Match the provided Xirp status icon/color reference.

## Non-goals

- Status filters, grouping, sorting, cleanup behavior, or automatic status transitions.
- Xirp's separate `In Review (Draft)` option.
