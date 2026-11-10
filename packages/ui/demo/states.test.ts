import { describe, expect, it } from 'vitest'
import { tabStateOf } from '../sidebar-model.ts'
import { demoRows, isDemoStates } from './states.ts'

describe('isDemoStates', () => {
  it('is on only in development and for ?demo=states', () => {
    expect(isDemoStates({ search: '?demo=states' }, true)).toBe(true)
    expect(isDemoStates({ search: '?demo=states' }, false)).toBe(false)
    expect(isDemoStates({ search: '?demo=other' }, true)).toBe(false)
    expect(isDemoStates({ search: '' }, true)).toBe(false)
  })
})

describe('demoRows', () => {
  const rows = demoRows(0)

  // The state each tab shows, the same way main.ts works it out.
  const states = rows.tabs.map((tab) => {
    const agent = rows.agents.find((item) => item.tabId === tab.id)
    return tabStateOf({ exited: tab.exited, kind: tab.kind, state: agent?.state ?? null })
  })

  it('has four spaces with distinct ids, one of them a worktree, and two at one folder', () => {
    expect(rows.spaces).toHaveLength(4)
    expect(new Set(rows.spaces.map((space) => space.id)).size).toBe(4)
    expect(rows.spaces.filter((space) => space.parent !== null)).toHaveLength(1)
    const paths = rows.spaces.map((space) => space.path)
    expect(paths.length - new Set(paths).size).toBe(1)
  })

  it('points a worktree at its parent by id', () => {
    const worktree = rows.spaces.find((space) => space.parent !== null)
    expect(rows.spaces.some((space) => space.id === worktree?.parent)).toBe(true)
  })

  it('has a tab in each of the five states', () => {
    const live = states.filter((_, index) => !rows.tabs[index]?.exited)
    expect([...new Set(live)].sort()).toEqual(['finished', 'idle', 'needs-you', 'unknown', 'working'])
  })

  it('has a gone tab, and every tab sits in a space it names by id', () => {
    expect(rows.tabs.some((tab) => tab.exited)).toBe(true)
    const ids = new Set(rows.spaces.map((space) => space.id))
    expect(rows.tabs.every((tab) => ids.has(tab.spaceId))).toBe(true)
  })

  it('has agents only for agent tabs, and one of them resumable', () => {
    for (const agent of rows.agents) {
      const tab = rows.tabs.find((item) => item.id === agent.tabId)
      expect(tab?.kind).not.toBe('shell')
    }
    expect(rows.agents.some((agent) => agent.resumable)).toBe(true)
  })
})
