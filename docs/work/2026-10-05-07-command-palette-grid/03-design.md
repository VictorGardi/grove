---
feature: 2026-10-05-07-command-palette-grid
phase: design
status: approved
version: 1
created: 2026-10-07
updated: 2026-10-07
approved_at: 2026-10-07
based_on:
  - 01-questions.md@1
  - 02-research.md@1
  - parent:02-research.md@5
  - parent:03-design.md@6
forced: []
---

# Design: command palette and grid view

## Inherited decisions

Read-only, from the epic's `03-design.md` (v6):

- **E-D3** Session backend: tmux on socket `-L grove`, node-pty attach.
- **E-D7** App state: versioned JSON, atomic writes, core in main is the single writer.
- Two-way rows: Keys (custom app menu; Cmd+K, Cmd+1..9 reserved), Terminal (xterm.js + WebGL + fit, resize debounced 100 ms), Per-viewer UI state.

## Desired state

- **Cmd+K** opens a palette over the content area. Typing fuzzy-filters features, sessions, projects and app commands (new session, new terminal, toggle diff/viewer, show grid). Up/Down moves, Enter picks, Esc closes. Picking jumps to the feature page or the project's Sessions board, focuses the session, or runs the command. Palette actions (next actions, E-D2) are not included.
- **Grid mode** shows the grid's member sessions as auto-tiled live terminals. Each tile has its own xterm, attach and resize. Tiles reflow as the member count changes. Members are picked by hand, from any project, capped at 9 so each has a Cmd+N.
- **Focus in the grid:** exactly one pane is focused (`focusedSessionId`). Click or Cmd+1..9 changes it; Cmd+1..9 means grid order while the grid shows. The other panes are slightly dimmed so the focused one is clear. Only the focused pane clears a finished turn's waiting status.
- **Toolbar** above the tiles: project filter tabs (ALL plus one per project with members, with counts), a read-only layout label (`2×1`), an eye toggle, a size slider, and Empty grid. Toolbar settings are view-only.
- **Persistence:** member list, order and whether the grid is on persist in `ui` state. Split sizes and toolbar settings are not stored.
- **Tests:** palette matching and grid logic are pure `.ts` modules with vitest tests.
- **Order:** palette first, grid second, so the grid can be cut alone.

## Non-goals

- Palette actions / next actions (E-D2, child 5 on hold).
- Search of artifact contents.
- Resizable splits, drag-to-reorder tiles, persisted tile sizes.
- Auto-populating the grid from status; persisting toolbar settings.
- Changing tmux sizing config.

## System design

- `UiState.grid: { open: boolean; members: string[] }`, default `{ open: false, members: [] }`, `members.length <= 9`. Additive: `loadState` merges defaults, so `schemaVersion` stays 4; it also drops member ids of unknown sessions.
- `content()` gains `{ kind: 'grid'; sessions: Session[]; focused: Session }`, returned first when `grid.open`, `members` is non-empty and `focusedSessionId` is in `members`; otherwise the existing session, feature, project precedence. Members that no longer exist are skipped.
- Core prunes removed session ids from `grid.members` where it already cleans `ui` on removal (`core.ts:519-532`), and sets `open: false` when none are left. The seen mark (`onScreenId`) is unchanged: it reads `focusedSessionId`.
- Attach: `pty:attach` adds an entry and kills nothing. Each terminal detaches on unmount. Main kills all attaches when the window's `webContents` is destroyed or reloads. One attach per session at a time; tmux sizing is unchanged (one client per session, so `window-size latest` applies to it alone).
- Palette state (`paletteOpen`) is renderer-local, not persisted. Menu `Cmd+K` sends `{type:'palette'}`; `Cmd+G` sends `{type:'toggleGrid'}`.
- Toolbar state (`filter: projectId | null`, `maxCols: 1|2|3`, `hideEnded: boolean`) is renderer-local in `SessionGrid`, not persisted. `visibleMembers` applies the filter and `hideEnded`; layout and Cmd+N use the visible list. Selecting a filter that hides the focused pane focuses the first visible one.
- `focusIndex n`: if the grid shows, `visibleMembers[n-1]` is focused; otherwise `sessionOrder(...)[n-1]` as today.
- Matching: `fuzzy(query, text)` returns `{score, indices} | null`: case-insensitive subsequence, bonuses for prefix, word boundary and consecutive runs. The palette ranks by score, ties by kind order (sessions, features, projects, commands). An empty query lists everything in that order, waiting sessions first.

## Program design

Call path, palette: `Cmd+K` menu click -> `send({type:'palette'})` -> `menu:action` -> `runAction` -> `setPaletteOpen(true)` -> `CommandPalette` builds `paletteItems(...)`, ranks with `fuzzy`, Enter -> `item.run()` (store action such as `setFocused`, `focusFeature`, `openProject`, or `runAction(item.action)`).

Call path, grid: card plus -> `toggleGridMember(id)` -> `ui:set {grid}` -> core `uiSet` -> `state:ui` push -> `content()` -> `SessionGrid` mounts one `TerminalView` per member, each running its own `pty:attach`.

File tree:

```
src/shared/types.ts                 MODIFIED  GridState, UiState.grid, DEFAULT_UI.grid, GRID_MAX = 9
src/shared/ipc.ts                   MODIFIED  MenuAction + {type:'palette'} | {type:'toggleGrid'}
src/main/menu.ts                    MODIFIED  Cmd+K sends palette; Session Grid item, Cmd+G
src/main/ipc.ts                     MODIFIED  no kill-all on attach; kill all on webContents destroyed/reload
src/core/core.ts                    MODIFIED  prune grid.members when sessions are removed
src/core/store/stateStore.ts        MODIFIED  loadState: sanitize grid members
src/renderer/src/fuzzy.ts           NEW       fuzzy(query, text)
src/renderer/src/fuzzy.test.ts      NEW
src/renderer/src/paletteItems.ts    NEW       paletteItems(...), rank(items, query), PALETTE_COMMANDS
src/renderer/src/paletteItems.test.ts NEW
src/renderer/src/gridView.ts        NEW       gridCols, gridShown, withMember, focusedPaneIndex
src/renderer/src/gridView.test.ts   NEW
src/renderer/src/navigation.ts      MODIFIED  Content `grid` kind, content(), crumbs, currentProjectId
src/renderer/src/navigation.test.ts MODIFIED
src/renderer/src/stores/slices.ts   MODIFIED  toggleGrid, toggleGridMember, clearGrid
src/renderer/src/App.tsx            MODIFIED  runAction extracted; paletteOpen; renders SessionGrid
src/renderer/src/components/CommandPalette.tsx (+ .module.css)  NEW  Modal + input + result list
src/renderer/src/components/SessionGrid.tsx (+ .module.css)     NEW  tiles, GridPane header
src/renderer/src/components/GridToolbar.tsx (+ .module.css)     NEW  filter tabs, layout label, eye, slider, Empty grid
src/renderer/src/components/TerminalView.tsx  MODIFIED  props active, onFocus
src/renderer/src/components/Sidebar.tsx (+ .module.css)         MODIFIED  card plus/check, bottom bar grid toggle
src/renderer/src/components/shell/TopBar.tsx                    MODIFIED  search box opens the palette
docs/adr/0030-..., 0031-...         NEW       Proposed
CONTEXT.md                          MODIFIED  Session grid, Command palette
```

Key types and signatures:

```ts
// shared/types.ts
export interface GridState { open: boolean; members: string[] }
export const GRID_MAX = 9
// fuzzy.ts
export function fuzzy(query: string, text: string): { score: number; indices: number[] } | null
// paletteItems.ts
export interface PaletteItem { id: string; kind: 'session' | 'feature' | 'project' | 'command'; label: string; detail: string; hint?: string; waiting?: boolean; run: () => void }
export function rank(items: PaletteItem[], query: string): { item: PaletteItem; indices: number[] }[]
// gridView.ts
export function gridShown(ui: UiState): boolean
export function gridCols(n: number, maxCols = 3): 1 | 2 | 3  // 1; 2-4 -> 2; 5-9 -> 3, capped by maxCols
export interface GridView { filter: string | null; maxCols: 1 | 2 | 3; hideEnded: boolean }
export function visibleMembers(members: Session[], v: GridView): Session[]
export function layoutLabel(n: number, maxCols: number): string   // e.g. '2×1'
export function withMember(grid: GridState, id: string): GridState  // toggles, respects GRID_MAX, open:false when empty
// TerminalView props: { sessionId: string; active: boolean; onFocus?: () => void }
```

## One-way decisions

- **D1 Grid state shape (chosen: A).** `ui.grid {open, members}`; the focused pane is `focusedSessionId`, no new exclusivity rule, seen mark unchanged. Rejected: B, a fourth exclusive focus (changes core exclusivity and the seen-mark rule); C, a separate persisted store (new file and slice for no gain). [ADR 0031](../../adr/0031-grid-state-in-ui.md)
- **D2 Multi-attach contract (chosen: A).** `pty:attach` no longer kills earlier attaches; renderer-owned `attachId`s, detach on unmount, kill all on `webContents` destroy/reload. Rejected: B, main-owned registry keyed by `sessionId` (extra index, forbids two views of one session); C, one shared PTY fanned out to many xterms (sizing conflicts, ref-counting, not needed). [ADR 0030](../../adr/0030-multiple-concurrent-attaches.md)
- **D3 Palette command source (chosen: A).** The `menu:action` listener body becomes `runAction(a: MenuAction)`; menu and palette both call it; palette commands are a static list of `{id, label, hint, action}`. Rejected: B, shared command registry in `src/shared` that also builds the menu (menu refactor, not needed while palette actions are on hold); C, palette-local closures (duplicates menu logic).
- **D4 Fuzzy matcher (chosen: A).** Own subsequence scorer in `fuzzy.ts`, tested. Rejected: B, a library such as fuse.js (new dependency for a few dozen short labels; swappable later behind `fuzzy()`).

## Two-way decisions

Reference from the human (xirp's grid, screenshot 2026-10-07): pane header, accent border on the focused pane, sidebar card plus and green check, bottom-bar grid toggle, Cmd+G.

| Area | Decision | Basis |
|---|---|---|
| Opening the grid | `Cmd+G`, a grid button in a new sidebar bottom bar, and a palette command all send `toggleGrid`. Opening focuses the current session if a member, else the first member. With no members it does nothing and the button is disabled with a hint | human reference, D3 |
| Membership | Plus at the top left of a sidebar card toggles membership; a green check shows members. Disabled at 9 with a title hint. The only grid palette commands are Show/Hide grid and Clear grid | human reference |
| Pane header | `project / label`, branch, linked-feature tag with stage, status dot and label (`statusView`), then Open alone (focus it, grid off) and Remove from grid. No progress, minimise or archive | screenshot, Q6 helpers |
| Focus look | Focused pane: accent border. Others dimmed with `opacity: var(--pane-dim)` (0.65) on the pane, new token; hover does not undim. Click or terminal focus inside a pane focuses it | human, ADR 0012 |
| Toolbar | Tabs: ALL n, then a tab per project that has members; picking one filters the visible panes. Layout label: `cols×rows` of the visible panes. Slider: maximum columns, 1 to 3 (right is auto up to 3). Eye: hide ended members (my reading of the reference; change if it meant something else). Empty grid: clears members and turns the grid off. All view-only, not persisted | human, `gridView.ts` |
| Tile layout | CSS grid with `gridCols(n)` classes (1, 2, 3 columns), equal rows, panes keyed by session id so reflow never remounts or re-attaches. No inline styles | `noInlineStyles.test.ts` |
| Ended members | Stay in `members`; the tile shows "Session ended" with Resume (agents) and Remove from grid; no attach | Q9 |
| Terminal lifetime | No pool: a `TerminalView` mounts and attaches per shown pane; switching single and grid re-attaches and tmux repaints | Q3 |
| Terminal focus | `active = focused && !paletteOpen`; the effect calls `term.focus()` when it becomes true, so closing the palette returns the cursor to the pane | Q3, Q7 |
| Palette UI | `Modal` (reuses capture-phase Esc/Enter; Enter is `onConfirm` for the highlighted row), autofocused input, arrow keys in the input's `onKeyDown`, highlighted matches. TopBar search box opens it | Q7 |
| Palette entries | Sessions (label, project, kind, status, grid mark), features (title, stage, project), projects, commands: New session, New terminal, Close session, Show/Hide grid, Clear grid, Session diff, Project board | D3 |
| Picking | Session `setFocused`; feature `focusFeature`; project `openProject` (lands on the Sessions board, ADR 0020); command `runAction` | Q4 |
| Grid placement | Content area with crumb "Session grid"; the viewer panel can sit beside it as for other content | Q5 |
| Seen mark and notifications | No core change. Notifications still fire for visible but unfocused panes | Q8 |

## Risks

- **WebGL contexts:** up to 9 live xterms, each with a WebGL addon; Chromium caps contexts per page (about 16). A context loss falls back as today, per pane. Mitigated by the cap of 9.
- **Attach leaks:** without kill-all, a missed `pty:detach` leaves a client attached. Mitigated by cleanup on `webContents` destroy/reload; renderer reload with an active attach is an unverified unknown in research.
- **Mount overlap:** switching single to grid briefly has the old and new attach of one session alive; tmux allows several clients, sizing `latest`. Not verified under the shipped config.
- **Key routing:** Cmd+K, Cmd+G and Cmd+1..9 rely on native menu accelerators, which win over the page. Behaviour inside a focused xterm is not tested here; slice verification checks it by hand.
- **CPU and layout:** nine live terminals plus the viewer panel in a 320 px minimum content width gives tiny tiles; accepted, the human chooses members.
- **Dimming and accessibility:** `--pane-dim` 0.65 must keep text legible; checked by eye in both themes.

## Open questions
