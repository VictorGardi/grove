import { GRID_MAX, type GridState, type Project, type Session, type UiState } from '@shared/types'

// The grid takes over the content area: it is on, has members, and the focused session is one of them.
export function gridShown(ui: Pick<UiState, 'grid' | 'focusedSessionId'>): boolean {
  const { open, members } = ui.grid
  return open && members.length > 0 && ui.focusedSessionId !== null && members.includes(ui.focusedSessionId)
}

// Columns for n panes: 1; 2-4 -> 2; 5-9 -> 3; never more than maxCols.
export function gridCols(n: number, maxCols = 3): 1 | 2 | 3 {
  const auto = n <= 1 ? 1 : n <= 4 ? 2 : 3
  return Math.min(auto, maxCols) as 1 | 2 | 3
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
export interface GridView { filter: string | null; maxCols: 1 | 2 | 3; hideEnded: boolean }
export const DEFAULT_GRID_VIEW: GridView = { filter: null, maxCols: 3, hideEnded: false }

// The panes the grid lays out: the project filter (ignored when no member is in that project), then hide-ended.
export function visibleMembers(members: Session[], view: GridView): Session[] {
  const filter = view.filter !== null && members.some((m) => m.projectId === view.filter) ? view.filter : null
  return members.filter((m) => (filter === null || m.projectId === filter) && !(view.hideEnded && m.lastStatus === 'gone'))
}

// "cols×rows" of n panes, e.g. "2×1".
export function layoutLabel(n: number, maxCols: number): string {
  if (n === 0) return '0×0'
  const cols = gridCols(n, maxCols)
  return `${cols}×${Math.ceil(n / cols)}`
}
