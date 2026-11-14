import { describe, expect, it, vi } from 'vitest'
import type { AgentInfo, SpaceInfo, SpaceTabInfo, StatusChange } from '../protocol/messages.ts'
import { createWindowStore, kindOf } from './window-store.ts'

function space(id: string, parent: string | null = null): SpaceInfo {
  return { id, path: `/work/${id}`, name: id, label: null, repoName: null, parent, worktree: parent !== null, branch: null }
}

function wire(id: string, spaceId: string, overrides: Partial<SpaceTabInfo> = {}): SpaceTabInfo {
  return { id, spaceId, spacePath: `/work/${spaceId}`, kind: 'terminal', label: null, alive: true, exitCode: null, ...overrides }
}

function change(tabId: string, agent: StatusChange['agent'], state: StatusChange['state'], since = 1): StatusChange {
  return { tabId, agent, state, since, source: agent }
}

function entry(tabId: string, agent: AgentInfo['agent'], overrides: Partial<AgentInfo> = {}): AgentInfo {
  return { tabId, agent, state: 'idle', since: 1, source: agent, resumable: false, ...overrides }
}

// A store with spaces a and b; a holds tabs a1 a2 a3, b holds b1.
function window() {
  const changed = vi.fn()
  const store = createWindowStore({ changed })
  store.upsertSpace(space('a'))
  store.upsertSpace(space('b'))
  for (const id of ['a1', 'a2', 'a3']) store.addTab(wire(id, 'a'))
  store.addTab(wire('b1', 'b'))
  changed.mockClear()
  return { store, changed }
}

describe('the kind of a core tab record', () => {
  it('maps the core terminal kind to shell and keeps an agent kind', () => {
    expect(kindOf({ kind: 'terminal' })).toBe('shell')
    expect(kindOf({ kind: 'claude' })).toBe('claude')
    expect(kindOf({ kind: 'copilot' })).toBe('copilot')
  })
})

describe('adding a tab', () => {
  it('is idempotent by id, so a tab opened before the open reply is not doubled', () => {
    const { store } = window()
    store.addTab(wire('a2', 'a'))
    expect(store.tabsOfSpace('a').map((tab) => tab.id)).toEqual(['a1', 'a2', 'a3'])
  })

  it('takes the kind and label of a record that arrives for a tab it already holds', () => {
    const { store } = window()
    store.addTab(wire('a1', 'a', { kind: 'claude', label: 'main' }))
    expect(store.tab('a1')).toMatchObject({ kind: 'claude', label: 'main' })
  })

  it('applies the one kind mapping', () => {
    const { store } = window()
    store.addTab(wire('a4', 'a', { kind: 'opencode' }))
    expect(store.tab('a4')?.kind).toBe('opencode')
    expect(store.tab('a3')?.kind).toBe('shell')
  })

  it('notifies once, synchronously, and not at all for an unknown id lookup', () => {
    const { store, changed } = window()
    store.addTab(wire('b2', 'b'))
    expect(changed).toHaveBeenCalledTimes(1)
    store.tab('nope')
    expect(changed).toHaveBeenCalledTimes(1)
  })
})

describe('tab numbers', () => {
  it('are the position among the space’s tabs', () => {
    const { store } = window()
    expect(store.tabsOfSpace('a').map((tab) => tab.number)).toEqual([1, 2, 3])
    expect(store.tab('b1')?.number).toBe(1)
  })

  it('renumber when an earlier tab closes', () => {
    const { store } = window()
    store.removeTab('a1')
    expect(store.tab('a2')?.number).toBe(1)
    expect(store.tab('a3')?.number).toBe(2)
    expect(store.tab('b1')?.number).toBe(1)
  })

  it('name an unnamed tab "Tab N" position and a named tab by its name', () => {
    const { store } = window()
    store.renameTab('a2', 'build')
    expect(store.tabName('a2')).toBe('build')
    expect(store.tabName('a3')).toBe('3')
    store.renameTab('a2', null)
    expect(store.tabName('a2')).toBe('2')
  })
})

describe('the Active tab and Active space', () => {
  it('activating a tab in another space switches the Active space', () => {
    const { store } = window()
    store.activateTab('b1')
    expect(store.activeTab?.id).toBe('b1')
    expect(store.activeSpace).toBe('b')
  })

  it('selecting a space shows its most recently visited tab', () => {
    const { store } = window()
    store.activateTab('a2')
    store.activateTab('b1')
    store.selectSpace('a')
    expect(store.activeTab?.id).toBe('a2')
  })

  it('selecting a space with no recent tab shows its first tab', () => {
    const { store } = window()
    store.selectSpace('a')
    expect(store.activeTab?.id).toBe('a1')
  })

  it('selecting a space with no tabs shows nothing', () => {
    const { store } = window()
    store.upsertSpace(space('empty'))
    store.selectSpace('empty')
    expect(store.activeSpace).toBe('empty')
    expect(store.activeTab).toBeNull()
  })

  it('selecting a space with a chosen tab shows that tab', () => {
    const { store } = window()
    store.activateTab('a1')
    store.selectSpace('a', 'a3')
    expect(store.activeTab?.id).toBe('a3')
  })
})

describe('Recent order', () => {
  it('lists a space’s tabs most recently shown first, by id', () => {
    const { store } = window()
    store.activateTab('a1')
    store.activateTab('a3')
    store.activateTab('b1')
    store.activateTab('a1')
    expect(store.recent('a')).toEqual(['a1', 'a3'])
    expect(store.recent('b')).toEqual(['b1'])
  })

  it('lists every tab of the window most recently shown first', () => {
    const { store } = window()
    store.activateTab('a1')
    store.activateTab('b1')
    store.activateTab('a2')
    expect(store.recentIds).toEqual(['a2', 'b1', 'a1'])
  })

  it('records a tab shown by selecting its space', () => {
    const { store } = window()
    store.selectSpace('b')
    expect(store.recentIds).toEqual(['b1'])
  })
})

describe('removing a tab', () => {
  it('shows the space’s next tab when the Active tab closes', () => {
    const { store } = window()
    store.activateTab('a2')
    store.activateTab('a3')
    store.removeTab('a3')
    expect(store.activeTab?.id).toBe('a2')
  })

  it('falls back to the first tab of the space when nothing recent is left', () => {
    const { store } = window()
    store.activateTab('a3')
    store.removeTab('a3')
    store.removeTab('a1')
    expect(store.activeTab?.id).toBe('a2')
  })

  it('leaves the Active tab alone when another tab closes', () => {
    const { store } = window()
    store.activateTab('a2')
    store.removeTab('a3')
    expect(store.activeTab?.id).toBe('a2')
  })

  it('shows nothing when the last tab of the space closes, and keeps the space', () => {
    const { store } = window()
    store.activateTab('b1')
    store.removeTab('b1')
    expect(store.activeTab).toBeNull()
    expect(store.activeSpace).toBe('b')
    expect(store.space('b')).toBeDefined()
  })

  it('removes the tab’s agent row and Recent order entries', () => {
    const { store } = window()
    store.activateTab('a2')
    store.applyStatusChange(change('a2', 'claude', 'working'))
    store.removeTab('a2')
    expect(store.agent('a2')).toBeUndefined()
    expect(store.recent('a')).not.toContain('a2')
    expect(store.recentIds).not.toContain('a2')
  })

  it('ignores an id it does not hold', () => {
    const { store, changed } = window()
    store.removeTab('ghost')
    expect(store.tabs).toHaveLength(4)
    expect(changed).not.toHaveBeenCalled()
  })
})

describe('dropping a space', () => {
  it('removes its tabs, agent rows and Recent order', () => {
    const { store } = window()
    store.activateTab('a1')
    store.applyStatusChange(change('a1', 'claude', 'working'))
    store.dropSpace('a')
    expect(store.space('a')).toBeUndefined()
    expect(store.tabs.map((tab) => tab.id)).toEqual(['b1'])
    expect(store.agent('a1')).toBeUndefined()
    expect(store.recent('a')).toEqual([])
    expect(store.recentIds).not.toContain('a1')
  })

  it('selects the first space in the sidebar order when it was the Active space', () => {
    const { store } = window()
    store.upsertSpace(space('wt', 'b'))
    store.activateTab('a1')
    store.dropSpace('a')
    expect(store.activeSpace).toBe('b')
    expect(store.activeTab?.id).toBe('b1')
  })

  it('leaves the selection alone when another space is dropped', () => {
    const { store } = window()
    store.activateTab('a2')
    store.dropSpace('b')
    expect(store.activeSpace).toBe('a')
    expect(store.activeTab?.id).toBe('a2')
  })

  it('selects no space when the last one is dropped', () => {
    const { store } = window()
    store.dropSpace('b')
    store.dropSpace('a')
    expect(store.activeSpace).toBeNull()
    expect(store.activeTab).toBeNull()
  })

  it('does nothing for a space it does not hold', () => {
    const { store } = window()
    store.dropSpace('ghost')
    expect(store.tabs).toHaveLength(4)
  })
})

describe('spaces added or changed elsewhere', () => {
  it('upserting replaces a space with the same id', () => {
    const { store } = window()
    store.upsertSpace({ ...space('a'), name: 'renamed' })
    expect(store.spaces().filter((s) => s.id === 'a')).toHaveLength(1)
    expect(store.space('a')?.name).toBe('renamed')
  })
})

describe('marking exited and alive', () => {
  it('marks a tab exited once and says whether it changed', () => {
    const { store } = window()
    expect(store.markExited('a1')).toBe(true)
    expect(store.tab('a1')?.exited).toBe(true)
    expect(store.markExited('a1')).toBe(false)
  })

  it('shows an Exited tab as idle whatever its agent last said', () => {
    const { store } = window()
    store.applyStatusChange(change('a1', 'claude', 'working'))
    expect(store.stateOf('a1')).toBe('working')
    store.markExited('a1')
    expect(store.stateOf('a1')).toBe('idle')
  })

  it('stops being an Exited tab once it is marked alive', () => {
    const { store } = window()
    store.markExited('a1')
    expect(store.markAlive('a1')).toBe(true)
    expect(store.tab('a1')?.exited).toBe(false)
    expect(store.markAlive('a1')).toBe(false)
  })

  it('ignores an id it does not hold', () => {
    const { store } = window()
    expect(store.markExited('ghost')).toBe(false)
    expect(store.markAlive('ghost')).toBe(false)
  })
})

describe('kind detection', () => {
  it('turns a shell tab into an agent tab when an agent runs in it', () => {
    const { store } = window()
    store.setAgents([entry('a1', 'claude')])
    expect(store.tab('a1')?.kind).toBe('claude')
  })

  it('turns a detected tab back into a shell when the agent ends', () => {
    const { store } = window()
    store.setAgents([entry('a1', 'claude')])
    store.setAgents([])
    expect(store.tab('a1')?.kind).toBe('shell')
  })

  it('keeps the kind of a launched agent tab after its agent ends', () => {
    const { store } = window()
    store.addTab(wire('a4', 'a', { kind: 'opencode' }))
    store.setAgents([entry('a4', 'opencode')])
    store.setAgents([])
    expect(store.tab('a4')?.kind).toBe('opencode')
  })

  it('detects from a status change too', () => {
    const { store } = window()
    store.applyStatusChange(change('a2', 'copilot', 'working'))
    expect(store.tab('a2')?.kind).toBe('copilot')
  })

  it('keeps a detected kind when the core sends the tab again as a terminal', () => {
    const { store } = window()
    store.setAgents([entry('a1', 'claude')])
    store.addTab(wire('a1', 'a', { kind: 'terminal' }))
    expect(store.tab('a1')?.kind).toBe('claude')
  })

  it('shows a live agent tab with no report as unknown, and a shell as idle', () => {
    const { store } = window()
    store.addTab(wire('a4', 'a', { kind: 'claude' }))
    expect(store.stateOf('a4')).toBe('unknown')
    expect(store.stateOf('a3')).toBe('idle')
  })
})

describe('applying a status change', () => {
  it('returns the previous entry and stores the new state', () => {
    const { store } = window()
    expect(store.applyStatusChange(change('a1', 'claude', 'working')).previous).toBeUndefined()
    const { previous } = store.applyStatusChange(change('a1', 'claude', 'idle'))
    expect(previous?.state).toBe('working')
    expect(store.agent('a1')?.state).toBe('idle')
  })

  it('keeps resumable and the context reading from the previous entry', () => {
    const { store } = window()
    const context = { tokens: 1000, window: 200000, percent: 1, model: null, at: 5 }
    store.setAgents([entry('a1', 'claude', { resumable: true, context })])
    store.applyStatusChange(change('a1', 'claude', 'working'))
    expect(store.agent('a1')).toMatchObject({ state: 'working', resumable: true, context })
  })

  it('starts a new entry not resumable and without context', () => {
    const { store } = window()
    store.applyStatusChange(change('a1', 'claude', 'working'))
    expect(store.agent('a1')?.resumable).toBe(false)
    expect(store.agent('a1')?.context).toBeUndefined()
  })

  it('carries the reason of the change and drops the previous one', () => {
    const { store } = window()
    store.applyStatusChange({ ...change('a1', 'claude', 'needs-you'), reason: 'permission' })
    expect(store.agent('a1')?.reason).toBe('permission')
    store.applyStatusChange(change('a1', 'claude', 'working'))
    expect(store.agent('a1')?.reason).toBeUndefined()
  })
})

describe('applying a context reading', () => {
  const context = { tokens: 10, window: 100, percent: 10, model: null, at: 1 }

  it('updates the agent’s entry', () => {
    const { store } = window()
    store.applyStatusChange(change('a1', 'claude', 'working'))
    store.applyContext('a1', context)
    expect(store.agent('a1')?.context).toEqual(context)
  })

  it('is ignored for a tab with no agent entry, creating no row', () => {
    const { store, changed } = window()
    store.applyContext('a1', context)
    expect(store.agent('a1')).toBeUndefined()
    expect(store.agents()).toEqual([])
    expect(changed).not.toHaveBeenCalled()
  })
})

describe('setting the agents', () => {
  it('replaces the list', () => {
    const { store } = window()
    store.setAgents([entry('a1', 'claude'), entry('a2', 'copilot')])
    store.setAgents([entry('a2', 'copilot')])
    expect(store.agents().map((agent) => agent.tabId)).toEqual(['a2'])
  })
})

describe('urgent tabs', () => {
  it('are the tabs that need the human or finished, as the tabs show them', () => {
    const { store } = window()
    store.applyStatusChange(change('a1', 'claude', 'needs-you', 5))
    store.applyStatusChange(change('a2', 'claude', 'finished', 2))
    store.applyStatusChange(change('a3', 'claude', 'working'))
    store.markExited('a2')
    expect(store.urgent().map((item) => item.id)).toEqual(['a1'])
  })
})

describe('the refused state', () => {
  it('holds the reason the core refused its state file', () => {
    const { store, changed } = window()
    expect(store.refused).toBeNull()
    store.setRefused('bad json')
    expect(store.refused).toBe('bad json')
    expect(changed).toHaveBeenCalledTimes(1)
  })
})

describe('the grid membership of a tab', () => {
  it('is set per tab and listed in tab order', () => {
    const { store } = window()
    store.setInGrid('a3', true)
    store.setInGrid('a1', true)
    expect(store.gridTabs().map((tab) => tab.id)).toEqual(['a1', 'a3'])
    store.setInGrid('a1', false)
    expect(store.gridTabs().map((tab) => tab.id)).toEqual(['a3'])
  })

  it('can be set for a whole list at once, dropping ids the store does not hold', () => {
    const { store } = window()
    store.setGridTabs(['b1', 'ghost', 'a2'])
    expect(store.gridTabs().map((tab) => tab.id)).toEqual(['a2', 'b1'])
  })
})

describe('selecting while the grid shows', () => {
  it('prefers a grid pane of the space, also when the Active tab closes', () => {
    const changed = vi.fn()
    let gridOn = false
    const store = createWindowStore({
      changed,
      gridPane: (spaceId) => (gridOn ? store.gridTabs().find((tab) => tab.spaceId === spaceId)?.id : undefined),
    })
    store.upsertSpace(space('a'))
    for (const id of ['a1', 'a2', 'a3']) store.addTab(wire(id, 'a'))
    store.setInGrid('a3', true)
    gridOn = true
    store.activateTab('a1')
    store.selectSpace('a')
    expect(store.activeTab?.id).toBe('a3')
    store.setInGrid('a3', false)
    store.setInGrid('a2', true)
    store.activateTab('a2')
    store.removeTab('a2')
    expect(store.activeTab?.id).toBe('a1')
  })
})

describe('notifying', () => {
  it('notifies once per write, after the state is complete', () => {
    const { store, changed } = window()
    let seen: string | undefined
    changed.mockImplementation(() => {
      seen = store.activeTab?.id
    })
    store.activateTab('b1')
    expect(changed).toHaveBeenCalledTimes(1)
    expect(seen).toBe('b1')
  })
})
