Source: the epic's 04-structure.md (v6), child entry 7, verbatim. No separate ticket: the human started this child with `grove-start` on 2026-10-07, after lifting the ADR 0020 hold. Palette actions were then dropped (see feature.md).

### 7. `2026-10-05-07-command-palette-grid`

- **Goal:** keyboard-first navigation, and several live terminals at once.
- **Outcome:** Cmd+K opens a command palette that fuzzy-matches features,
  sessions and the current feature's next actions. Picking one jumps to the
  feature, focuses the session, or runs the action through child 5's start
  path. A grid view shows several live sessions side by side, each attached
  in its own xterm.js and resized independently. I can choose which sessions
  are in the grid, focus one with Cmd+1..9, and the layout persists in UI
  state.
- **Scope:** E-D2 (actions run from the palette), E-D3 (multiple concurrent
  attaches), E-D7 (grid layout in `ui`). Design: two-way rows Keys (Cmd+K,
  Cmd+1..9), Terminal and Per-viewer UI state; appetite cut 2.
- **Depends on:** 3 (session status shown in palette and grid), 5 (actions).
- **Size:** 3–4 days, about 5 slices. Palette first, grid second, so the grid
  can be cut on its own.
