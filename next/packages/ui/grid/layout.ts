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

// The first max members, in order.
export function gridMembers(ids: string[], max = GRID_MAX): string[] {
  return ids.slice(0, max)
}
