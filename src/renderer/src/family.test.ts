import { describe, expect, it } from 'vitest'
import type { Session } from '@shared/types'
import { childrenCount, familyOf } from './family'

const session = (id: string, over: Partial<Session> = {}): Session =>
  ({ id, projectId: 'p', kind: 'claude', label: id, lastStatus: 'running', startedAt: '2026-10-05T10:00:00.000Z', ...over } as Session)

const parent = session('parent')
const child = (id: string, over: Partial<Session> = {}) => session(id, { parentId: 'parent', ...over })
const ids = (xs: Session[]) => xs.map((x) => x.id)

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

  it('ranks a finished (waiting · done) child over a working one', () => {
    const f = familyOf([parent, child('working', { status: 'working' }), child('done', { status: 'waiting', waitingFor: 'done' })], 'parent')
    expect(f.active?.id).toBe('done')
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
