import { describe, expect, it } from 'vitest'
import type { AgentInfo, AgentStateName } from '../protocol/messages.ts'
import { groupAgents, shortFolder, sidebarSpaceOrder, spaceAt, tabStateOf, tileIndex } from './sidebar-model.ts'

function agent(state: AgentStateName, since: number): AgentInfo {
  return { tabId: 't', agent: 'claude', state, since, source: 'hook', resumable: false }
}

describe('tabStateOf', () => {
  it('gives idle for a gone tab, whatever state it holds', () => {
    expect(tabStateOf({ exited: true, kind: 'claude', state: 'needs-you' })).toBe('idle')
    expect(tabStateOf({ exited: true, kind: 'shell', state: 'working' })).toBe('idle')
  })

  it('gives idle for a shell with no agent watched', () => {
    expect(tabStateOf({ exited: false, kind: 'shell', state: null })).toBe('idle')
  })

  it('gives the state of an agent typed into a shell tab, as of a launched one', () => {
    expect(tabStateOf({ exited: false, kind: 'shell', state: 'working' })).toBe('working')
    expect(tabStateOf({ exited: false, kind: 'shell', state: 'needs-you' })).toBe('needs-you')
  })

  it('gives unknown for an agent tab with no state yet', () => {
    expect(tabStateOf({ exited: false, kind: 'opencode', state: null })).toBe('unknown')
  })

  it('gives the agent state otherwise', () => {
    expect(tabStateOf({ exited: false, kind: 'copilot', state: 'finished' })).toBe('finished')
  })
})

describe('groupAgents', () => {
  const row = (spaceId: string, state: AgentStateName, since: number, tabNumber = 1) => ({
    spaceId,
    tabNumber,
    agent: agent(state, since),
    exited: false,
  })

  it('sorts a gone row as idle, whatever its last stored state was', () => {
    const gone = { ...row('/a', 'needs-you', 1, 1), exited: true }
    const [group] = groupAgents(['/a'], [gone, row('/a', 'working', 9, 2)])
    expect(group.rows.map((item) => item.tabNumber)).toEqual([2, 1])
  })

  it('keeps the space order and leaves out spaces with no agents', () => {
    const groups = groupAgents(['/a', '/b', '/c'], [row('/c', 'idle', 1), row('/a', 'working', 2)])
    expect(groups.map((group) => group.spaceId)).toEqual(['/a', '/c'])
  })

  it('groups by space id, so two spaces at one folder get their own groups', () => {
    const groups = groupAgents(['first', 'second'], [row('second', 'idle', 1), row('first', 'working', 2)])
    expect(groups.map((group) => group.spaceId)).toEqual(['first', 'second'])
    expect(groups.map((group) => group.rows.length)).toEqual([1, 1])
  })

  it('orders each group by urgency, then by the longest wait', () => {
    const rows = [
      row('/a', 'idle', 1, 1),
      row('/a', 'needs-you', 50, 2),
      row('/a', 'working', 5, 3),
      row('/a', 'needs-you', 10, 4),
      row('/a', 'unknown', 0, 5),
    ]
    const [group] = groupAgents(['/a'], rows)
    expect(group?.rows.map((item) => item.tabNumber)).toEqual([4, 2, 3, 5, 1])
  })

  it('puts the finished rows after working and before unknown', () => {
    const rows = [row('/a', 'unknown', 1, 1), row('/a', 'finished', 9, 2), row('/a', 'working', 9, 3)]
    const [group] = groupAgents(['/a'], rows)
    expect(group?.rows.map((item) => item.tabNumber)).toEqual([3, 2, 1])
  })
})

describe('tileIndex', () => {
  it('gives a number from 1 to 8', () => {
    for (const name of ['grove', 'notes', 'a', '', 'a long folder name with spaces']) {
      const index = tileIndex(name)
      expect(index).toBeGreaterThanOrEqual(1)
      expect(index).toBeLessThanOrEqual(8)
    }
  })

  it('is stable for the same name', () => {
    expect(tileIndex('grove')).toBe(tileIndex('grove'))
  })
})

describe('shortFolder', () => {
  it('shows the home folder as ~ and the folders under it from ~', () => {
    expect(shortFolder('/Users/victor', '/Users/victor')).toBe('~')
    expect(shortFolder('/Users/victor/git/grove', '/Users/victor')).toBe('~/git/grove')
  })

  it('shows other paths in full, and not a folder that only starts the same way', () => {
    expect(shortFolder('/Users/victor2/git', '/Users/victor')).toBe('/Users/victor2/git')
    expect(shortFolder('/srv/app', '/Users/victor')).toBe('/srv/app')
  })

  it('leaves the path alone when there is no home folder', () => {
    expect(shortFolder('/srv/app', '')).toBe('/srv/app')
  })
})

describe('sidebarSpaceOrder', () => {
  it('lists each top-level space, then its worktrees, as the sidebar draws them', () => {
    const spaces = [
      { id: 'a', parent: null },
      { id: 'a-wt', parent: 'a' },
      { id: 'c', parent: null },
      { id: 'd', parent: null },
      { id: 'd-wt', parent: 'd' },
    ]
    expect(sidebarSpaceOrder(spaces)).toEqual(['a', 'a-wt', 'c', 'd', 'd-wt'])
  })
  it('lists a worktree whose repo is missing as top-level', () => {
    expect(sidebarSpaceOrder([{ id: 'x', parent: 'gone' }])).toEqual(['x'])
  })
  it('is empty for no spaces', () => {
    expect(sidebarSpaceOrder([])).toEqual([])
  })
})

describe('spaceAt', () => {
  it('counts places from 1 and is null past the last space', () => {
    const order = ['a', 'a-wt', 'c']
    expect(spaceAt(order, 1)).toBe('a')
    expect(spaceAt(order, 3)).toBe('c')
    expect(spaceAt(order, 4)).toBeNull()
    expect(spaceAt(order, 0)).toBeNull()
    expect(spaceAt([], 1)).toBeNull()
  })
})
