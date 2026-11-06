export const GRID_MAX = 9

// Columns for n panes when the layout is automatic: 1; 2-4 -> 2; 5-9 -> 3.
export function gridCols(n: number): number {
  return n <= 1 ? 1 : n <= 4 ? 2 : 3
}

// The shape of n panes: automatic columns with as many rows as needed.
export function gridShape(n: number): { cols: number; rows: number } {
  const cols = gridCols(n)
  return { cols, rows: Math.max(1, Math.ceil(n / cols)) }
}

// The spans of the panes in order: the last pane stretches across the rest of its row.
export function paneSpans(n: number): { cols: number; rows: number }[] {
  const shape = gridShape(n)
  return Array.from({ length: n }, (_, i) => ({ cols: i === n - 1 ? shape.cols - (i % shape.cols) : 1, rows: 1 }))
}

// A tab as the grid sees it: whether the human put it in the grid.
export interface GridTab {
  inGrid: boolean
}

// The tabs the human put in the grid, in tab order, at most max. A tab not put there is not a pane.
export function gridMembers<T extends GridTab>(tabs: T[], max = GRID_MAX): T[] {
  return tabs.filter((tab) => tab.inGrid).slice(0, max)
}

// Whether one more tab fits in a grid that already holds count tabs.
export function canJoinGrid(count: number, max = GRID_MAX): boolean {
  return count < max
}

export type PaneDirection = 'left' | 'right' | 'up' | 'down'

// The pane next to pane index in a direction, or index when there is none. The last pane stretches across the rest of its row, so a move down into the last row lands on it.
export function neighborPane(n: number, index: number, direction: PaneDirection): number {
  const { cols } = gridShape(n)
  const row = Math.floor(index / cols)
  const col = index % cols
  if (direction === 'left') return col > 0 ? index - 1 : index
  if (direction === 'right') return col < cols - 1 && index + 1 < n ? index + 1 : index
  if (direction === 'up') return row > 0 ? index - cols : index
  const below = (row + 1) * cols
  return below >= n ? index : Math.min(below + col, n - 1)
}
