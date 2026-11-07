import { describe, expect, it } from 'vitest'
import type { DiffComment, DiffCompared, DiffFile, DiffLine } from '../protocol/messages.ts'
import { baseChoices, branchNote, changeBar, commentContext, commentRange, commentWhere, commentKey, commentSide, placeComments, relativeTime, emptyMessage, lineWords, matchFiles, sendState, settled, splitPath, summarize, wordDiff, type SendTarget, type WordSegment } from './diff-model.ts'

const file = (path: string, status: DiffFile['status'] = 'modified'): DiffFile => ({
  path, oldPath: null, status, binary: false, additions: 1, deletions: 0, hunks: [], truncated: false,
})
const compared = (over: Partial<DiffCompared> = {}): DiffCompared => ({
  mode: 'branch', base: null, defaultBase: 'main', onDefault: false, noDefault: false, noOwnCommits: false, ...over,
})

describe('file list', () => {
  const files = [file('README.md'), file('src/a/one.ts'), file('src/a/two.ts'), file('src/b.ts')]

  it('keeps the order the core sent, and filters by path case-insensitively', () => {
    expect(matchFiles(files, '').map((f) => f.path)).toEqual(['README.md', 'src/a/one.ts', 'src/a/two.ts', 'src/b.ts'])
    expect(matchFiles(files, ' ONE ').map((f) => f.path)).toEqual(['src/a/one.ts'])
    expect(matchFiles(files, 'nothing')).toEqual([])
  })

  it('splits a path into its directory and its name', () => {
    expect(splitPath('src/a/one.ts')).toEqual({ dir: 'src/a/', name: 'one.ts' })
    expect(splitPath('README.md')).toEqual({ dir: '', name: 'README.md' })
  })

  it('sums the lines of files whose lines are known', () => {
    const list = [file('a'), { ...file('b'), additions: 4, deletions: 2 }, { ...file('c'), binary: true, additions: 9 }, { ...file('d'), truncated: true, additions: 9 }]
    expect(summarize(list)).toEqual({ files: 4, additions: 5, deletions: 2 })
  })
})

describe('change bar', () => {
  it('splits five squares by the share of additions, keeping a minority visible', () => {
    expect(changeBar(10, 0)).toEqual(['add', 'add', 'add', 'add', 'add'])
    expect(changeBar(0, 3)).toEqual(['del', 'del', 'del', 'del', 'del'])
    expect(changeBar(4, 1)).toEqual(['add', 'add', 'add', 'add', 'del'])
    expect(changeBar(1, 100)).toEqual(['add', 'del', 'del', 'del', 'del'])
    expect(changeBar(100, 1)).toEqual(['add', 'add', 'add', 'add', 'del'])
    expect(changeBar(0, 0)).toEqual(['none', 'none', 'none', 'none', 'none'])
  })
})

describe('word diff', () => {
  const text = (segments: WordSegment[], changed: boolean): string => segments.filter((s) => s.changed === changed).map((s) => s.text).join('|')

  it('marks the words that changed and keeps the rest plain', () => {
    const pair = wordDiff('const total = count + 1', 'const total = count + step')
    expect(pair?.before).toEqual([{ text: 'const total = count + ', changed: false }, { text: '1', changed: true }])
    expect(pair?.after).toEqual([{ text: 'const total = count + ', changed: false }, { text: 'step', changed: true }])
  })

  it('marks an inserted word on one side only', () => {
    const pair = wordDiff('foo(a, b)', 'foo(a, extra, b)')
    expect(text(pair!.before, true)).toBe('')
    expect(text(pair!.after, true)).toBe('extra, ')
    expect(pair!.after.map((s) => s.text).join('')).toBe('foo(a, extra, b)')
  })

  it('gives no marks to lines that share too little, or have nothing to mark', () => {
    expect(wordDiff('alpha beta gamma', 'one two three')).toBeNull()
    expect(wordDiff('same line', 'same line')).toBeNull()
    expect(wordDiff('x '.repeat(400), 'y '.repeat(400))).toBeNull()
  })

  it('pairs a run of deleted lines with the run of added lines after it, line by line', () => {
    const line = (kind: DiffLine['kind'], t: string): DiffLine => ({ kind, text: t, old: null, new: null })
    const marks = lineWords([line('context', 'keep'), line('del', 'let a = 1'), line('del', 'let b = 2'), line('add', 'let a = 10'), line('add', 'let b = 20'), line('add', 'extra'), line('context', 'end')])
    expect(marks.map((m) => m !== null)).toEqual([false, true, true, true, true, false, false])
    expect(text(marks[1]!, true)).toBe('1')
    expect(text(marks[4]!, true)).toBe('20')
  })

  it('leaves an added line with no deleted line before it alone', () => {
    expect(lineWords([{ kind: 'add', text: 'x', old: null, new: 1 }, { kind: 'del', text: 'y', old: 1, new: null }])).toEqual([null, null])
  })
})

describe('base choices', () => {
  const refs = { branches: ['main', 'origin/main', 'dev', 'feature', 'origin/old'], current: 'feature', default: 'main' }

  it('lists the default, then recents that still exist, never the current branch', () => {
    expect(baseChoices(refs, ['dev', 'gone', 'feature', 'main'], '')).toEqual([
      { ref: null, name: 'main', kind: 'default' },
      { ref: 'dev', name: 'dev', kind: 'recent' },
    ])
  })

  it('searches local and remote branches, without the current branch or the default twice', () => {
    expect(baseChoices(refs, [], 'o').map((c) => c.name)).toEqual(['origin/old'])
    expect(baseChoices(refs, [], 'ma').map((c) => c.name)).toEqual(['main'])
    expect(baseChoices(refs, [], 'FEAT')).toEqual([])
  })
})

describe('empty messages', () => {
  it('words each mode and where the quick switch goes', () => {
    expect(emptyMessage(compared(), 'branch')).toMatchObject({ text: 'No changes on this branch compared to main.', switchTo: { mode: 'last-commit' } })
    expect(emptyMessage(compared({ base: 'dev' }), 'branch').text).toBe('No changes on this branch compared to dev.')
    expect(emptyMessage(compared(), 'uncommitted')).toMatchObject({ text: 'No uncommitted changes.', switchTo: { mode: 'branch' } })
    expect(emptyMessage(compared(), 'last-commit')).toMatchObject({ text: 'No commits to show.', switchTo: { mode: 'uncommitted' } })
    expect(emptyMessage(compared({ onDefault: true }), 'branch')).toMatchObject({ text: 'No uncommitted changes.', switchTo: { mode: 'last-commit' } })
  })

  it('notes a Branch mode with no main branch only for the default pick', () => {
    expect(branchNote(compared({ noDefault: true }))).toContain('No main branch found')
    expect(branchNote(compared({ noDefault: true, base: 'dev' }))).toBeNull()
  })
})

describe('refresh trigger', () => {
  it('fires when an agent stops working, and not otherwise', () => {
    expect(settled('working', 'idle')).toBe(true)
    expect(settled('working', 'needs-you')).toBe(true)
    expect(settled('working', 'finished')).toBe(true)
    expect(settled('working', 'unknown')).toBe(false)
    expect(settled('idle', 'working')).toBe(false)
    expect(settled(undefined, 'idle')).toBe(false)
  })
})

describe('send state', () => {
  it('disables Send while an agent needs auth, but allows it for an error', () => {
    const target: SendTarget = { name: 'api', kind: 'claude', state: 'needs-you', reason: 'error', exited: false }
    const authTarget: SendTarget = { ...target, reason: 'auth' }

    expect(sendState(1, authTarget, true).reason).toBe('claude is waiting for an answer')
    expect(sendState(1, target, true).reason).toBeNull()
  })
})

describe('review comments', () => {
  const ln = (kind: DiffLine['kind'], text: string, old: number | null, nu: number | null): DiffLine => ({ kind, text, old, new: nu })
  const lines = [ln('context', 'a', 1, 1), ln('del', 'old b', 2, null), ln('add', 'new b', null, 2), ln('context', 'c', 3, 3), ln('context', 'd', 4, 4), ln('context', 'e', 5, 5)]
  const withHunk = (path: string): DiffFile => ({ ...file(path), hunks: [{ header: '@@', oldStart: 1, newStart: 1, lines }] })
  const comment = (over: Partial<DiffComment> = {}): DiffComment => ({
    id: 'c1', path: 'a.ts', side: 'new', line: 2, anchor: 'new b', before: [], after: [], body: 'x', state: 'pending', createdAt: 0, ...over,
  })

  it('puts a comment on the old side for a deleted line and the new side for the rest', () => {
    expect(commentSide(lines[1])).toEqual({ side: 'old', line: 2 })
    expect(commentSide(lines[2])).toEqual({ side: 'new', line: 2 })
    expect(commentSide(lines[0])).toEqual({ side: 'new', line: 1 })
  })

  it('takes the line and two lines of its own side around it, within the hunk', () => {
    expect(commentContext(lines, [2])).toEqual({ anchor: 'new b', before: ['a'], after: ['c', 'd'] })
    expect(commentContext(lines, [1])).toEqual({ anchor: 'old b', before: ['a'], after: ['c', 'd'] })
    expect(commentContext(lines, [5])).toEqual({ anchor: 'e', before: ['c', 'd'], after: [] })
    expect(commentContext([ln('add', 'x'.repeat(600), null, 1)], [0]).anchor).toHaveLength(500)
  })

  it('covers the lines of the first line\'s side from one index to another, either way round', () => {
    expect(commentRange(lines, 2, 4)).toEqual({ side: 'new', line: 2, endLine: 4, indexes: [2, 3, 4] })
    expect(commentRange(lines, 4, 0)).toEqual({ side: 'new', line: 1, endLine: 4, indexes: [0, 2, 3, 4] })
    expect(commentRange(lines, 1, 3)).toEqual({ side: 'old', line: 2, endLine: 3, indexes: [1, 3] })
    expect(commentRange(lines, 3, 3)).toEqual({ side: 'new', line: 3, indexes: [3] })
    expect(commentContext(lines, [2, 3, 4])).toEqual({ anchor: 'new b\nc\nd', before: ['a'], after: ['e'] })
  })

  it('keeps a range inline only while every line has its text, and draws it under the last line', () => {
    const range = comment({ line: 2, endLine: 4, anchor: 'new b\nc\nd' })
    expect(placeComments([withHunk('a.ts')], [range]).inline.get(commentKey('a.ts', 'new', 4))).toEqual([range])
    expect(placeComments([withHunk('a.ts')], [{ ...range, anchor: 'new b\nc\nX' }]).outdated.get('a.ts')).toHaveLength(1)
    expect(placeComments([withHunk('a.ts')], [{ ...range, endLine: 9, anchor: 'new b\nc\nd' }]).outdated.get('a.ts')).toHaveLength(1)
    expect(commentWhere(range)).toBe('a.ts:2-4')
    // A core from before ranges saved the three lines' anchor without endLine: it still fits, under its last line.
    const old = comment({ line: 2, anchor: 'new b\nc\nd' })
    expect(placeComments([withHunk('a.ts')], [old]).inline.get(commentKey('a.ts', 'new', 4))).toEqual([old])
    expect(commentWhere(old)).toBe('a.ts:2-4')
    expect(commentWhere(comment({ side: 'old' }))).toBe('a.ts:2 (old)')
  })

  it('keeps a comment inline while its line has the same text, by side and number', () => {
    const placed = placeComments([withHunk('a.ts')], [comment(), comment({ id: 'c2', side: 'old', anchor: 'old b' }), comment({ id: 'c3' })])
    expect(placed.inline.get(commentKey('a.ts', 'new', 2))?.map((c) => c.id)).toEqual(['c1', 'c3'])
    expect(placed.inline.get(commentKey('a.ts', 'old', 2))?.map((c) => c.id)).toEqual(['c2'])
    expect(placed.outdated.size).toBe(0)
  })

  it('calls a comment outdated when the text changed, the line is gone, or the file is not in the diff, and never moves it', () => {
    const placed = placeComments(
      [withHunk('a.ts'), file('b.ts')],
      [comment({ id: 'text', anchor: 'changed' }), comment({ id: 'line', line: 99 }), comment({ id: 'file', path: 'gone.ts' }), comment({ id: 'nohunks', path: 'b.ts' })],
    )
    expect(placed.inline.size).toBe(0)
    expect(placed.outdated.get('a.ts')?.map((c) => c.id)).toEqual(['text', 'line'])
    expect(placed.outdated.get('gone.ts')?.map((c) => c.id)).toEqual(['file'])
    expect(placed.outdated.get('b.ts')?.map((c) => c.id)).toEqual(['nohunks'])
  })

  it('compares a very long line by its first 500 characters, as the core keeps it', () => {
    const long = [ln('add', 'y'.repeat(700), null, 1)]
    const f: DiffFile = { ...file('a.ts'), hunks: [{ header: '@@', oldStart: 1, newStart: 1, lines: long }] }
    expect(placeComments([f], [comment({ line: 1, anchor: 'y'.repeat(500) })]).inline.size).toBe(1)
  })

  it('words how long ago', () => {
    expect(relativeTime(1000, 1000 + 20_000)).toBe('just now')
    expect(relativeTime(0, 5 * 60_000)).toBe('5 min ago')
    expect(relativeTime(0, 3 * 3600_000)).toBe('3 h ago')
    expect(relativeTime(0, 2 * 86400_000)).toBe('2 d ago')
    expect(relativeTime(10_000, 0)).toBe('just now')
  })
})
