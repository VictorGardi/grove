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
