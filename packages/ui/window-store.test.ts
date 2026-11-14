import { describe, expect, it, vi } from 'vitest'
import type { AgentInfo, SpaceInfo, SpaceTabInfo, StatusChange } from '../protocol/messages.ts'
import { seedDemo, type DemoRows } from './demo/states.ts'
import { memoryViewState, noViewState } from './view-state.ts'
import { createWindowStore } from './window-store.ts'

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
function window(saved?: Parameters<typeof memoryViewState>[0]) {
  const changed = vi.fn()
  const port = memoryViewState(saved)
  const store = createWindowStore({ changed, viewState: port })
  store.upsertSpace(space('a'))
  store.upsertSpace(space('b'))
  for (const id of ['a1', 'a2', 'a3']) store.addTab(wire(id, 'a'))
  store.addTab(wire('b1', 'b'))
  changed.mockClear()
  return { store, changed, port }
}

describe('the kind of an added tab', () => {
  it('maps the core terminal kind to shell and keeps an agent kind', () => {
    const { store } = window()
    expect(store.addTab(wire('k1', 'a', { kind: 'terminal' })).kind).toBe('shell')
    expect(store.addTab(wire('k2', 'a', { kind: 'claude' })).kind).toBe('claude')
    expect(store.addTab(wire('k3', 'a', { kind: 'copilot' })).kind).toBe('copilot')
  })

  it('takes the window\'s own kind as it is, so the states demo needs no mapping', () => {
    const { store } = window()
    expect(store.addTab({ ...wire('k1', 'a'), kind: 'shell' }).kind).toBe('shell')
    expect(store.addTab({ ...wire('k2', 'a'), kind: 'claude' }).kind).toBe('claude')
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

// Puts the tabs in the grid one by one, each as the Active tab.
function grid(store: ReturnType<typeof window>['store'], ...ids: string[]): void {
  for (const id of ids) {
    store.activateTab(id)
    store.toggleGridTab()
  }
}

describe('toggling the Active tab in the grid', () => {
  it('puts the Active tab in the grid and shows the grid', () => {
    const { store } = window()
    store.activateTab('a2')
    expect(store.toggleGridTab()).toBe('joined')
    expect(store.gridOn).toBe(true)
    expect(store.gridTabs().map((tab) => tab.id)).toEqual(['a2'])
  })

  it('lists the grid tabs in tab order, across spaces', () => {
    const { store } = window()
    grid(store, 'b1', 'a3', 'a1')
    expect(store.gridTabs().map((tab) => tab.id)).toEqual(['a1', 'a3', 'b1'])
  })

  it('takes a tab already in the grid out of it and shows the grid off', () => {
    const { store } = window()
    grid(store, 'a1', 'a2')
    expect(store.toggleGridTab()).toBe('left')
    expect(store.gridOn).toBe(false)
    expect(store.gridTabs().map((tab) => tab.id)).toEqual(['a1'])
  })

  it('refuses a tenth tab and changes nothing', () => {
    const { store, changed } = window()
    for (let n = 4; n <= 10; n++) store.addTab(wire(`a${n}`, 'a'))
    grid(store, 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9')
    store.activateTab('a10')
    changed.mockClear()
    expect(store.toggleGridTab()).toBe('refused')
    expect(store.tab('a10')?.inGrid).toBe(false)
    expect(store.gridTabs()).toHaveLength(9)
    expect(changed).not.toHaveBeenCalled()
  })

  it('does nothing without an Active tab', () => {
    const { store } = window()
    store.upsertSpace(space('empty'))
    store.selectSpace('empty')
    expect(store.toggleGridTab()).toBe('none')
    expect(store.gridOn).toBe(false)
  })

  it('splits the pane that last had the focus in a custom layout', () => {
    const { store } = window()
    grid(store, 'a1', 'a2')
    store.setGridLayout({ dir: 'row', ratio: 0.3, a: 'a1', b: 'a2' })
    store.activateTab('a2')
    expect(store.lastGridFocus).toBe('a2')
    store.activateTab('a3')
    store.toggleGridTab({ w: 100, h: 100 })
    expect(store.gridLayout).toMatchObject({ dir: 'row', ratio: 0.3, a: 'a1' })
    expect(JSON.stringify(store.gridLayout)).toContain('a3')
  })

  it('drops the leaving pane from a custom layout', () => {
    const { store } = window()
    grid(store, 'a1', 'a2')
    store.setGridLayout({ dir: 'row', ratio: 0.3, a: 'a1', b: 'a2' })
    store.toggleGridTab()
    expect(store.gridLayout).toBe('a1')
  })
})

describe('the grid turning itself off', () => {
  it('turns off when it holds no tabs', () => {
    const { store } = window()
    store.setGrid(true)
    expect(store.gridOn).toBe(false)
  })

  it('turns off when the last grid tab closes', () => {
    const { store } = window()
    grid(store, 'a2')
    store.removeTab('a2')
    expect(store.gridOn).toBe(false)
    expect(store.activeTab?.id).toBe('a1')
  })

  it('turns off when the Active tab is not one of its panes', () => {
    const { store } = window()
    grid(store, 'a1', 'a2')
    store.activateTab('a3')
    expect(store.gridOn).toBe(false)
    expect(store.gridTabs().map((tab) => tab.id)).toEqual(['a1', 'a2'])
  })

  it('stays on while the Active tab moves between its panes, across spaces', () => {
    const { store } = window()
    grid(store, 'a1', 'b1')
    store.activateTab('a1')
    expect(store.gridOn).toBe(true)
  })

  it('shows again with the first pane focused when the human turns it on', () => {
    const { store } = window()
    grid(store, 'a2', 'b1')
    store.activateTab('a3')
    store.setGrid(true)
    expect(store.gridOn).toBe(true)
    expect(store.activeTab?.id).toBe('a2')
  })

  it('keeps the Active tab when it is already a pane', () => {
    const { store } = window()
    grid(store, 'a2', 'b1')
    store.setGrid(false)
    store.setGrid(true)
    expect(store.activeTab?.id).toBe('b1')
  })
})

describe('selecting while the grid shows', () => {
  it('prefers a grid pane of the space over its recent tab', () => {
    const { store } = window()
    grid(store, 'a3', 'b1')
    store.activateTab('b1')
    store.selectSpace('a')
    expect(store.activeTab?.id).toBe('a3')
  })

  it('shows the space’s recent tab when its last grid pane closes and the grid goes off', () => {
    const { store } = window()
    store.activateTab('a1')
    grid(store, 'a2')
    store.removeTab('a2')
    expect(store.gridOn).toBe(false)
    expect(store.activeTab?.id).toBe('a1')
  })
})

describe('the grid layout', () => {
  it('is automatic until the human sets one, and null returns it to automatic', () => {
    const { store } = window()
    expect(store.gridLayout).toBeNull()
    grid(store, 'a1', 'a2')
    store.setGridLayout({ dir: 'col', ratio: 0.4, a: 'a1', b: 'a2' })
    expect(store.gridLayout).toEqual({ dir: 'col', ratio: 0.4, a: 'a1', b: 'a2' })
    store.setGridLayout(null)
    expect(store.gridLayout).toBeNull()
  })

  it('is fitted to the grid tabs while the grid shows', () => {
    const { store } = window()
    grid(store, 'a1', 'a2')
    store.setGridLayout({ dir: 'col', ratio: 0.4, a: 'a1', b: 'a2' })
    store.activateTab('b1')
    store.toggleGridTab()
    expect(JSON.stringify(store.gridLayout)).toContain('b1')
    store.removeTab('a2')
    expect(JSON.stringify(store.gridLayout)).not.toContain('a2')
  })

  it('notifies once', () => {
    const { store, changed } = window()
    store.setGridLayout('a1')
    expect(changed).toHaveBeenCalledTimes(1)
  })
})

describe('the Active tab within the Active space', () => {
  it('follows the Active tab into its space', () => {
    const { store } = window()
    store.activateTab('b1')
    expect(store.activeSpace).toBe('b')
    expect(store.activeTab?.spaceId).toBe('b')
  })

  it('is reselected when the Active space has tabs and the Active tab is in another', () => {
    const { store } = window({ activeSpace: 'a', activeTab: 'b1' })
    store.restoreViewState()
    expect(store.activeTab?.spaceId).toBe(store.activeSpace)
    expect(store.activeTab?.id).toBe('b1')
  })

  it('is left alone when the Active space has no tabs', () => {
    const { store } = window()
    store.upsertSpace(space('empty'))
    store.selectSpace('empty')
    store.activateTab('a1')
    store.selectSpace('empty')
    expect(store.activeSpace).toBe('empty')
    expect(store.activeTab).toBeNull()
  })
})

describe('the view state', () => {
  it('is not saved before it has been restored', () => {
    const { store, port } = window()
    store.activateTab('a2')
    grid(store, 'a1')
    store.setGridLayout('a1')
    expect(store.viewStateReady).toBe(false)
    expect(port.writes).toEqual([])
  })

  it('is saved through the port after every write once restored', () => {
    const { store, port } = window()
    store.restoreViewState()
    port.writes.length = 0
    store.activateTab('a2')
    expect(port.writes).toHaveLength(1)
    store.toggleGridTab()
    expect(port.writes).toHaveLength(2)
    expect(port.saved).toEqual({ gridOn: true, gridTabs: ['a2'], gridLayout: null, activeSpace: 'a', activeTab: 'a2' })
  })

  it('saves the layout after the human sets one', () => {
    const { store, port } = window()
    store.restoreViewState()
    grid(store, 'a1', 'a2')
    store.setGridLayout({ dir: 'row', ratio: 0.3, a: 'a1', b: 'a2' })
    expect(port.saved.gridLayout).toEqual({ dir: 'row', ratio: 0.3, a: 'a1', b: 'a2' })
  })

  it('is saved after the invariants, so a grid that turned itself off is saved off', () => {
    const { store, port } = window()
    store.restoreViewState()
    grid(store, 'a1')
    store.removeTab('a1')
    expect(port.saved.gridOn).toBe(false)
    expect(port.saved.gridTabs).toEqual([])
  })

  it('restores the Active tab, its space, the grid and its layout', () => {
    const layout = { dir: 'row' as const, ratio: 0.3, a: 'a1', b: 'b1' }
    const { store } = window({ gridOn: true, gridTabs: ['a1', 'b1'], gridLayout: layout, activeSpace: 'b', activeTab: 'b1' })
    store.restoreViewState()
    expect(store.viewStateReady).toBe(true)
    expect(store.activeTab?.id).toBe('b1')
    expect(store.activeSpace).toBe('b')
    expect(store.gridOn).toBe(true)
    expect(store.gridLayout).toEqual(layout)
    expect(store.gridTabs().map((tab) => tab.id)).toEqual(['a1', 'b1'])
  })

  it('drops a saved grid tab that no longer exists, silently', () => {
    const { store } = window({ gridOn: true, gridTabs: ['ghost', 'a2'], activeTab: 'a2', activeSpace: 'a' })
    store.restoreViewState()
    expect(store.gridTabs().map((tab) => tab.id)).toEqual(['a2'])
    expect(store.gridOn).toBe(true)
  })

  it('leaves the grid off when none of its saved tabs exist', () => {
    const { store } = window({ gridOn: true, gridTabs: ['ghost'], activeTab: 'a2', activeSpace: 'a' })
    store.restoreViewState()
    expect(store.gridOn).toBe(false)
    expect(store.activeTab?.id).toBe('a2')
  })

  it('focuses the first pane when the saved Active tab is not one of the grid’s', () => {
    const { store } = window({ gridOn: true, gridTabs: ['a2', 'b1'], activeTab: 'a1', activeSpace: 'a' })
    store.restoreViewState()
    expect(store.activeTab?.id).toBe('a2')
  })

  it('falls back to the saved space when the saved Active tab is gone', () => {
    const { store } = window({ activeTab: 'ghost', activeSpace: 'b' })
    store.restoreViewState()
    expect(store.activeSpace).toBe('b')
    expect(store.activeTab?.id).toBe('b1')
  })

  it('restores only once', () => {
    const { store, port } = window({ activeTab: 'a2', activeSpace: 'a' })
    store.restoreViewState()
    store.activateTab('a3')
    port.saved = { ...port.saved, activeTab: 'a1' }
    store.restoreViewState()
    expect(store.activeTab?.id).toBe('a3')
  })
})

// What the core lists: spaces a and b, the tabs given.
function listing(tabs: SpaceTabInfo[], overrides: Partial<{ spaces: SpaceInfo[]; refused: string | null }> = {}) {
  return { spaces: [space('a'), space('b')], tabs, refused: null, ...overrides }
}

function fresh(saved?: Parameters<typeof memoryViewState>[0]) {
  const changed = vi.fn()
  const port = memoryViewState(saved)
  const store = createWindowStore({ changed, viewState: port })
  return { store, changed, port }
}

describe('reconciling with the core', () => {
  it('creates the spaces and tabs, and returns the alive tabs to attach in tab order', () => {
    const { store } = fresh()
    const effects = store.reconcile(listing([wire('a1', 'a'), wire('a2', 'a', { alive: false, exitCode: 3 }), wire('b1', 'b')]))
    expect(store.spaces().map((s) => s.id)).toEqual(['a', 'b'])
    expect(store.tabs.map((tab) => tab.id)).toEqual(['a1', 'a2', 'b1'])
    expect(effects.attach).toEqual(['a1', 'b1'])
    expect(effects.exited).toEqual([{ id: 'a2', exitCode: 3 }])
    expect(store.tab('a2')?.exited).toBe(true)
  })

  it('is idempotent: a second listing adds no tab twice', () => {
    const { store } = fresh()
    const tabs = [wire('a1', 'a'), wire('a2', 'a')]
    store.reconcile(listing(tabs))
    const again = store.reconcile(listing(tabs))
    expect(store.tabs).toHaveLength(2)
    expect(again.exited).toEqual([])
  })

  it('marks a tab the core no longer has alive as exited, with no exit code', () => {
    const { store } = fresh()
    store.reconcile(listing([wire('a1', 'a'), wire('a2', 'a')]))
    const effects = store.reconcile(listing([wire('a1', 'a')]))
    expect(effects.exited).toEqual([{ id: 'a2', exitCode: null }])
    expect(store.tab('a2')?.exited).toBe(true)
    expect(effects.attach).toEqual(['a1'])
  })

  it('does not report a tab that was already an Exited tab', () => {
    const { store } = fresh()
    store.reconcile(listing([wire('a1', 'a', { alive: false })]))
    expect(store.reconcile(listing([wire('a1', 'a', { alive: false })])).exited).toEqual([])
  })

  it('marks nothing exited and exposes the reason when the core refused its state', () => {
    const { store } = fresh()
    store.reconcile(listing([wire('a1', 'a'), wire('a2', 'a')]))
    const effects = store.reconcile(listing([], { refused: 'bad json' }))
    expect(effects.exited).toEqual([])
    expect(store.tabs.every((tab) => !tab.exited)).toBe(true)
    expect(store.refused).toBe('bad json')
  })

  it('clears the refused reason when the core loads its state again', () => {
    const { store } = fresh()
    store.reconcile(listing([], { refused: 'bad json' }))
    store.reconcile(listing([]))
    expect(store.refused).toBeNull()
  })

  it('keeps a kind detected from the agent and takes the core’s label', () => {
    const { store } = fresh()
    store.reconcile(listing([wire('a1', 'a')]))
    store.setAgents([entry('a1', 'claude')])
    expect(store.tab('a1')?.kind).toBe('claude')
    store.reconcile(listing([wire('a1', 'a', { label: 'main' })]))
    expect(store.tab('a1')).toMatchObject({ kind: 'claude', label: 'main' })
  })

  it('sets the kind of an existing tab from the core when none was detected', () => {
    const { store } = fresh()
    store.reconcile(listing([wire('a1', 'a')]))
    store.reconcile(listing([wire('a1', 'a', { kind: 'copilot' })]))
    expect(store.tab('a1')?.kind).toBe('copilot')
  })

  it('brings back the Active tab, grid and Recent order on first run', () => {
    const layout = { dir: 'row' as const, ratio: 0.3, a: 'a1', b: 'b1' }
    const { store } = fresh({ gridOn: true, gridTabs: ['a1', 'b1'], gridLayout: layout, activeSpace: 'b', activeTab: 'b1' })
    store.reconcile(listing([wire('a1', 'a'), wire('a2', 'a'), wire('b1', 'b')]))
    expect(store.viewStateReady).toBe(true)
    expect(store.activeTab?.id).toBe('b1')
    expect(store.activeSpace).toBe('b')
    expect(store.gridOn).toBe(true)
    expect(store.gridLayout).toEqual(layout)
    expect(store.recent('b')).toEqual(['b1'])
    expect(store.recentIds[0]).toBe('b1')
  })

  it('does not restore the view state while the core’s state is refused', () => {
    const { store } = fresh({ activeSpace: 'b', activeTab: 'b1' })
    store.reconcile(listing([wire('b1', 'b')], { refused: 'bad json' }))
    expect(store.viewStateReady).toBe(false)
  })

  it('restores only on the first run', () => {
    const { store } = fresh({ activeSpace: 'a', activeTab: 'a1' })
    const tabs = [wire('a1', 'a'), wire('a2', 'a')]
    store.reconcile(listing(tabs))
    store.activateTab('a2')
    store.reconcile(listing(tabs))
    expect(store.activeTab?.id).toBe('a2')
  })

  it('falls back to the first space when the Active space is gone', () => {
    const { store } = fresh({ activeSpace: 'gone', activeTab: 'ghost' })
    store.reconcile(listing([wire('a1', 'a'), wire('b1', 'b')]))
    expect(store.activeSpace).toBe('a')
    expect(store.activeTab?.id).toBe('a1')
  })

  it('moves off a space the core dropped', () => {
    const { store } = fresh()
    store.reconcile(listing([wire('a1', 'a'), wire('b1', 'b')]))
    store.selectSpace('b')
    store.reconcile(listing([wire('a1', 'a')], { spaces: [space('a')] }))
    expect(store.activeSpace).toBe('a')
  })

  it('notifies once', () => {
    const { store, changed } = fresh()
    store.reconcile(listing([wire('a1', 'a'), wire('a2', 'a', { alive: false })]))
    expect(changed).toHaveBeenCalledTimes(1)
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

describe('the states demo setup', () => {
  function demo() {
    const store = createWindowStore({ changed: vi.fn(), viewState: noViewState })
    const rows: DemoRows = {
      home: '/home',
      spaces: [space('s1'), space('s2')],
      tabs: [
        { id: 't1', spaceId: 's1', kind: 'shell', label: null, exited: false },
        { id: 't2', spaceId: 's1', kind: 'claude', label: 'review', exited: true },
        { id: 't3', spaceId: 's2', kind: 'copilot', label: null, exited: false },
      ],
      agents: [entry('t3', 'copilot', { state: 'working' })],
    }
    seedDemo(store, rows)
    return store
  }

  it('selects the first space and shows its first tab', () => {
    const store = demo()
    expect(store.activeSpace).toBe('s1')
    expect(store.activeTab?.id).toBe('t1')
  })

  it('keeps kinds, labels and numbers, and marks only the exited tab exited', () => {
    const store = demo()
    expect(store.tabs.map((tab) => [tab.id, tab.kind, tab.exited])).toEqual([
      ['t1', 'shell', false],
      ['t2', 'claude', true],
      ['t3', 'copilot', false],
    ])
    expect(store.tabName('t2')).toBe('review')
    expect(store.tabName('t1')).toBe('1')
    expect(store.stateOf('t2')).toBe('idle')
    expect(store.stateOf('t3')).toBe('working')
  })

  it('saves nothing, and reads an empty view state', () => {
    const store = demo()
    expect(store.viewStateReady).toBe(false)
    expect(noViewState.read().activeTab).toBeNull()
  })
})
