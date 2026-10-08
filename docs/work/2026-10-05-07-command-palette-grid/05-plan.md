---
feature: 2026-10-05-07-command-palette-grid
phase: plan
status: approved
version: 1
created: 2026-10-07
updated: 2026-10-07
approved_at: 2026-10-07
based_on:
  - 03-design.md@1
  - 04-structure.md@1
forced: []
---

# Command palette and grid view — plan

Self-approved per slice by grove-implement: mechanical checks passed, not human-reviewed.

## Slice 1 — Palette tracer: Cmd+K jumps to sessions, features, projects

Notes for a cold reader: renderer code lives in `src/renderer/src`, shared types in `src/shared`. Tests are vitest (`npx vitest run <file>`). `Modal` (`components/ui/Modal.tsx`) already handles capture-phase Esc (`onClose`) and Enter (`onConfirm`). Styles are CSS modules using tokens from `styles/tokens.css`; no inline styles (`noInlineStyles.test.ts`). Fuzzy matcher is our own (design D4); the `menu:action` listener body becomes `runAction(a)` (design D3).

- [x] Write failing test `src/renderer/src/fuzzy.test.ts`: null on no subsequence; case-insensitive; `indices` are the matched positions; empty query matches with score 0 and no indices; prefix beats mid-word; word-boundary beats mid-word; consecutive run beats scattered
- [x] Create `src/renderer/src/fuzzy.ts`: `fuzzy(query, text): { score: number; indices: number[] } | null` (greedy subsequence scan with bonuses for prefix, word boundary (after space `/-_.:`), consecutive runs; small penalty for gaps)
- [x] Write failing test `src/renderer/src/paletteItems.test.ts`: `paletteItems` yields one item per session, feature (non-group or group alike), project, with kind/label/detail; empty-query `rank` order is sessions (waiting first, then list order), features, projects; a query filters and ranks by score, ties by kind order; `run()` of a session/feature/project item calls the matching action with the right argument
- [x] Create `src/renderer/src/paletteItems.ts`: `PaletteItem`, `PaletteActions { focusSession(id); focusFeature(ref); openProject(id) }`, `paletteItems(data: { projects; sessions; features }, actions)`, `rank(items, query)` (matches `label`, falling back to `detail` with indices `[]` and a score penalty)
- [x] `src/shared/ipc.ts`: add `| { type: 'palette' }` to `MenuAction`
- [x] `src/main/menu.ts`: Command Palette item `click: () => send({ type: 'palette' })`
- [x] Create `src/renderer/src/components/CommandPalette.tsx` + `CommandPalette.module.css`: `Modal` (width md, `onClose`, `onConfirm` runs highlighted row then closes), autofocused input, ArrowUp/ArrowDown in input `onKeyDown` move the highlight (wrap), click on a row runs it, matched characters wrapped in `<mark>`, kind tag and detail per row, "No matches" when empty; highlight resets to 0 when the query changes
- [x] `src/renderer/src/App.tsx`: extract the `menu:action` listener body into `runAction(a: MenuAction)` (a `useCallback`; reads latest state via `useSlices.getState()`), add `paletteOpen` state, `a.type === 'palette'` sets it true, render `<CommandPalette>` when open with items from `paletteItems` (actions `setFocused`, `focusFeature`, `openProject`)
- [x] Run `npx vitest run src/renderer/src/fuzzy.test.ts src/renderer/src/paletteItems.test.ts`
- [x] Run `npm run typecheck`
- [x] Run `npm test`

## Slice 2 — Palette commands and terminal refocus

Notes for a cold reader: slice 1 added `paletteItems.ts` (`PaletteActions`, `paletteItems`, `rank`) and `App.tsx`'s `runAction(a: MenuAction)`. Commands are a static list that run through `runAction` (design D3). `TerminalView` gets an `active` prop; when it becomes true the xterm takes keyboard focus (design "Terminal focus"). Grid commands (Show/Hide grid, Clear grid) are NOT added here; they arrive in slice 3.

- [x] `src/renderer/src/paletteItems.ts`: add `runAction(a: MenuAction)` to `PaletteActions`; export `PALETTE_COMMANDS` (New session, New terminal, Close session, Session diff, Project board, each with hint and `MenuAction`); `paletteItems` appends one `command` item per entry
- [x] `src/renderer/src/paletteItems.test.ts`: commands listed, last in empty-query order, run through `runAction`, rank by label ("new term" finds New terminal)
- [x] `src/renderer/src/components/TerminalView.tsx`: props `{ sessionId, active, onFocus? }`; keep the xterm in a ref; an effect on `[active, sessionId]` calls `term.focus()` when `active`; remove the unconditional focus on mount; `onFocus` on the terminal's container div
- [x] `src/renderer/src/App.tsx`: pass `runAction` to the palette actions; `TerminalView active={!paletteOpen && !newFor && !confirmKill}` (modals that autofocus must not lose focus to the terminal); TopBar gets `onSearch` that opens the palette
- [x] `src/renderer/src/components/shell/TopBar.tsx` (+ css): the search box becomes a `<button>` calling `onSearch`
- [x] Run `npx vitest run src/renderer/src/paletteItems.test.ts`
- [x] Run `npm run typecheck`
- [x] Run `npm test`

## Slice 3 — Two sessions side by side

Notes for a cold reader: design D1 puts the grid in `UiState.grid: { open, members }` (additive; `schemaVersion` stays 4; `GRID_MAX = 9`); the focused pane is the existing `focusedSessionId`. D2: `pty:attach` stops killing earlier attaches; the renderer owns each attach and detaches on unmount; main kills all attaches when the window's `webContents` reloads or is destroyed. `content()` returns `{ kind: 'grid', sessions, focused }` first when `grid.open`, members are non-empty and `focusedSessionId` is a member. Tiles are a CSS grid (`gridCols(n)` → 1, 2 or 3 columns, equal rows), panes keyed by session id, no inline styles. Ended members show a bare "Session ended" tile and are not attached (the full tile is slice 5). Pane focus by click and Cmd+1..9 are slice 4, so here only the focused pane is `active`. Palette gets Show/Hide grid and Clear grid. Helper not named in the structure: `src/shared/grid.ts` `pruneGrid` (shared by main-side `loadState`/core and tested once).

- [x] Write failing tests `src/renderer/src/gridView.test.ts`: `gridCols` (0/1 → 1; 2–4 → 2; 5–9 → 3; capped by `maxCols`), `gridShown` (needs open, non-empty members, focused session a member), `withMember` (adds, removes, appends in order, refuses a 10th, sets `open: false` when emptied, leaves `open` otherwise)
- [x] Write failing test `src/shared/grid.test.ts`: `pruneGrid` drops unknown ids, de-duplicates, caps at `GRID_MAX`, sets `open: false` when empty, returns the same object when nothing changes
- [x] `src/shared/types.ts`: `GridState`, `GRID_MAX = 9`, `UiState.grid`, `DEFAULT_UI.grid = { open: false, members: [] }`; update `stateStore.test.ts` round-trip literal with `grid`
- [x] Create `src/shared/grid.ts` `pruneGrid(grid, known: (id: string) => boolean): GridState`
- [x] `src/core/store/stateStore.ts`: `loadState` sanitizes `ui.grid` with `pruneGrid` against the loaded sessions (a missing `grid` takes the default); add a `stateStore.test.ts` case: unknown member ids dropped, `open` false when none left, old file without `grid` loads with default
- [x] `src/core/core.ts` `dropSessions`: prune `ui.grid` with `pruneGrid(grid, (id) => !!findSession(id))` alongside the other ui cleanup
- [x] Create `src/renderer/src/gridView.ts`: `gridShown(ui)`, `gridCols(n, maxCols = 3)`, `withMember(grid, id)`
- [x] `src/shared/ipc.ts`: `MenuAction` adds `{ type: 'toggleGrid' }` and `{ type: 'clearGrid' }`; `src/main/menu.ts`: View → "Session Grid" `CmdOrCtrl+G` sends `toggleGrid`
- [x] `src/main/ipc.ts`: `pty:attach` no longer kills others; `registerIpc` returns `{ killAttaches }`; `src/main/index.ts` calls it on `webContents` `did-start-loading` and on window `closed`
- [x] `src/renderer/src/navigation.ts`: `Content` gains `grid`; `content()` returns it first per the rule above (members that no longer exist are skipped); `currentProjectId`/`boardProject` use the focused session's project; `crumbs` → `[{ label: 'Session grid' }]`; extend `navigation.test.ts`
- [x] `src/renderer/src/stores/slices.ts`: `toggleGrid()` (shown → `open: false`; else if members: `open: true` and focus the current session when a member, else the first member; no members: nothing), `toggleGridMember(id)`, `clearGrid()` (members `[]`, open false)
- [x] Create `src/renderer/src/components/SessionGrid.tsx` + `SessionGrid.module.css`: `<div>` with class by `gridCols`, one pane per member keyed by session id, running members get `TerminalView` (`active` only for the focused one and with no overlay open), ended members show "Session ended"
- [x] `src/renderer/src/paletteItems.ts`: `PALETTE_COMMANDS` adds Show grid (`toggleGrid`, ⌘G, label becomes Hide grid when the grid shows) and Clear grid (`clearGrid`); session detail says "in grid" for members; `paletteItems` takes `grid`/`gridShown` in its data; extend `paletteItems.test.ts`
- [x] `src/renderer/src/App.tsx`: `runAction` handles `toggleGrid`/`clearGrid`; render `SessionGrid` when `shown.kind === 'grid'`
- [x] `src/renderer/src/components/ui/Icon.tsx`: add `check` and `grid` icons; `ListRow.tsx`: optional `leading` node before the icon
- [x] `src/renderer/src/components/Sidebar.tsx` (+ css): a plus at the card's top left toggles membership (green check when a member; disabled with a title hint at 9 for non-members); a bottom bar with a grid button (`aria-pressed` when shown, disabled with a hint when there are no members)
- [x] Run `npx vitest run src/renderer/src/gridView.test.ts src/renderer/src/navigation.test.ts src/shared/grid.test.ts src/core/store/stateStore.test.ts`
- [x] Run `npm test`
- [x] Run `npm run typecheck`

## Slice 4 — Focus, Cmd+1..9 and dimming

Notes for a cold reader: the focused pane is `ui.focusedSessionId` (design D1); `content()` already returns `{ kind: 'grid', sessions, focused }`, and `SessionGrid` gets `sessions` in grid order. Cmd+1..9 sends `{ type: 'focusIndex', n }` through `runAction`; while the grid shows, n counts grid panes, otherwise `sessionOrder(...)` as before. The seen mark already reads `focusedSessionId`, so only the focused pane clears a finished turn's waiting status with no core change (design "Seen mark"); the existing seen-mark tests in `sessions.test.ts` must keep passing. Dimming is `opacity: var(--pane-dim)` (0.65) on unfocused panes, hover does not undim; the focused pane has an accent border.

- [x] Write failing test `src/renderer/src/navigation.test.ts` for `focusTarget(ui, projects, sessions, features, n)`: with the grid shown it returns grid pane n (1-based; undefined past the end); without the grid it returns the nth session in sidebar order (`sessionOrder(sessionGroups(...))`)
- [x] `src/renderer/src/navigation.ts`: export `focusTarget`; `App.tsx` `focusIndex` uses it
- [x] `src/renderer/src/styles/tokens.css`: add `--pane-dim: 0.65` in the same block as the other tokens
- [x] `src/renderer/src/components/SessionGrid.tsx` (+ css): prop `onFocusPane(id)`; each pane gets `.focused` (accent border) or `.dim` (`opacity: var(--pane-dim)`, no hover change); `onMouseDownCapture` on the pane and `TerminalView onFocus` call `onFocusPane` when the pane is not the focused one
- [x] `src/renderer/src/App.tsx`: pass `onFocusPane={setFocused}`
- [x] Run `npm test`
- [x] Run `npm run typecheck`

## Slice 5 — Pane header, ended tiles and the cap

Notes for a cold reader: `SessionGrid.tsx` (slice 3–4) renders one pane per member, with the accent border (`focused`) or dimming (`dim`) and a bare "Session ended" tile. Design "Pane header": `project / label`, branch, linked-feature tag with stage, status dot and label (`statusView`), then Open alone (focus it, grid off) and Remove from grid. No progress, minimise, archive or context-window usage. Ended members stay in `members`; the tile shows "Session ended" with Resume (agents only, not terminals) and Remove from grid; no attach. Sidebar card hover buttons (18px, flush to the corners, `ListRow.module.css`) are not touched. The cap (the 10th plus disabled with a title hint, `withMember` refusing a 10th) already exists from slice 3 and is tested in `gridView.test.ts`; this slice only re-verifies it. The header reuses the sidebar's derivations: `linkedFeature` (`tree.ts`), `colorTags(projects, features.items).group(...)` (`tags.ts`), `featureStage` (`featureLabels.ts`), `statusView` (`sessionStatus.ts`), `Tag`, `StatusDot`, `Button`. `SessionGrid` reads `projects` and `features` from `useSlices()` itself, so `App.tsx` needs no new props except what is listed.

- [x] Write failing test `src/renderer/src/gridView.test.ts` for `paneTitle(project, session)`: `"<project> / <label>"`, and the label alone when the project is unknown
- [x] `src/renderer/src/gridView.ts`: export `paneTitle(project: Project | undefined, session: Session): string`
- [x] `src/renderer/src/stores/slices.ts`: add `openAlone(id)` to the interface and store: `ui:set { focusedSessionId: id, grid: { ...grid, open: false } }`
- [x] `src/renderer/src/components/SessionGrid.tsx`: each pane is a header plus body. Header: title via `paneTitle`; branch (`Icon branch` + name) when set; feature `Tag` + `featureStage` when linked; `StatusDot` + `statusView(s).label`; right side buttons (ghost, sm, round) Open alone (`Icon maximize`, calls `openAlone`) and Remove (`Icon x`, calls `toggleGridMember`). Body: running → `TerminalView`; else an ended tile with "Session ended", Resume (primary, `icon="resume"`, only when `kind !== 'terminal'`, invokes `session:resume`) and Remove (`icon="trash"`, calls `toggleGridMember`, so it leaves the grid but the session stays)
- [x] `src/renderer/src/components/SessionGrid.module.css`: `.header` (single row, `--sp-*` gaps, truncating title, `--text-2` secondary text), `.title`, `.branch`, `.spacer`, `.endedActions`; ended tile becomes a column with a gap; no inline styles
- [x] Run `npx vitest run src/renderer/src/gridView.test.ts`
- [x] Run `npm run typecheck`
- [x] Run `npm test`

## Slice 6 — Grid toolbar

Notes for a cold reader: design "Toolbar" and "System design": a toolbar above the tiles with project filter tabs (ALL n, then one tab per project that has members, with counts), a read-only `cols×rows` label of the visible panes, a slider for maximum columns (1 to 3), an eye toggle that hides ended members, and Empty grid (clears members, grid off: the existing `clearGrid` store action). All view-only and not persisted. `GridView = { filter: string | null; maxCols: 1 | 2 | 3; hideEnded: boolean }` is renderer-local; it lives in `App.tsx` state (not inside `SessionGrid`) because Cmd+N (`focusIndex`) must count the visible panes, and it then survives switching between single view and grid within a session. `visibleMembers(members, view)` applies the filter and hide-ended; a filter naming a project with no members is ignored (treated as ALL) so a stale tab never empties the grid. Selecting a filter or the eye that hides the focused pane focuses the first visible pane. Layout and `focusTarget` use the visible list. Existing: `SessionGrid.tsx` (header + tiles, slice 5), `gridCols(n, maxCols)`, `focusTarget(ui, projects, sessions, features, n)` in `navigation.ts`, `Icon.tsx` shapes, tokens in `styles/tokens.css`, CSS modules, no inline styles (`noInlineStyles.test.ts`).

- [x] Write failing tests `src/renderer/src/gridView.test.ts`: `visibleMembers` (filter by project, ignores a filter with no members, hide ended drops `lastStatus: 'gone'`, both combine, order kept); `layoutLabel` (`0` → `0×0`, 1 → `1×1`, 2 → `2×1`, 5 → `3×2`, 9 → `3×3`, 4 with maxCols 1 → `1×4`); `DEFAULT_GRID_VIEW`
- [x] Write failing test `src/renderer/src/navigation.test.ts`: `focusTarget` with a `view` argument counts only visible panes while the grid shows (hide-ended and project filter), and ignores it outside the grid
- [x] `src/renderer/src/gridView.ts`: `GridView`, `DEFAULT_GRID_VIEW = { filter: null, maxCols: 3, hideEnded: false }`, `visibleMembers`, `layoutLabel`
- [x] `src/renderer/src/navigation.ts`: `focusTarget(ui, projects, sessions, features, n, view = DEFAULT_GRID_VIEW)` uses `visibleMembers(c.sessions, view)[n - 1]` in the grid
- [x] `src/renderer/src/components/ui/Icon.tsx`: add `eye` and `eye-off` (Lucide shapes)
- [x] Create `src/renderer/src/components/GridToolbar.tsx` + `GridToolbar.module.css`: props `{ members: Session[]; projects: Project[]; view: GridView; visibleCount: number; onChange(view); onEmpty() }`; tabs (buttons, `aria-pressed`, `ALL n` and `<project name> n` for projects with members), layout label (`layoutLabel(visibleCount, view.maxCols)`), `<input type="range" min=1 max=3>` with aria-label "Maximum columns", eye `Button` (`aria-pressed` when ended members are hidden, title "Hide ended sessions" / "Show ended sessions"), `Empty grid` button
- [x] `src/renderer/src/components/SessionGrid.tsx` (+ css): props `view`, `onViewChange`; wrapper column with `GridToolbar` above the tiles; tiles use `visibleMembers(sessions, view)` and `gridCols(n, view.maxCols)`; with no visible panes show "No sessions match" in place of the tiles; the toolbar's Empty grid calls `clearGrid`
- [x] `src/renderer/src/App.tsx`: `gridView` state (`DEFAULT_GRID_VIEW`); `changeGridView(next)` sets it and, when the grid shows and the focused pane is not in `visibleMembers(shown.sessions, next)`, focuses the first visible one; `focusIndex` passes `gridView` to `focusTarget`; pass `view`/`onViewChange` to `SessionGrid`
- [x] Run `npx vitest run src/renderer/src/gridView.test.ts`
- [x] Run `npm test`
- [x] Run `npm run typecheck`
- [x] Run `npm run build`
