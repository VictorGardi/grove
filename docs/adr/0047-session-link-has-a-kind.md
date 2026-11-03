# 0047. A session's link has a kind

Date: 2026-11-03

## Status

Accepted

## Context

ADR 0042 related sessions through `Session.parentId`, "grouping only". Auto-run slice
sessions (grove-run) and ad-hoc group members are different things, but one bare id
could not tell them apart, and the sidebar needed the difference to lay itself out with
one fixed layout.

## Decision

- **D1: `Session.parentId` is replaced by a typed `link {id, kind}`**, where `kind` is
  `group` (an ad-hoc member) or `slice` (an auto-run slice session).
- **`grove new --relation slice`** sets the kind at creation; grove-run passes it with
  `--child`. Without it a child is `group`.
- **`promoted`** flag: a promoted child is shown as its own sidebar row and keeps its
  link.
- **Schema v11**, a lossless migration: every `parentId` becomes `link {id, kind: group}`.
  The old state is backed up as `state.v10.bak`. Older builds cannot read v11.
- The one-level rule and removal promoting children from ADR 0042 are unchanged.

## Consequences

- Downgrading means restoring `state.v10.bak`.
- An agent's own subagents are not sessions and have no link; they exist only in status
  folding.
- A worktree's parent checkout (`Project.worktreeOf`) stays separate from a session's
  link.
