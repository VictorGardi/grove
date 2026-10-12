# 0041. Sessions keep one custom order, and dropping into a status group sets the status

Date: 2026-10-12

## Status

Accepted

## Context

The Sessions tab could only sort by start or last-viewed time. The human wants to place
cards by hand, and Cmd+1..9 and the collapsed rail should follow what they see.

## Decision

- **`custom` is a sort**, and the default. `SessionSort` replaces `none` with `custom`
  (the old "Default" was created-asc under another name; a saved `none` loads as
  `custom`). Cards drag only while the sort is `custom`.
- **One global order**, `ui.sessionOrder: string[]`, shared by every grouping. A group
  shows its sessions in that order. A session missing from it sorts below every placed
  one, in creation order, so a list nobody has dragged reads as it did before.
- **A drop writes the whole order.** The card is cut out and put beside its neighbour in
  the target group, so every group still agrees with the one list.
- **Pruned on removal**, in `dropSessions`, not at render. Dead IDs never accumulate and
  a render never writes.
- **Status drop:** under Group by status, dropping into another status group sets the
  session's `workflowStatus` as well, and the card lands at the drop position. Dropping
  into an empty group changes only the status.
- **Refused:** under Group by project, a drop into another project, or between a repo and
  its worktree sub-group (ADR 0037), does nothing. A session's project is not changed by
  a drag.
- Only the grabbed card moves; the shift-click selection is ignored. The rail and
  Cmd+1..9 read the same order through `orderedSessions` but are not drag targets.
  There is no keyboard reorder yet.
- Native HTML5 drag and drop, with a line between cards as the drop indicator.

## Consequences

- The order outlives groupings: regrouping never loses a hand-placed order.
- A drop that crosses a group boundary can move other groups' relative order only
  through the shared list, which is intended.
- A status change by drag is an ordinary `session:workflowStatus` call.
