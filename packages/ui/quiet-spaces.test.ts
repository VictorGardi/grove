import { describe, expect, it } from 'vitest'
import type { AgentStateName } from '../protocol/messages.ts'
import { quietSpaces, RECENT_SPACES, spaceLatest, visitRank } from './quiet-spaces.ts'

const tab = (id: string, spaceId: string, state: AgentStateName = 'idle') => ({ id, spaceId, state })

describe('visit rank', () => {
  it('is 0 for the latest, and past the end for a tab never visited', () => {
    expect(visitRank(['a', 'b'], 'a')).toBe(0)
    expect(visitRank(['a', 'b'], 'b')).toBe(1)
    expect(visitRank(['a', 'b'], 'z')).toBe(2)
  })

  it('is a space’s most recently visited tab, or past the end with none visited', () => {
    expect(spaceLatest(['a', 'b', 'c'], ['c', 'b'])).toBe(1)
    expect(spaceLatest(['a'], ['x', 'y'])).toBe(1)
    expect(spaceLatest(['a'], [])).toBe(1)
  })
})

const flat = (ids: string[]) => ids.map((id) => ({ id, parent: null }))

describe('quietSpaces', () => {
  const names = ['cur', ...Array.from({ length: RECENT_SPACES + 2 }, (_, i) => `s${i}`)]
  const tabs = names.map((name) => tab(`${name}-1`, name))
  const recent = names.map((name) => `${name}-1`)
  const base = { spaces: flat(names), tabs, recent, activeSpaceId: 'cur' }

  it('folds the idle spaces past the most recently visited ones, never the current one', () => {
    const { ids } = quietSpaces(base)
    expect([...ids]).toEqual([`s${RECENT_SPACES}`, `s${RECENT_SPACES + 1}`])
  })

  it('names the quiet space visited most recently', () => {
    expect(quietSpaces(base).last).toBe(`s${RECENT_SPACES}`)
  })

  it('never folds a space with something busy in it, however old', () => {
    const busy = tabs.map((entry) => (entry.spaceId === 's6' ? { ...entry, state: 'needs-you' as const } : entry))
    expect([...quietSpaces({ ...base, tabs: busy }).ids]).toEqual([`s${RECENT_SPACES}`])
  })

  it('folds a space that was never visited, and names no last one when none was', () => {
    const result = quietSpaces({ spaces: flat(['a', 'b']), tabs: [tab('a1', 'a'), tab('b1', 'b')], recent: [], activeSpaceId: 'a' })
    expect([...result.ids]).toEqual(['b'])
    expect(result.last).toBeNull()
  })

  it('does not count the current space among the recent ones', () => {
    const result = quietSpaces({ ...base, recent: recent.slice(1), activeSpaceId: 'cur' })
    expect(result.ids.has(`s${RECENT_SPACES - 1}`)).toBe(false)
    expect(result.ids.has(`s${RECENT_SPACES}`)).toBe(true)
  })

  describe('worktrees of the current space', () => {
    // cur has a worktree w1 that is idle and never visited; s0..s6 follow cur in recency.
    const spaces = [...flat(names), { id: 'w1', parent: 'cur' }, { id: 'other-wt', parent: 's6' }]
    const all = [...tabs, tab('w1-1', 'w1'), tab('other-wt-1', 'other-wt')]

    it('are never quiet, even idle and never visited', () => {
      const { ids } = quietSpaces({ ...base, spaces, tabs: all })
      expect(ids.has('w1')).toBe(false)
      expect(ids.has('other-wt')).toBe(true)
    })

    it('take no place among the recent ones, so another space is not pushed out', () => {
      const visited = ['w1-1', ...recent]
      const { ids } = quietSpaces({ ...base, spaces, tabs: all, recent: visited })
      expect(ids.has(`s${RECENT_SPACES - 1}`)).toBe(false)
      expect(ids.has(`s${RECENT_SPACES}`)).toBe(true)
    })

    it('is not the rule the other way round: the repo of a current worktree can still be quiet', () => {
      const { ids } = quietSpaces({ spaces: [{ id: 'repo', parent: null }, { id: 'wt', parent: 'repo' }], tabs: [tab('r1', 'repo'), tab('w1', 'wt')], recent: [], activeSpaceId: 'wt' })
      expect(ids.has('repo')).toBe(true)
    })
  })
})
