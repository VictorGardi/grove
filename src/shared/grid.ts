import { GRID_MAX, type GridState } from './types'

// The grid with unknown and repeated members dropped and at most GRID_MAX kept; closed when none are left.
// Returns the same object when nothing changes.
export function pruneGrid(grid: GridState, known: (id: string) => boolean): GridState {
  const members = grid.members.filter((id, i) => known(id) && grid.members.indexOf(id) === i).slice(0, GRID_MAX)
  const open = grid.open && members.length > 0
  if (open === grid.open && members.length === grid.members.length) return grid
  return { open, members }
}
