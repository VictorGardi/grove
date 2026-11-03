import { describe, expect, it } from 'vitest'
import type { Session } from '@shared/types'
import { DOT_TONE, drawerState, toggledDrawer, filterDrawer, orderDrawer, STATE_WORD, tabCounts } from './childDrawer'

const kid = (id: string, over: Partial<Session> = {}): Session =>
  ({ id, projectId: 'p', kind: 'claude', label: id, lastStatus: 'running', startedAt: '2026-10-05T10:00:00.000Z', link: { id: 'parent', kind: 'group' }, ...over } as Session)
const at = (h: number) => `2026-10-05T${String(h).padStart(2, '0')}:00:00.000Z`
const ids = (xs: Session[]) => xs.map((x) => x.id)

const done = kid('done', { workflowStatus: 'done', startedAt: at(9) })
const needs = kid('needs', { status: 'waiting', waitingFor: 'question', startedAt: at(9) })
const failed = kid('failed', { startup: { phase: 'failed', reason: 'boom' }, startedAt: at(9) })
const running = kid('running', { status: 'working', startedAt: at(9) })

describe('drawerState', () => {
  it('classifies with done first, then needs, failed, running', () => {
    expect(drawerState(done)).toBe('done')
    expect(drawerState(needs)).toBe('needs')
    expect(drawerState(failed)).toBe('failed')
    expect(drawerState(running)).toBe('running')
    expect(drawerState({ ...needs, workflowStatus: 'done' })).toBe('done')
  })
  it('has a word for each state', () => {
    expect(STATE_WORD).toEqual({ needs: 'needs you', failed: 'failed', running: 'running', done: 'done' })
  })
})

describe('orderDrawer', () => {
  it('orders needs, failed, running, done', () => {
    expect(ids(orderDrawer([done, running, failed, needs]))).toEqual(['needs', 'failed', 'running', 'done'])
  })
  it('puts the newest first inside a state, and does not mutate', () => {
    const input = [kid('old', { startedAt: at(8) }), kid('new', { startedAt: at(11) }), kid('mid', { startedAt: at(10) })]
    const copy = [...input]
    expect(ids(orderDrawer(input))).toEqual(['new', 'mid', 'old'])
    expect(input).toEqual(copy)
  })
})

describe('tabCounts', () => {
  it('counts running with failed', () => {
    expect(tabCounts([done, needs, failed, running, kid('r2')])).toEqual({ all: 5, needs: 1, running: 3, done: 1 })
  })
})

describe('filterDrawer', () => {
  const all = [done, needs, failed, running]
  it('filters by tab', () => {
    expect(ids(filterDrawer(all, 'all', ''))).toEqual(['needs', 'failed', 'running', 'done'])
    expect(ids(filterDrawer(all, 'needs', ''))).toEqual(['needs'])
    expect(ids(filterDrawer(all, 'running', ''))).toEqual(['failed', 'running'])
    expect(ids(filterDrawer(all, 'done', ''))).toEqual(['done'])
  })
  it('filters by trimmed, case-insensitive label substring, then the tab', () => {
    const k = [kid('a', { label: 'Fix Login' }), kid('b', { label: 'login page', workflowStatus: 'done' }), kid('c', { label: 'other' })]
    expect(ids(filterDrawer(k, 'all', '  LOGIN '))).toEqual(['a', 'b'])
    expect(ids(filterDrawer(k, 'done', 'login'))).toEqual(['b'])
    expect(filterDrawer(k, 'all', 'zzz')).toEqual([])
  })
})

describe('toggledDrawer', () => {
  it('opens for the parent, closes on the same trigger, and switches to another parent', () => {
    expect(toggledDrawer(null, 'a')).toBe('a')
    expect(toggledDrawer('a', 'a')).toBeNull()
    expect(toggledDrawer('a', 'b')).toBe('b')
  })
})

describe('a hand-set workflow status', () => {
  it('moves a child to the Done tab and back at once, whatever the live pane says', () => {
    const before = [running, needs]
    expect(tabCounts(before)).toMatchObject({ all: 2, done: 0 })
    const set = before.map((k) => (k.id === 'running' ? { ...k, workflowStatus: 'done' as const } : k))
    expect(tabCounts(set)).toMatchObject({ all: 2, needs: 1, running: 0, done: 1 })
    expect(ids(filterDrawer(set, 'done', ''))).toEqual(['running'])
    const back = set.map((k) => ({ ...k, workflowStatus: 'in-progress' as const }))
    expect(tabCounts(back).done).toBe(0)
  })
  it('colours the dot by state, so a done child is green and not the pane colour', () => {
    expect(DOT_TONE[drawerState({ ...running, lastStatus: 'running', workflowStatus: 'done' })]).toBe('working')
    expect(DOT_TONE).toEqual({ done: 'working', running: 'finished', needs: 'waiting', failed: 'failed' })
  })
})
