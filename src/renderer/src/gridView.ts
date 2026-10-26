import { GRID_MAX, type GridState, type GridTracks, type PaneSpan, type Project, type Session, type UiState } from '@shared/types'

// The grid takes over the content area: it is on, has members, and the focused session is one of them.
export function gridShown(ui: Pick<UiState, 'grid' | 'focusedSessionId'>): boolean {
  const { open, members } = ui.grid
  return open && members.length > 0 && ui.focusedSessionId !== null && members.includes(ui.focusedSessionId)
}

// Columns for n panes when the layout is automatic: 1; 2-4 -> 2; 5-9 -> 3.
export function gridCols(n: number): number {
  return n <= 1 ? 1 : n <= 4 ? 2 : 3
}

export interface GridLayout { cols: number; rows: number }
export const LAYOUT_MAX = 4 // the picker offers up to 4×4

// The shape of n panes: the chosen layout, else automatic columns with as many rows as needed.
export function gridShape(n: number, layout: GridLayout | null): GridLayout {
  if (layout) return layout
  const cols = gridCols(n)
  return { cols, rows: Math.max(1, Math.ceil(n / cols)) }
}

// Toggles a session in the grid. A new member goes last and the tenth is refused; the grid closes when emptied.
export function withMember(grid: GridState, id: string): GridState {
  if (grid.members.includes(id)) {
    const members = grid.members.filter((m) => m !== id)
    const { [id]: _span, ...spans } = grid.spans ?? {}
    return { ...grid, open: grid.open && members.length > 0, members, spans: Object.keys(spans).length > 0 ? spans : undefined }
  }
  if (grid.members.length >= GRID_MAX) return grid
  return { ...grid, members: [...grid.members, id] }
}

// The pane header's title: "project / label", or the label alone when the project is gone.
export function paneTitle(project: Project | undefined, session: Session): string {
  return project ? `${project.name} / ${session.label}` : session.label
}

// Toolbar settings: view-only, never persisted.
export interface GridView { layout: GridLayout | null; hideEnded: boolean; dim: number } // dim: opacity of unfocused panes
export const DEFAULT_GRID_VIEW: GridView = { layout: null, hideEnded: false, dim: 0.65 }
export const DIM_RANGE = { min: 0.3, max: 1 }

// The panes the grid lays out: hide-ended, then as many as a chosen layout has cells.
export function visibleMembers(members: Session[], view: GridView): Session[] {
  const shown = members.filter((m) => !(view.hideEnded && m.lastStatus === 'gone'))
  return view.layout ? shown.slice(0, view.layout.cols * view.layout.rows) : shown
}

// "cols×rows" of n panes, e.g. "2×1".
export function layoutLabel(n: number, layout: GridLayout | null): string {
  if (n === 0 && !layout) return '0×0'
  const { cols, rows } = gridShape(n, layout)
  return `${cols}×${rows}`
}

// Who takes focus when `id` leaves the grid: the member after it, else the one before; null when it was the last.
export function focusAfterRemove(members: string[], id: string): string | null {
  const i = members.indexOf(id)
  if (i < 0) return null
  return members[i + 1] ?? members[i - 1] ?? null
}

// --- spans, track sizes and reordering ---

export const MIN_TRACK_FRACTION = 0.15 // a track never shrinks below this share of the grid...
export const PANE_MIN_PX = { col: 220, row: 96 } // ...nor below what a pane's header and a few terminal rows need

// Key of a layout shape in GridState.tracks, e.g. "2x2".
export function shapeKey(shape: GridLayout): string {
  return `${shape.cols}x${shape.rows}`
}

export interface Span { cols: number; rows: number }
export interface Placement extends Span { col: number; row: number } // 0-based top-left cell

// The spans of the panes in order. With no manual span anywhere the last pane stretches across the
// rest of its row (3 panes in 2x2: two above, one wide below); any manual span turns that off for the
// whole grid. A manual span the shape cannot hold is ignored, not forgotten: wide needs two columns, tall two rows.
export function paneSpans(ids: string[], spans: Record<string, PaneSpan> | undefined, shape: GridLayout): Span[] {
  const manual = ids.some((id) => spans?.[id] !== undefined)
  if (!manual) {
    return ids.map((_, i) => ({ cols: i === ids.length - 1 ? shape.cols - (i % shape.cols) : 1, rows: 1 }))
  }
  return ids.map((id) => {
    const span = spans?.[id]
    return { cols: span === 'wide' && shape.cols >= 2 ? 2 : 1, rows: span === 'tall' && shape.rows >= 2 ? 2 : 1 }
  })
}

// Where CSS grid auto-placement (row flow, sparse) puts panes of these spans, so dividers can follow it.
// A pane that would hang below the last row is cut to the rows left, and placement is redone with the
// cut spans so that CSS, given the same spans, lands every pane in the same cell.
export function placePanes(spans: Span[], shape: GridLayout): Placement[] {
  let current = spans
  for (;;) {
    const taken = new Set<number>()
    const cell = (r: number, c: number) => r * shape.cols + c
    let r = 0
    let c = 0
    let cut = false
    const placed: Placement[] = []
    const next = current.map((sp) => {
      const cols = Math.min(sp.cols, shape.cols)
      for (;;) {
        if (c + cols > shape.cols) { r++; c = 0; continue }
        const rows = r < shape.rows ? Math.min(sp.rows, shape.rows - r) : 1
        let free = true
        for (let dr = 0; dr < rows && free; dr++) for (let dc = 0; dc < cols; dc++) if (taken.has(cell(r + dr, c + dc))) { free = false; break }
        if (!free) { c++; continue }
        // a free spot for the cut span can be earlier than the one the full span found, so look again
        if (rows < sp.rows) cut = true
        for (let dr = 0; dr < rows; dr++) for (let dc = 0; dc < cols; dc++) taken.add(cell(r + dr, c + dc))
        placed.push({ col: c, row: r, cols, rows })
        return { cols, rows }
      }
    })
    if (!cut) return placed
    current = next
  }
}

// A draggable line between two tracks, where the panes on either side really are separate.
export interface Divider { axis: 'col' | 'row'; index: number; from: number; to: number } // index: the line before track `index` (1..n-1); from..to (exclusive): the tracks it runs along on the other axis

export function dividers(places: Placement[], shape: GridLayout): Divider[] {
  const owner: number[] = Array(shape.cols * shape.rows).fill(-1)
  places.forEach((p, i) => {
    for (let r = p.row; r < Math.min(p.row + p.rows, shape.rows); r++) for (let c = p.col; c < Math.min(p.col + p.cols, shape.cols); c++) owner[r * shape.cols + c] = i
  })
  const out: Divider[] = []
  // the line is there while the two cells either side are not one pane, and at least one holds a pane
  const run = (axis: 'col' | 'row', lines: number, along: number, at: (line: number, t: number) => [number, number]) => {
    for (let index = 1; index < lines; index++) {
      let from = -1
      for (let t = 0; t <= along; t++) {
        const [a, b] = t < along ? at(index, t) : [-1, -1]
        const open = t < along && !(a >= 0 && a === b) && (a >= 0 || b >= 0)
        if (open && from < 0) from = t
        if (!open && from >= 0) { out.push({ axis, index, from, to: t }); from = -1 }
      }
    }
  }
  run('col', shape.cols, shape.rows, (k, r) => [owner[r * shape.cols + k - 1], owner[r * shape.cols + k]])
  run('row', shape.rows, shape.cols, (k, c) => [owner[(k - 1) * shape.cols + c], owner[k * shape.cols + c]])
  return out
}

export function equalTracks(n: number): number[] {
  return Array(n).fill(1 / n)
}

// The stored fractions of an axis, or equal ones when none are stored or they do not fit n tracks.
export function trackFractions(stored: number[] | undefined, n: number): number[] {
  const ok = stored && stored.length === n && stored.every((f) => Number.isFinite(f) && f > 0) && Math.abs(stored.reduce((a, b) => a + b, 0) - 1) < 1e-6
  return ok ? stored : equalTracks(n)
}

// The smallest share one of n tracks may take of a grid `totalPx` long.
export function minTrackFraction(totalPx: number, paneMinPx: number, n: number): number {
  return Math.min(Math.max(MIN_TRACK_FRACTION, totalPx > 0 ? paneMinPx / totalPx : 0), 1 / n)
}

// Moves the line before track `index` by `delta` (a fraction of the grid); the two tracks beside it trade size.
export function resizeTracks(tracks: number[], index: number, delta: number, min: number): number[] {
  const a = tracks[index - 1]
  const b = tracks[index]
  if (a === undefined || b === undefined) return tracks
  const moved = Math.max(min - a, Math.min(b - min, delta))
  if (min - a > b - min) return tracks // the pair is too small to hold two minimums
  const next = [...tracks]
  next[index - 1] = a + moved
  next[index] = b - moved
  return next
}

// The grid with one axis of a shape's tracks set; null puts it back to equal. Equal axes are not stored.
export function withTracks(grid: GridState, shape: GridLayout, axis: 'cols' | 'rows', fractions: number[] | null): GridState {
  const key = shapeKey(shape)
  const { [axis]: _old, ...rest } = grid.tracks?.[key] ?? {}
  const entry: GridTracks = fractions ? { ...rest, [axis]: fractions } : rest
  const { [key]: _entry, ...others } = grid.tracks ?? {}
  const tracks = Object.keys(entry).length > 0 ? { ...others, [key]: entry } : others
  const { tracks: _tracks, ...without } = grid
  return Object.keys(tracks).length > 0 ? { ...without, tracks } : without
}

export const SPAN_CYCLE: PaneSpan[] = ['1x1', 'wide', 'tall']

// What the pane's span button sets next, starting from the span it has now.
export function nextSpan(current: PaneSpan): PaneSpan {
  return SPAN_CYCLE[(SPAN_CYCLE.indexOf(current) + 1) % SPAN_CYCLE.length]
}

// The span a placed pane has, as the button shows it.
export function placedSpan(p: Span): PaneSpan {
  return p.cols > 1 ? 'wide' : p.rows > 1 ? 'tall' : '1x1'
}

export function withSpan(grid: GridState, id: string, span: PaneSpan): GridState {
  return { ...grid, spans: { ...grid.spans, [id]: span } }
}

// The members with `a` and `b` trading places; the rest stay put. Spans are keyed by session, so they travel along.
export function swapMembers(grid: GridState, a: string, b: string): GridState {
  const i = grid.members.indexOf(a)
  const j = grid.members.indexOf(b)
  if (i < 0 || j < 0 || i === j) return grid
  const members = [...grid.members]
  members[i] = b
  members[j] = a
  return { ...grid, members }
}

// Whether any pane has a manual span or any shape has stored track sizes.
export function hasArrangement(grid: GridState): boolean {
  return Object.keys(grid.spans ?? {}).length > 0 || Object.keys(grid.tracks ?? {}).length > 0
}

// The grid with every manual span and track size forgotten: equal tracks, and auto-fill back on. Order stays.
export function withoutArrangement(grid: GridState): GridState {
  const { spans: _spans, tracks: _tracks, ...rest } = grid
  return rest
}
