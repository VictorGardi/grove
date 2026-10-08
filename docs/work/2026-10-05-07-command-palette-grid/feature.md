---
kind: feature
parent: 2026-10-05-opencode-feature-workspace
order: 9
flow: standard
created: 2026-10-05
---

# Command palette and grid view

Child 7 of epic `2026-10-05-opencode-feature-workspace`. Read the epic's
`02-research.md` and `03-design.md` first.

## Goal

Keyboard-first navigation, and several live terminals at once.

## Outcome

Cmd+K opens a command palette that fuzzy-matches features, sessions, projects and app commands. Picking one jumps to the feature or project, focuses the session, or runs the command. A grid view shows several live sessions side by side, each attached in its own xterm.js and resized independently. I can pick which sessions are in the grid (from any project), focus pane N with Cmd+1..9 while the grid shows, and the member list and order persist in UI state. Tiles reflow automatically. Only the focused pane clears a finished turn's waiting status.

## Scope

E-D3 (multiple concurrent attaches), E-D7 (grid layout in `ui`). Design: two-way rows Keys (Cmd+K, Cmd+1..9), Terminal and Per-viewer UI state; appetite cut 2.

## Dependencies

3 (session status shown in palette and grid). Child 5 (next actions) is on hold, so palette actions are out (2026-10-07).

## Size estimate

3–4 days, about 5 slices. Palette first, grid second, so the grid can be cut on its own.

## Flow log

- 2026-10-07: standard (proposed for an epic child, confirmed)
- 2026-10-07: reopened from the ADR 0020 hold by the human, as written; the human then dropped palette actions (the Cmd+K "next actions" entries, E-D2, and the dependency on child 5, which stays on hold). The rolling-wave warning (siblings 5 and 6 not at implementation) was overridden.
