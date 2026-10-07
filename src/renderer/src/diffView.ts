import type { CommentAnchor, DiffFile, DiffLine, SessionDiff } from '@shared/types'

export function visibleFiles(d: SessionDiff, showUntracked: boolean): DiffFile[] {
  return showUntracked ? d.files : d.files.filter((f) => f.status !== 'untracked')
}

// A line's identity (design): add → new side, del → old side, context → new side.
export function lineKey(path: string, l: DiffLine): string {
  return l.kind === 'del' ? `${path}:old:${l.old}` : `${path}:new:${l.new}`
}

// Collapsed files are kept by path. Toggle all: expand when every file is collapsed, else collapse all.
export function allCollapsed(collapsed: ReadonlySet<string>, files: DiffFile[]): boolean {
  return files.length > 0 && files.every((f) => collapsed.has(f.path))
}

export function toggleAll(collapsed: ReadonlySet<string>, files: DiffFile[]): Set<string> {
  return allCollapsed(collapsed, files) ? new Set() : new Set(files.map((f) => f.path))
}

export function toggleOne(collapsed: ReadonlySet<string>, path: string): Set<string> {
  const next = new Set(collapsed)
  if (!next.delete(path)) next.add(path)
  return next
}

export const sideOf = (l: DiffLine): 'old' | 'new' => (l.kind === 'del' ? 'old' : 'new')

// The comment anchor for the lines of one hunk on one side, between two clicked line indices (either order).
export function rangeAnchor(root: string, file: DiffFile, hunk: number, side: 'old' | 'new', a: number, b: number): Extract<CommentAnchor, { kind: 'diff' }> | null {
  const lines = file.hunks[hunk]?.lines.slice(Math.min(a, b), Math.max(a, b) + 1).filter((l) => sideOf(l) === side) ?? []
  if (lines.length === 0) return null
  const num = (l: DiffLine) => (side === 'old' ? l.old : l.new)!
  return { kind: 'diff', root, path: file.path, side, start: num(lines[0]), end: num(lines[lines.length - 1]), lines: lines.map((l) => l.text) }
}
