---
feature: 2026-10-05-07-command-palette-grid
phase: structure
status: approved
version: 1
created: 2026-10-07
updated: 2026-10-07
approved_at: 2026-10-07
based_on:
  - 03-design.md@1
forced: []
---

# Structure: command palette and grid view

Six vertical slices. Slices 1–2 are the palette, 3–6 the grid, so the grid can be cut alone. Commands: `npm test`, `npm run typecheck`, `npm run dev`.

## Slices

### 1. Palette tracer: Cmd+K jumps to sessions, features, projects

- **Outcome:** Cmd+K opens a palette; typing fuzzy-filters sessions, features and projects; Up/Down moves, Enter jumps (focus session, open feature, open project's Sessions board), Esc closes.
- **Files:** NEW `fuzzy.ts`, `fuzzy.test.ts`, `paletteItems.ts`, `paletteItems.test.ts`, `components/CommandPalette.tsx` (+ css); MODIFIED `shared/ipc.ts` (`palette` action), `main/menu.ts` (Cmd+K sends it), `App.tsx` (`runAction` extracted, `paletteOpen`).
- **Signatures:** `fuzzy(query, text)`, `paletteItems(...)`, `rank(items, query)`.
- **Verification:** `npx vitest run src/renderer/src/fuzzy.test.ts src/renderer/src/paletteItems.test.ts`; `npm run typecheck`; manual: Cmd+K, type part of a session name, Enter focuses it; same for a feature and a project.
- **Depends on:** none.

### 2. Palette commands and terminal refocus

- **Outcome:** The palette also lists app commands (New session, New terminal, Close session, Show/Hide grid, Clear grid, Session diff, Project board); the TopBar search box opens it; after closing it, typing goes to the terminal again.
- **Files:** MODIFIED `paletteItems.ts` (`PALETTE_COMMANDS`), `TopBar.tsx`, `TerminalView.tsx` (`active` prop), `App.tsx`. Grid commands appear once slice 3 exists and are omitted until then.
- **Signatures:** `TerminalView({ sessionId, active, onFocus? })`.
- **Verification:** `npx vitest run src/renderer/src/paletteItems.test.ts` (commands listed and ranked); manual: "New terminal" from the palette creates one; Cmd+K, Esc, then typing reaches the terminal.
- **Depends on:** 1.

### 3. Two sessions side by side

- **Outcome:** Cmd+G, the sidebar bottom-bar button and the palette show a grid of the members; a plus on a sidebar card adds or removes a session (green check marks members); two live sessions take independent input and resize independently; members and on/off survive a restart.
- **Files:** MODIFIED `shared/types.ts` (`GridState`, `GRID_MAX`), `shared/ipc.ts` (`toggleGrid`), `main/menu.ts` (Cmd+G), `main/ipc.ts` (no kill-all; kill all on `webContents` destroy/reload), `core/core.ts` (prune members), `core/store/stateStore.ts` (sanitize), `navigation.ts` (`grid` kind), `stores/slices.ts`, `App.tsx`, `Sidebar.tsx`; NEW `gridView.ts` (+ test), `components/SessionGrid.tsx` (+ css).
- **Signatures:** `gridShown(ui)`, `gridCols(n, maxCols)`, `withMember(grid, id)`.
- **Verification:** `npx vitest run src/renderer/src/gridView.test.ts src/renderer/src/navigation.test.ts` plus the new stateStore and prune tests; `npm test`; manual: add two running sessions, Cmd+G, type in both, resize the window, restart the app and the grid is back.
- **Depends on:** 1 (the `runAction` path); 2 for the terminal `active` prop.

### 4. Focus, Cmd+1..9 and dimming

- **Outcome:** Clicking a pane focuses it; Cmd+1..9 focuses pane N in grid order; the focused pane has an accent border and the others are dimmed; only the focused pane clears a finished turn's waiting status.
- **Files:** MODIFIED `SessionGrid.tsx`, `TerminalView.tsx` (`onFocus`), `App.tsx` (`focusIndex` in grid), `styles/tokens.css` (`--pane-dim`).
- **Verification:** `npm test` (seen-mark tests in `sessions.test.ts` still pass); manual: a finished turn in an unfocused pane stays waiting until that pane is focused; Cmd+2 focuses pane 2; outside the grid Cmd+2 still focuses sidebar session 2.
- **Depends on:** 3.

### 5. Pane header, ended tiles and the cap

- **Outcome:** Each pane has a header (project / label, branch, feature tag and stage, status dot and label, Open alone, Remove); a killed member shows "Session ended" with Resume and Remove; the 10th plus is disabled.
- **Files:** MODIFIED `SessionGrid.tsx` (+ css), `Sidebar.tsx`, `gridView.ts`.
- **Verification:** `npx vitest run src/renderer/src/gridView.test.ts` (cap, toggle, empty closes grid); manual: kill a member and its tile shows ended, Resume brings it back; Open alone shows that session single.
- **Depends on:** 4.

### 6. Grid toolbar

- **Outcome:** A toolbar above the tiles: project filter tabs (ALL plus one per project with members, with counts), a `cols×rows` label, a slider for maximum columns, an eye toggle that hides ended members, and Empty grid.
- **Files:** NEW `components/GridToolbar.tsx` (+ css); MODIFIED `gridView.ts` (`GridView`, `visibleMembers`, `layoutLabel`), `SessionGrid.tsx`, `App.tsx` (Cmd+N uses visible members).
- **Verification:** `npx vitest run src/renderer/src/gridView.test.ts` (filter, hide ended, layout label, max columns); manual: pick a project tab and only its panes show, the slider changes the columns, Empty grid clears and closes the grid.
- **Depends on:** 5.

## Appetite check

Six slices against the epic's size for this child (3–4 days, about 5 slices). One slice over, because of the toolbar the human added. It fits `limits.maxSlices` (8). Slices 1–2 give a shippable palette; 3–6 can be cut as a block, or 6 alone.

## Deferred

- Palette actions (E-D2, child 5 on hold).
- Persisting toolbar settings, drag-to-reorder, resizable tiles.
- Auto-populating the grid from status.

## Open questions
