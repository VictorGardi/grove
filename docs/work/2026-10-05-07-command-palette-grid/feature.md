---
kind: feature
parent: 2026-10-05-opencode-feature-workspace
order: 9
created: 2026-10-05
---

# Command palette and grid view

Child 7 of epic `2026-10-05-opencode-feature-workspace`. Read the epic's
`02-research.md` and `03-design.md` first.

## Goal

Keyboard-first navigation, and several live terminals at once.

## Outcome

Cmd+K opens a command palette that fuzzy-matches features, sessions and the current feature's next actions. Picking one jumps to the feature, focuses the session, or runs the action through child 5's start path. A grid view shows several live sessions side by side, each attached in its own xterm.js and resized independently. I can choose which sessions are in the grid, focus one with Cmd+1..9, and the layout persists in UI state.

## Scope

E-D2 (actions run from the palette), E-D3 (multiple concurrent attaches), E-D7 (grid layout in `ui`). Design: two-way rows Keys (Cmd+K, Cmd+1..9), Terminal and Per-viewer UI state; appetite cut 2.

## Dependencies

3 (session status shown in palette and grid), 5 (actions).

## Size estimate

3–4 days, about 5 slices. Palette first, grid second, so the grid can be cut on its own.

## On hold (2026-10-07)

Not built for now; new workflow features are on hold
([ADR 0020](../../adr/0020-sessions-and-review-before-workflow.md)). Don't
start this child without the human reopening it.
