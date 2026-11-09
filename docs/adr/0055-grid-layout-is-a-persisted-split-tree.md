# 0055. Grid layout is a persisted split tree, automatic until customised

Date: 2026-11-09

## Status

Accepted

## Context

The grove-next grid tiles its panes automatically: 1, 2 or 3 columns by pane
count, panes in tab order, the last pane stretching across its row
(`grid/layout.ts`). The human cannot change pane size or position. Membership
(`gridTabs`) and the on/off flag are saved in the window's view state.

The human wants to resize panes and move them around to get the arrangement they
want, such as one tall pane beside several stacked ones.

## Decision

- The custom **grid layout** is a **split tree**: leaves are tab ids, each split is
  `{dir: 'row' | 'col', ratio, a, b}`. It always tiles the whole area.
- It is saved in view state as `gridLayout`, next to `gridTabs`. `null` means
  **automatic**, today's behaviour, which keeps adapting to pane count. The first
  drag or resize converts the current automatic arrangement into an equivalent tree,
  so nothing visibly moves. **Reset layout** sets it back to `null`. One layout per
  window; no presets, no per-space layouts.
- Move: drag a pane header onto another pane. An edge docks it as a new split, the
  centre swaps the two. Keyboard: a modifier plus the direction keys swaps with the
  neighbour (Cmd+Option+Shift+Arrow), and another nudges the divider next to the focused pane by 5% of the area it divides (Cmd+Ctrl+Option+Arrow). Both are hard-coded beside the existing Cmd+Option+Arrow focus chord; only Reset layout is a configurable key action (`grid-reset-layout`). Neighbours are
  found by geometry, not by index.
- Resize: draggable dividers with a minimum pane size (about 20 columns by 5 rows).
  Double-click equalises a divider's sides. Terminals refit live, once per frame.
- A tab joining the grid splits the focused pane (the last if none is focused). A tab
  leaving collapses its slot into its sibling. On load, ids that are no longer members
  are pruned and members missing from the tree are split in the same way.
- Maximum stays nine panes. No pane zoom: ⌘⇧G already takes a tab out of the grid.
- No `schemaVersion` bump: loading merges defaults, as for the other view-state fields.

## Consequences

Any tiling is reachable, and a pane's position stays where the human put it. Pane
order no longer follows tab order once the layout is custom. `paneSpans` and `neighborPane` are gone and `gridShape` only feeds the
automatic tree; a tree
renderer, divider drag, drop-zone hit-testing and geometric navigation are needed.
Two paths (automatic and custom) must stay consistent, and the automatic-to-tree
conversion is the likeliest place for bugs. The layout lives in the window's
`localStorage`, so it does not sync between machines, as with `gridTabs`.

Rejected: resizable tracks on the CSS grid (cheapest, but a divider moves a whole
row or column and it cannot make "one tall pane beside stacked ones"); free-floating
x/y/w/h rectangles (gaps, overlap and window-size-dependent data, and terminals fit
poorly); always persisting a tree from the start (the first added tab would freeze
the layout for people who never customise); not persisting (the arrangement is lost
on every restart).
