import { describe, expect, it } from 'vitest'
import type { Session } from '@shared/types'
import { barCounts, childrenCount, familyJumpTarget, familyOf, runProgress } from './family'

const session = (id: string, over: Partial<Session> = {}): Session =>
  ({ id, projectId: 'p', kind: 'claude', label: id, lastStatus: 'running', startedAt: '2026-10-05T10:00:00.000Z', ...over } as Session)

const parent = session('parent')
const child = (id: string, over: Partial<Session> = {}) => session(id, { link: { id: 'parent', kind: 'group' }, ...over })
const ids = (xs: Session[]) => xs.map((x) => x.id)

describe('familyOf finished children', () => {
  it('ranks a finished child as idle, below a real wait', () => {
    const f = familyOf([parent,
      child('finished', { status: 'waiting', waitingFor: 'done' }),
      child('idle', { status: 'idle' }),
      child('ask', { status: 'waiting', waitingFor: 'permission' })], 'parent')
    expect(ids(f.children)).toEqual(['ask', 'finished', 'idle'])
  })
})

describe('familyOf', () => {
  it('ranks waiting over working over idle', () => {
    const f = familyOf([parent, child('idle', { status: 'idle' }), child('working', { status: 'working' }), child('waiting', { status: 'waiting', waitingFor: 'question' })], 'parent')
    expect(ids(f.children)).toEqual(['waiting', 'working', 'idle'])
    expect(f.active?.id).toBe('waiting')
  })

  it('makes a sole running child active', () => {
    expect(familyOf([parent, child('c')], 'parent').active?.id).toBe('c')
  })

  it('never makes an ended or failed child active', () => {
    const f = familyOf([parent, child('gone', { lastStatus: 'gone' }), child('failed', { startup: { phase: 'failed', reason: 'boom' } })], 'parent')
    expect(f.active).toBeNull()
    expect(f.children).toHaveLength(2)
  })

  it('breaks ties by later lastFocusedAt, missing last, then later startedAt', () => {
    const f = familyOf([
      parent,
      child('none-old', { status: 'working', startedAt: '2026-10-05T09:00:00.000Z' }),
      child('none-new', { status: 'working', startedAt: '2026-10-05T11:00:00.000Z' }),
      child('focused-old', { status: 'working', lastFocusedAt: '2026-10-05T12:00:00.000Z' }),
      child('focused-new', { status: 'working', lastFocusedAt: '2026-10-05T13:00:00.000Z' }),
    ], 'parent')
    expect(ids(f.children)).toEqual(['focused-new', 'focused-old', 'none-new', 'none-old'])
  })

  it('breaks an identical lastFocusedAt by later startedAt', () => {
    const f = familyOf([
      parent,
      child('old', { status: 'working', lastFocusedAt: '2026-10-05T12:00:00.000Z', startedAt: '2026-10-05T09:00:00.000Z' }),
      child('new', { status: 'working', lastFocusedAt: '2026-10-05T12:00:00.000Z', startedAt: '2026-10-05T11:00:00.000Z' }),
    ], 'parent')
    expect(ids(f.children)).toEqual(['new', 'old'])
    expect(f.active?.id).toBe('new')
  })

  it('ranks a finished (waiting · done) child below a working one: it is not asking the human', () => {
    const f = familyOf([parent, child('working', { status: 'working' }), child('done', { status: 'waiting', waitingFor: 'done' })], 'parent')
    expect(f.active?.id).toBe('working')
  })

  it('orders ended children by later startedAt, after running ones', () => {
    const f = familyOf([
      parent,
      child('old', { lastStatus: 'gone', startedAt: '2026-10-05T09:00:00.000Z' }),
      child('live', { status: 'idle' }),
      child('new', { lastStatus: 'gone', startedAt: '2026-10-05T11:00:00.000Z' }),
    ], 'parent')
    expect(ids(f.children)).toEqual(['live', 'new', 'old'])
  })

  it('gives a lone session no family', () => {
    expect(familyOf([session('a'), session('b')], 'a')).toEqual({ parent: null, children: [], active: null })
  })

  it('ranks starting after running', () => {
    const f = familyOf([parent, child('starting', { startup: { phase: 'starting', since: '2026-10-05T10:00:00.000Z' } }), child('terminal', { kind: 'terminal' })], 'parent')
    expect(ids(f.children)).toEqual(['terminal', 'starting'])
  })

  it('finds the parent while it still exists', () => {
    expect(familyOf([parent, child('c')], 'c').parent?.id).toBe('parent')
    expect(familyOf([child('c')], 'c').parent).toBeNull()
  })

  it('gives a child of a removed parent no parent', () => {
    expect(familyOf([session('other'), child('c')], 'c').parent).toBeNull()
  })

  it('still finds an ended parent', () => {
    expect(familyOf([session('parent', { lastStatus: 'gone' }), child('c')], 'c').parent?.id).toBe('parent')
  })
})

describe('childrenCount', () => {
  it('says "1 child" and "N children"', () => {
    expect(childrenCount(1)).toBe('1 child')
    expect(childrenCount(3)).toBe('3 children')
  })
})

describe('familyOf children list', () => {
  it('lists running children by rank, then ended ones', () => {
    const f = familyOf([
      parent,
      child('ended', { lastStatus: 'gone' }),
      child('idle', { status: 'idle' }),
      child('waiting', { status: 'waiting', waitingFor: 'question' }),
      child('working', { status: 'working' }),
    ], 'parent')
    expect(ids(f.children)).toEqual(['waiting', 'working', 'idle', 'ended'])
  })

  it('still lists children that have all ended, with none active', () => {
    const f = familyOf([parent, child('a', { lastStatus: 'gone' }), child('b', { lastStatus: 'gone' })], 'parent')
    expect(f.active).toBeNull()
    expect(ids(f.children).sort()).toEqual(['a', 'b'])
  })
})

describe('familyJumpTarget', () => {
  it('goes from a parent to its active child', () => {
    expect(familyJumpTarget([parent, child('idle', { status: 'idle' }), child('waiting', { status: 'waiting', waitingFor: 'question' })], 'parent')?.id).toBe('waiting')
  })

  it('goes from a child to its parent', () => {
    expect(familyJumpTarget([parent, child('c')], 'c')?.id).toBe('parent')
  })

  it('goes nowhere from a lone session, an unknown id or no focus', () => {
    expect(familyJumpTarget([session('a'), session('b')], 'a')).toBeNull()
    expect(familyJumpTarget([parent, child('c')], 'missing')).toBeNull()
    expect(familyJumpTarget([parent, child('c')], null)).toBeNull()
    expect(familyJumpTarget([parent, child('c')], undefined)).toBeNull()
  })

  it('goes nowhere from a parent whose children have all ended', () => {
    expect(familyJumpTarget([parent, child('a', { lastStatus: 'gone' }), child('b', { lastStatus: 'gone' })], 'parent')).toBeNull()
  })

  it('round-trips parent → child → parent → the same active child', () => {
    let sessions = [
      parent,
      child('a', { status: 'working', startedAt: '2026-10-05T09:00:00.000Z', lastFocusedAt: '2026-10-05T10:00:00.000Z' }),
      child('b', { status: 'working', startedAt: '2026-10-05T11:00:00.000Z' }),
    ]
    let clock = Date.parse('2026-10-05T12:00:00.000Z')
    const visit = (id: string) => {
      const at = new Date((clock += 60_000)).toISOString()
      sessions = sessions.map((s) => (s.id === id ? { ...s, lastFocusedAt: at } : s))
      return id
    }
    const jump = (from: string) => visit(familyJumpTarget(sessions, from)!.id)
    const first = jump(visit('parent'))
    expect(first).toBe('a') // won by lastFocusedAt over the later-started b
    expect(jump(first)).toBe('parent')
    expect(jump('parent')).toBe(first)
  })
})

describe('runProgress', () => {
  const withP = (done: number, total: number) => session('parent', { progress: { done, total } })
  it('names the current slice', () => {
    const p = runProgress(session('parent', { progress: { done: 2, total: 5, current: 3 } }), [])
    expect(p).toMatchObject({ current: 3, pct: 40, label: 'slice 3 of 5, 2 done' })
  })
  it('is null without progress', () => {
    expect(runProgress(parent, [child('a')])).toBeNull()
  })
  it('labels slices, and children done when any', () => {
    expect(runProgress(withP(4, 8), [child('a')])).toEqual({ done: 4, total: 8, kidsDone: 0, label: '4 of 8 slices done', pct: 50 })
    const kids = ['a', 'b', 'c'].map((id) => child(id, { workflowStatus: 'done' }))
    expect(runProgress(withP(4, 8), kids)?.label).toBe('4 of 8 slices done, 3 children done')
    expect(runProgress(withP(4, 8), kids.slice(0, 1))?.label).toBe('4 of 8 slices done, 1 child done')
  })
  it('clamps the percentage', () => {
    expect(runProgress(withP(9, 8), [])?.pct).toBe(100)
    expect(runProgress(withP(-1, 8), [])?.pct).toBe(0)
    expect(runProgress(withP(0, 0), [])?.pct).toBe(0)
  })
})

describe('barCounts', () => {
  const withP = (done: number, total: number) => session('parent', { progress: { done, total } })
  const many = (n: number, over: Partial<Session>, p = 'k') => Array.from({ length: n }, (_, i) => child(`${p}${i}`, over))
  it('counts a plan: 11 done, 1 running, 2 not started', () => {
    const kids = [...many(11, { workflowStatus: 'done' }, 'd'), child('r')]
    expect(barCounts(withP(11, 14), kids)).toMatchObject({ done: 11, run: 1, failed: 0, wait: 0, queued: 2, needsYou: 0, text: '11/14' })
    expect(barCounts(withP(11, 14), kids).label).toBe('11 of 14 slices done, 1 running, 2 not started')
  })
  it('reads slice N/M when a current slice is set', () => {
    const b = barCounts(session('parent', { progress: { done: 2, total: 5, current: 3 } }), [child('r')])
    expect(b.text).toBe('slice 3/5')
    expect(b.label).toBe('slice 3 of 5, 2 done, 1 running, 4 not started')
  })
  it('counts no plan: 24 children', () => {
    const kids = [...many(16, { workflowStatus: 'done' }, 'd'), ...many(7, {}, 'r'), child('f', { startup: { phase: 'failed', reason: 'x' } })]
    const b = barCounts(parent, kids)
    expect(b).toMatchObject({ done: 16, run: 7, failed: 1, wait: 0, queued: 0, text: '16 of 24' })
    expect(b.label).toBe('16 of 24 children done, 7 running, 1 failed')
  })
  it('counts a waiting child in wait and needsYou, not run', () => {
    const b = barCounts(parent, [child('w', { status: 'waiting', waitingFor: 'question' }), child('r')])
    expect(b).toMatchObject({ wait: 1, needsYou: 1, run: 1 })
    expect(b.label).toBe('0 of 2 children done, 1 running, 1 needs you')
  })
  it('counts a failed child as failed, not running', () => {
    const b = barCounts(parent, [child('f', { startup: { phase: 'failed', reason: 'x' } })])
    expect(b).toMatchObject({ failed: 1, run: 0 })
  })
  it('never goes below zero queued when kids exceed the plan', () => {
    expect(barCounts(withP(0, 1), [child('a'), child('b')]).queued).toBe(0)
  })
})

