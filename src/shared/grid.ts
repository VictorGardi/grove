import { GRID_MAX, type GridState } from './types'

// The grid with unknown and repeated members dropped and at most GRID_MAX kept; closed when none are left.
// Spans of sessions that left the grid go too; track sizes stay. Returns the same object when nothing changes.
export function pruneGrid(grid: GridState, known: (id: string) => boolean): GridState {
  const members = grid.members.filter((id, i) => known(id) && grid.members.indexOf(id) === i).slice(0, GRID_MAX)
  const open = grid.open && members.length > 0
  const spanIds = Object.keys(grid.spans ?? {})
  const spans = spanIds.some((id) => !members.includes(id))
    ? Object.fromEntries(Object.entries(grid.spans!).filter(([id]) => members.includes(id)))
    : grid.spans
  if (open === grid.open && members.length === grid.members.length && spans === grid.spans) return grid
  const { spans: _spans, ...rest } = grid
  return { ...rest, open, members, ...(spans && Object.keys(spans).length > 0 ? { spans } : {}) }
}
