import { describe, expect, it } from 'vitest'
import type { AgentInfo, AgentStateName, ContextUsage } from '../protocol/messages.ts'
import { formatContext, groupAgents, jumpTargets, nextUrgent, shortFolder, sidebarSpaceOrder, spaceAt, tabStateOf, tileIndex, urgentTabs } from './sidebar-model.ts'

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

describe('urgentTabs and nextUrgent', () => {
  const tab = (id: string, state: AgentStateName, since: number) => ({ id, state, since })

  it('keeps only needs-you and finished tabs: needs-you first, then the longest waiting', () => {
    const tabs = [tab('a', 'finished', 1), tab('b', 'working', 0), tab('c', 'needs-you', 9), tab('d', 'needs-you', 5), tab('e', 'idle', 0), tab('f', 'unknown', 0)]
    expect(urgentTabs(tabs).map((item) => item.id)).toEqual(['d', 'c', 'a'])
  })

  it('has no urgent tab when none waits', () => {
    expect(urgentTabs([tab('a', 'working', 1), tab('b', 'idle', 2)])).toEqual([])
  })

  it('goes to the first when the active tab is not urgent, or there is none active', () => {
    const urgent = urgentTabs([tab('a', 'needs-you', 1), tab('b', 'finished', 2)])
    expect(nextUrgent(urgent, 'x')?.id).toBe('a')
    expect(nextUrgent(urgent, null)?.id).toBe('a')
  })

  it('goes to the one after the active tab, and wraps round', () => {
    const urgent = urgentTabs([tab('a', 'needs-you', 1), tab('b', 'needs-you', 2), tab('c', 'finished', 3)])
    expect(nextUrgent(urgent, 'a')?.id).toBe('b')
    expect(nextUrgent(urgent, 'b')?.id).toBe('c')
    expect(nextUrgent(urgent, 'c')?.id).toBe('a')
  })

  it('goes nowhere when nothing is urgent, or the active tab is the only one', () => {
    expect(nextUrgent([], 'a')).toBeNull()
    expect(nextUrgent(urgentTabs([tab('a', 'needs-you', 1)]), 'a')).toBeNull()
  })
})

describe('jumpTargets', () => {
  const tab = (id: string, state: AgentStateName, since: number) => ({ id, state, since })

  it('is the urgent tabs while any exist, and leaves working ones out', () => {
    expect(jumpTargets([tab('a', 'working', 1), tab('b', 'finished', 2), tab('c', 'needs-you', 3)]).map((item) => item.id)).toEqual(['c', 'b'])
  })

  it('falls back to the working tabs, the longest running first, when none is urgent', () => {
    const tabs = [tab('a', 'working', 9), tab('b', 'idle', 0), tab('c', 'working', 4), tab('d', 'unknown', 0)]
    expect(jumpTargets(tabs).map((item) => item.id)).toEqual(['c', 'a'])
  })

  it('is empty when nothing is urgent or working', () => {
    expect(jumpTargets([tab('a', 'idle', 1), tab('b', 'unknown', 2)])).toEqual([])
  })
})

describe('formatContext', () => {
  const usage = (tokens: number | null, window: number | null, percent: number | null = null): ContextUsage => ({
    tokens,
    window,
    percent,
    model: null,
    at: 0,
  })

  it('gives no label without a reading', () => {
    expect(formatContext(undefined)).toBeNull()
    expect(formatContext(usage(null, 200_000))).toBeNull()
    expect(formatContext(usage(0, 200_000))).toBeNull()
  })

  it('spells out the exact numbers in the title', () => {
    const label = formatContext({ ...usage(45_123, 200_000, 23), model: 'opus' })
    expect(label?.title).toBe('Context: 45,123 of 200,000 tokens (23%), opus')
    expect(formatContext(usage(50_000, 200_000))?.title).toBe('Context: 50,000 of 200,000 tokens (25%)')
    expect(formatContext(usage(50_000, null))?.title).toBe('Context: 50,000 tokens')
  })

  it('keeps two sessions apart', () => {
    expect(formatContext(usage(10_000, 200_000))?.title).not.toBe(formatContext(usage(90_000, 200_000))?.title)
  })

  it('labels a Copilot row a last request against the prompt budget, never a context window', () => {
    // Epoch ms for a local 21:10, so the time in the title is the same whatever machine runs the test.
    const at = new Date(2026, 10, 7, 21, 10).getTime()
    const label = formatContext({ tokens: 101_079, window: 272_000, percent: null, model: 'gpt-6-luna', at }, 'copilot')
    expect(label?.title).toBe('Last request: 101,079 of 272,000 prompt tokens (37%), gpt-6-luna, 21:10')
    expect(label?.title?.toLowerCase()).not.toContain('context window')
  })

  it('shows Copilot tokens alone when the record has no prompt budget', () => {
    const at = new Date(2026, 10, 7, 21, 10).getTime()
    const label = formatContext({ tokens: 101_079, window: null, percent: null, model: 'gpt-6-luna', at }, 'copilot')
    expect(label?.title).toBe('Last request: 101,079 prompt tokens, gpt-6-luna, 21:10')
  })

  it('labels an OpenCode row a last request against the model limit, with the completion time', () => {
    const at = new Date(2026, 10, 7, 21, 15).getTime()
    const label = formatContext({ tokens: 38_793, window: 400_000, percent: null, model: 'gpt-5.2-codex', at }, 'opencode')
    expect(label?.title).toBe('Last request: 38,793 of 400,000 model-limit tokens (10%), gpt-5.2-codex, 21:15')
    expect(label?.title).toContain('model-limit')
    expect(label?.title?.toLowerCase()).not.toContain('context window')
  })

  it('does not render an OpenCode row without the complete token/window pair', () => {
    const at = new Date(2026, 10, 7, 21, 15).getTime()
    expect(formatContext({ tokens: 38_793, window: null, percent: null, model: 'gpt-5.2-codex', at }, 'opencode')).toBeNull()
    expect(formatContext({ tokens: 38_793, window: 0, percent: null, model: 'gpt-5.2-codex', at }, 'opencode')).toBeNull()
    expect(formatContext({ tokens: null, window: 400_000, percent: null, model: 'gpt-5.2-codex', at }, 'opencode')).toBeNull()
    expect(formatContext(undefined, 'opencode')).toBeNull()
  })

  it('does not turn a Claude reading into a last request', () => {
    const at = new Date(2026, 10, 7, 21, 10).getTime()
    expect(formatContext(usage(50_000, 200_000), 'claude')?.title).toBe('Context: 50,000 of 200,000 tokens (25%)')
    expect(formatContext({ ...usage(50_000, 200_000), at }, 'claude')?.title).not.toContain('21:10')
  })
})
