# 0031. Session grid state in `ui`, focus stays a session focus

Date: 2026-10-07

## Status

Accepted

## Context

The session grid needs a persisted member list and an on/off mode, and one
focused pane. ADR 0018 keeps three exclusive focuses; core marks the focused
session seen (ADR 0015).

## Decision

`UiState.grid = { open: boolean; members: string[] }` (at most 9). The focused
pane is `focusedSessionId`. The grid shows when `grid.open` and
`focusedSessionId` is a member; this is derived in the renderer's `content()`,
with no new exclusivity rule. Core only prunes removed sessions from `members`.
No `schemaVersion` bump: loading merges defaults.

## Consequences

The seen mark needs no change: only the focused pane clears waiting. The flag
stays on while the human views a non-member or a feature, so showing the grid
again restores the layout. Rejected: a fourth exclusive focus (changes core
exclusivity and the seen-mark rule); a separate persisted store (new file and
slice for no gain).
