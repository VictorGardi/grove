import { describe, expect, it } from 'vitest'
import type { DiffFile, SessionDiff } from '@shared/types'
import { allCollapsed, lineKey, rangeAnchor, selectionRange, toggleAll, toggleOne, visibleFiles } from './diffView'

const file = (path: string, status: DiffFile['status']): DiffFile =>
  ({ path, oldPath: null, status, binary: false, additions: 0, deletions: 0, hunks: [], truncated: false, rendered: null })
const diff: SessionDiff = {
  sessionId: 's', projectId: 'p', state: 'ok', error: null, root: '/r', truncated: false,
  files: [file('a.ts', 'modified'), file('new.ts', 'untracked'), file('b.ts', 'added')],
}

describe('visibleFiles', () => {
  it('shows untracked files when asked, and hides them otherwise', () => {
    expect(visibleFiles(diff, true).map((f) => f.path)).toEqual(['a.ts', 'new.ts', 'b.ts'])
    expect(visibleFiles(diff, false).map((f) => f.path)).toEqual(['a.ts', 'b.ts'])
  })
})

describe('lineKey', () => {
  it('keys add and context lines by the new side and del lines by the old side', () => {
    expect(lineKey('a.ts', { kind: 'add', text: 'x', old: null, new: 4 })).toBe('a.ts:new:4')
    expect(lineKey('a.ts', { kind: 'context', text: 'x', old: 2, new: 3 })).toBe('a.ts:new:3')
    expect(lineKey('a.ts', { kind: 'del', text: 'x', old: 7, new: null })).toBe('a.ts:old:7')
  })
})

describe('collapsing files', () => {
  it('toggles one file', () => {
    expect([...toggleOne(new Set(), 'a.ts')]).toEqual(['a.ts'])
    expect([...toggleOne(new Set(['a.ts', 'b.ts']), 'a.ts')]).toEqual(['b.ts'])
  })

  it('collapses all unless every file already is, then expands all', () => {
    const files = diff.files
    expect(allCollapsed(new Set(), files)).toBe(false)
    const all = toggleAll(new Set(['a.ts']), files)
    expect([...all]).toEqual(['a.ts', 'new.ts', 'b.ts'])
    expect(allCollapsed(all, files)).toBe(true)
    expect([...toggleAll(all, files)]).toEqual([])
    expect(allCollapsed(new Set(), [])).toBe(false)
  })
})

describe('rangeAnchor', () => {
  const f: DiffFile = {
    ...file('a.ts', 'modified'),
    hunks: [{ header: '@@', oldStart: 1, newStart: 1, lines: [
      { kind: 'context', text: 'c1', old: 1, new: 1 },
      { kind: 'del', text: 'gone', old: 2, new: null },
      { kind: 'add', text: 'new1', old: null, new: 2 },
      { kind: 'add', text: 'new2', old: null, new: 3 },
      { kind: 'context', text: 'c2', old: 3, new: 4 },
    ] }],
  }
  it('covers the new-side lines between two clicks, in either order', () => {
    const want = { kind: 'diff', root: '/r', path: 'a.ts', side: 'new', start: 2, end: 4, lines: ['new1', 'new2', 'c2'] }
    expect(rangeAnchor('/r', f, 0, 'new', 2, 4)).toEqual(want)
    expect(rangeAnchor('/r', f, 0, 'new', 4, 2)).toEqual(want)
  })
  it('a removed line is on the old side, numbered by its old number', () => {
    expect(rangeAnchor('/r', f, 0, 'old', 1, 1)).toEqual({ kind: 'diff', root: '/r', path: 'a.ts', side: 'old', start: 2, end: 2, lines: ['gone'] })
  })
  it('is null when no line of that side is in range', () => {
    expect(rangeAnchor('/r', f, 0, 'old', 2, 3)).toBeNull()
  })
})

describe('selectionRange', () => {
  const f: DiffFile = {
    ...file('a.ts', 'modified'),
    hunks: [{ header: '@@', oldStart: 1, newStart: 1, lines: [
      { kind: 'context', text: 'c1', old: 1, new: 1 },
      { kind: 'del', text: 'gone', old: 2, new: null },
      { kind: 'add', text: 'new1', old: null, new: 2 },
      { kind: 'context', text: 'c2', old: 3, new: 3 },
    ] }],
  }
  const at = (li: number, path = 'a.ts', hunk = 0) => ({ path, hunk, li })
  it('uses the side of the first line and drops lines of the other side', () => {
    expect(selectionRange(f, at(0), at(3))).toEqual({ path: 'a.ts', hunk: 0, side: 'new', origin: 0, end: 3 })
    expect(selectionRange(f, at(3), at(1))).toEqual({ path: 'a.ts', hunk: 0, side: 'old', origin: 1, end: 1 })
  })
  it('is null across files or hunks, or for an unknown line', () => {
    expect(selectionRange(f, at(0), at(1, 'b.ts'))).toBeNull()
    expect(selectionRange(f, at(0), at(1, 'a.ts', 1))).toBeNull()
    expect(selectionRange(f, at(0), at(9))).toBeNull()
  })
})
