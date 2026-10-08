import { describe, expect, it } from 'vitest'
import type { DiffFile, SessionDiff } from '@shared/types'
import type { DiffLine } from '@shared/types'
import { fileFocusTarget, filterFiles, gaps, lineKey, pickFile, rangeAnchor, selectionRange, splitRows, visibleFiles, wordMarks, wordSegs } from './diffView'

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

const ctx = (o: number, n: number, text = 'c'): DiffLine => ({ kind: 'context', text, old: o, new: n })
const del = (o: number, text: string): DiffLine => ({ kind: 'del', text, old: o, new: null })
const add = (n: number, text: string): DiffLine => ({ kind: 'add', text, old: null, new: n })

describe('wordSegs', () => {
  it('marks only the words that changed', () => {
    const [a, b] = wordSegs('const x = foo(1)', 'const y = foo(2)')!
    expect(a.filter((s) => s.changed).map((s) => s.text)).toEqual(['x', '1'])
    expect(b.filter((s) => s.changed).map((s) => s.text)).toEqual(['y', '2'])
    expect(a.map((s) => s.text).join('')).toBe('const x = foo(1)')
    expect(b.map((s) => s.text).join('')).toBe('const y = foo(2)')
  })
  it('gives nothing for lines with no word in common, or very long ones', () => {
    expect(wordSegs('alpha', 'beta')).toBeNull()
    expect(wordSegs('a '.repeat(400), 'b '.repeat(400))).toBeNull()
  })
})

describe('wordMarks', () => {
  it('pairs the i-th removed line with the i-th added line of a block', () => {
    const lines = [ctx(1, 1), del(2, 'one two'), del(3, 'gone'), add(2, 'one three'), ctx(4, 3)]
    const m = wordMarks(lines)
    expect([...m.keys()]).toEqual([1, 3])
    expect(m.get(3)!.find((s) => s.changed)!.text).toBe('three')
  })
})

describe('splitRows', () => {
  it('puts context on both sides and a changed block side by side', () => {
    const lines = [ctx(1, 1), del(2, 'a'), del(3, 'b'), add(2, 'A'), ctx(4, 3)]
    const rows = splitRows(lines)
    expect(rows.map((r) => [r.left?.li ?? null, r.right?.li ?? null])).toEqual([[0, 0], [1, 3], [2, null], [4, 4]])
  })
})

describe('gaps', () => {
  const hunk = (newStart: number, lines: DiffLine[]) => ({ header: '@@', oldStart: newStart, newStart, lines })
  const f = (hunks: ReturnType<typeof hunk>[], status: DiffFile['status'] = 'modified'): DiffFile => ({ ...file('a.ts', status), hunks })

  it('finds the lines before the first hunk and between hunks, with the old-number shift', () => {
    const out = gaps(f([
      hunk(11, [ctx(11, 11), del(12, 'x'), add(12, 'y'), add(13, 'z'), ctx(13, 14)]),
      hunk(40, [ctx(39, 40), add(41, 'q'), ctx(40, 42)]),
    ]))
    expect(out).toEqual([{ index: 0, from: 1, to: 10, delta: 0 }, { index: 1, from: 15, to: 39, delta: -1 }])
  })
  it('has none when a hunk starts at line 1, for whole-file hunks, and for deleted files', () => {
    expect(gaps(f([hunk(1, [add(1, 'x')])], 'added'))).toEqual([])
    expect(gaps(f([hunk(1, [del(1, 'x')])], 'deleted'))).toEqual([])
  })
  it('numbers a removal-only hunk by the line before it', () => {
    const out = gaps(f([hunk(3, [ctx(3, 3), del(4, 'x')]), hunk(20, [ctx(19, 20), del(20, 'y'), ctx(21, 21)])]))
    expect(out[1]).toMatchObject({ from: 4, to: 19 })
  })
})

describe('file list helpers', () => {
  it('filters by path and picks the chosen file or the first', () => {
    expect(filterFiles(diff.files, 'NEW').map((x) => x.path)).toEqual(['new.ts'])
    expect(filterFiles(diff.files, ' ')).toBe(diff.files)
    expect(pickFile(diff.files, 'b.ts')!.path).toBe('b.ts')
    expect(pickFile(diff.files, 'gone.ts')!.path).toBe('a.ts')
    expect(pickFile([], null)).toBeNull()
  })

  it('moves keyboard focus from the filter through the file list and back', () => {
    expect(fileFocusTarget(-1, 'down', 3)).toBe(0)
    expect(fileFocusTarget(0, 'down', 3)).toBe(1)
    expect(fileFocusTarget(2, 'down', 3)).toBeNull()
    expect(fileFocusTarget(0, 'up', 3)).toBe('filter')
    expect(fileFocusTarget(-1, 'down', 0)).toBeNull()
  })
})
