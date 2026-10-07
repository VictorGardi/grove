import { describe, expect, it } from 'vitest'
import type { Comment, DiffFile, DiffLine, SessionDiff } from '@shared/types'
import { reanchorDiff } from './anchor'

const ctxLine = (n: number, text: string): DiffLine => ({ kind: 'context', text, old: n, new: n })
const add = (n: number, text: string): DiffLine => ({ kind: 'add', text, old: null, new: n })
const del = (n: number, text: string): DiffLine => ({ kind: 'del', text, old: n, new: null })

const file = (lines: DiffLine[][], over: Partial<DiffFile> = {}): DiffFile => ({
  path: 'a.ts', oldPath: null, status: 'modified', binary: false, additions: 0, deletions: 0, truncated: false, rendered: null,
  hunks: lines.map((l) => ({ header: '@@', oldStart: 1, newStart: 1, lines: l })),
  ...over,
})
const diff = (files: DiffFile[], over: Partial<SessionDiff> = {}): SessionDiff => ({
  sessionId: 's', projectId: 'p', state: 'ok', error: null, root: '/r', files, truncated: false, ...over,
})
const draft = (a: { side?: 'old' | 'new'; start: number; end: number; lines: string[] }, over: Partial<Comment> = {}): Comment => ({
  id: 'c', sessionId: 's', anchor: { kind: 'diff', root: '/r', path: 'a.ts', side: a.side ?? 'new', start: a.start, end: a.end, lines: a.lines },
  body: 'b', state: 'draft', orphaned: false, createdAt: '', updatedAt: '', sentAt: null, ...over,
})
const anchorOf = (c: Comment) => c.anchor as Extract<Comment['anchor'], { kind: 'diff' }>

describe('reanchorDiff', () => {
  it('returns the same array when nothing changed', () => {
    const cs = [draft({ start: 2, end: 3, lines: ['b', 'c'] })]
    expect(reanchorDiff(cs, diff([file([[ctxLine(1, 'a'), add(2, 'b'), add(3, 'c')]])]))).toBe(cs)
  })

  it('follows lines moved down', () => {
    const cs = [draft({ start: 2, end: 3, lines: ['b', 'c'] })]
    const out = reanchorDiff(cs, diff([file([[add(1, 'x'), add(2, 'y'), add(3, 'z'), add(4, 'b'), add(5, 'c')]])]))
    expect(anchorOf(out[0])).toMatchObject({ start: 4, end: 5 })
    expect(out[0].orphaned).toBe(false)
  })

  it('takes the nearest of two matches', () => {
    const cs = [draft({ start: 10, end: 10, lines: ['dup'] })]
    const out = reanchorDiff(cs, diff([file([[add(2, 'dup')], [add(9, 'dup')]])]))
    expect(anchorOf(out[0]).start).toBe(9)
  })

  it('orphans a draft whose lines are gone, keeping its text', () => {
    const cs = [draft({ start: 2, end: 2, lines: ['b'] })]
    const out = reanchorDiff(cs, diff([file([[add(2, 'changed')]])]))
    expect(out[0].orphaned).toBe(true)
    expect(anchorOf(out[0])).toMatchObject({ start: 2, end: 2, lines: ['b'] })
  })

  it('does not match across a gap in the numbers', () => {
    const cs = [draft({ start: 2, end: 3, lines: ['b', 'c'] })]
    const out = reanchorDiff(cs, diff([file([[add(2, 'b')], [add(8, 'c')]])]))
    expect(out[0].orphaned).toBe(true)
  })

  it('finds lines again and clears the orphan mark', () => {
    const cs = [draft({ start: 2, end: 2, lines: ['b'] }, { orphaned: true })]
    const out = reanchorDiff(cs, diff([file([[add(2, 'b')]])]))
    expect(out[0].orphaned).toBe(false)
  })

  it('orphans a draft whose file left the diff', () => {
    const cs = [draft({ start: 2, end: 2, lines: ['b'] })]
    expect(reanchorDiff(cs, diff([]))[0].orphaned).toBe(true)
  })

  it('matches the old side over removed and context lines', () => {
    const cs = [draft({ side: 'old', start: 3, end: 4, lines: ['gone', 'kept'] })]
    const out = reanchorDiff(cs, diff([file([[add(1, 'new'), del(5, 'gone'), ctxLine(6, 'kept')]])]))
    expect(anchorOf(out[0])).toMatchObject({ start: 5, end: 6 })
  })

  it('leaves other sessions, roots, sent, notes and artifacts alone', () => {
    const cs: Comment[] = [
      draft({ start: 2, end: 2, lines: ['b'] }, { id: '1', sessionId: 'other' }),
      { ...draft({ start: 2, end: 2, lines: ['b'] }, { id: '2' }), anchor: { ...anchorOf(draft({ start: 2, end: 2, lines: ['b'] })), root: '/elsewhere' } },
      draft({ start: 2, end: 2, lines: ['b'] }, { id: '3', state: 'sent' }),
      { ...draft({ start: 2, end: 2, lines: ['b'] }, { id: '4' }), anchor: { kind: 'note' } },
      { ...draft({ start: 2, end: 2, lines: ['b'] }, { id: '5' }), anchor: { kind: 'artifact', projectId: 'p', slug: 's', path: 'x.md', exact: 'e', prefix: '', suffix: '', start: 1, end: 1 } },
    ]
    expect(reanchorDiff(cs, diff([]))).toBe(cs)
  })

  it('leaves everything alone when the diff is not ok, truncated, or the file is cut', () => {
    const cs = [draft({ start: 2, end: 2, lines: ['b'] })]
    expect(reanchorDiff(cs, diff([], { state: 'error' }))).toBe(cs)
    expect(reanchorDiff(cs, diff([], { truncated: true }))).toBe(cs)
    expect(reanchorDiff(cs, diff([file([], { truncated: true })]))).toBe(cs)
    expect(reanchorDiff(cs, diff([file([], { binary: true })]))).toBe(cs)
  })
})
