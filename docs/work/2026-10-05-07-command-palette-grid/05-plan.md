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
