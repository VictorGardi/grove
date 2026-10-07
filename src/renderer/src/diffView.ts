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

// The comment being written: lines of one hunk on one side, from `origin` to `end` (hunk line indices).
export interface DraftRange { path: string; hunk: number; side: 'old' | 'new'; origin: number; end: number }
export interface LineRef { path: string; hunk: number; li: number }

// The range a text selection from one line to another stands for: the side of its first line, and only
// that side's lines. null when it spans files or hunks, or has no line of that side.
export function selectionRange(file: DiffFile, a: LineRef, b: LineRef): DraftRange | null {
  if (a.path !== b.path || a.hunk !== b.hunk || a.path !== file.path) return null
  const lines = file.hunks[a.hunk]?.lines
  if (!lines) return null
  const lo = Math.min(a.li, b.li)
  const hi = Math.max(a.li, b.li)
  if (!lines[lo] || !lines[hi]) return null
  const side = sideOf(lines[lo])
  const idx: number[] = []
  for (let i = lo; i <= hi; i++) if (sideOf(lines[i]) === side) idx.push(i)
  return { path: file.path, hunk: a.hunk, side, origin: idx[0], end: idx[idx.length - 1] }
}
