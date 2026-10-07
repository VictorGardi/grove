import { GRID_MAX, type GridState, type Project, type Session, type UiState } from '@shared/types'

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
    return { open: grid.open && members.length > 0, members }
  }
  if (grid.members.length >= GRID_MAX) return grid
  return { ...grid, members: [...grid.members, id] }
}

// The pane header's title: "project / label", or the label alone when the project is gone.
export function paneTitle(project: Project | undefined, session: Session): string {
  return project ? `${project.name} / ${session.label}` : session.label
}

// Toolbar settings: view-only, never persisted.
export interface GridView { filter: string | null; layout: GridLayout | null; hideEnded: boolean; dim: number } // dim: opacity of unfocused panes
export const DEFAULT_GRID_VIEW: GridView = { filter: null, layout: null, hideEnded: false, dim: 0.65 }
export const DIM_RANGE = { min: 0.3, max: 1 }

// The panes the grid lays out: the project filter (ignored when no member is in that project), then hide-ended,
// then as many as a chosen layout has cells.
export function visibleMembers(members: Session[], view: GridView): Session[] {
  const filter = view.filter !== null && members.some((m) => m.projectId === view.filter) ? view.filter : null
  const shown = members.filter((m) => (filter === null || m.projectId === filter) && !(view.hideEnded && m.lastStatus === 'gone'))
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
