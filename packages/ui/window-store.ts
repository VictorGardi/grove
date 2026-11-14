// The window's spaces, tabs and agents, with no DOM and no Tauri, so every rule runs in plain tests. The entry file forwards core
// events here as plain calls and repaints from the single change notification; it keeps the DOM of each tab, keyed by id.
import type { AgentInfo, AgentStateName, ContextUsage, SpaceInfo, SpaceTabInfo, StatusChange } from '../protocol/messages.ts'
import type { AgentKind } from '../core/status/adapter.ts'
import { gridMembers } from './grid/layout.ts'
import { visited } from './recent-tabs.ts'
import { sidebarSpaceOrder, tabStateOf, urgentTabs } from './sidebar-model.ts'

// What a tab runs: a shell, or one of the agents.
export type TabKind = 'shell' | AgentKind

// A tab as the store holds it: the model only. Everything is addressed by the core's id.
export interface Tab {
  readonly id: string
  // The space the tab belongs to, by its id; spacePath is the folder the pane header shows.
  readonly spaceId: string
  readonly spacePath: string
  readonly kind: TabKind
  // The name the user gave the tab; null shows "Tab N".
  readonly label: string | null
  // The tab's number in its space, counted in the order the tabs were opened.
  readonly number: number
  // Whether the human put the tab in the grid, saved with the window's view state.
  readonly inGrid: boolean
  readonly exited: boolean
}

// The one place a core tab record's kind becomes the window's: the core's `terminal` is the window's `shell`.
export function kindOf(info: { kind: 'terminal' | AgentKind }): TabKind {
  return info.kind === 'terminal' ? 'shell' : info.kind
}

export interface WindowStoreOptions {
  // Called once, synchronously, at the end of every write that changed something, after the invariants hold.
  changed: () => void
  // The id of a tab the grid shows in the space, which a selection prefers over the space's recent tab while the grid is on.
  gridPane?: (spaceId: string | null) => string | undefined
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

export interface WindowStore {
  readonly tabs: readonly Tab[]
  readonly activeTab: Tab | null
  readonly activeSpace: string | null
  readonly refused: string | null
  // Every tab's id, most recently shown first: Go to lists tabs and spaces in this order.
  readonly recentIds: readonly string[]
  tab(id: string): Tab | undefined
  tabsOfSpace(spaceId: string | null): Tab[]
  gridTabs(): Tab[]
  tabName(id: string): string
  stateOf(id: string): AgentStateName
  // A space's tabs by id, most recently visited first.
  recent(spaceId: string): readonly string[]
  spaces(): SpaceInfo[]
  space(id: string): SpaceInfo | undefined
  agent(tabId: string): AgentInfo | undefined
  agents(): AgentInfo[]
  // The tabs with something for the human, in any space (see urgentTabs).
  urgent(): Array<{ id: string; state: AgentStateName; since: number }>

  addTab(info: SpaceTabInfo): Tab
  renameTab(id: string, label: string | null): void
  // True when the tab was not an Exited tab before.
  markExited(id: string): boolean
  // True when the tab was an Exited tab before.
  markAlive(id: string): boolean
  removeTab(id: string): void
  activateTab(id: string): void
  selectSpace(spaceId: string | null, chosenId?: string): void
  setInGrid(id: string, inGrid: boolean): void
  setGridTabs(ids: string[]): void
  setRefused(reason: string | null): void
  setSpaces(list: SpaceInfo[]): void
  upsertSpace(info: SpaceInfo): void
  dropSpace(id: string): void
  setAgents(list: AgentInfo[]): void
  applyStatusChange(change: StatusChange): { previous: AgentInfo | undefined }
  applyContext(tabId: string, context: ContextUsage): void
}

export function createWindowStore(options: WindowStoreOptions): WindowStore {
  const order: Mutable<Tab>[] = []
  const byId = new Map<string, Mutable<Tab>>()
  const spaces = new Map<string, SpaceInfo>()
  const agents = new Map<string, AgentInfo>()
  const recentBySpace = new Map<string, string[]>()
  let recentIds: string[] = []
  let active: Mutable<Tab> | null = null
  let activeSpace: string | null = null
  let refused: string | null = null
  // The tabs whose kind came from their agent, so only those turn back into a shell when the agent ends.
  const detectedKinds = new Set<string>()

  // The state a tab shows: its agent's status, or idle for a shell or a gone tab.
  function stateOfTab(tab: Tab): AgentStateName {
    return tabStateOf({ exited: tab.exited, kind: tab.kind, state: agents.get(tab.id)?.state ?? null })
  }

  // The invariants, then the one notification.
  function commit(): void {
    const counts = new Map<string, number>()
    for (const tab of order) {
      const number = (counts.get(tab.spaceId) ?? 0) + 1
      counts.set(tab.spaceId, number)
      tab.number = number
    }
    options.changed()
  }

  // A tab's kind follows the agents: an agent typed by hand into a shell tab turns the tab into an agent tab, and a tab whose
  // agent ended turns back into a shell. Only tabs this function changed are turned back; a launched agent tab keeps its kind.
  function syncKinds(): void {
    for (const tab of order) {
      const agent = agents.get(tab.id)
      if (agent && tab.kind === 'shell') {
        tab.kind = agent.agent
        detectedKinds.add(tab.id)
      } else if (!agent && detectedKinds.delete(tab.id)) {
        tab.kind = 'shell'
      }
    }
  }

  // Shows the space's most recently visited tab, or its first tab, or nothing when the space has no tabs.
  function select(spaceId: string | null, chosenId?: string): void {
    activeSpace = spaceId
    const chosen = chosenId === undefined ? undefined : byId.get(chosenId)
    const remembered = spaceId ? byId.get(recentBySpace.get(spaceId)?.[0] ?? '') : undefined
    const gridId = options.gridPane?.(spaceId)
    const gridPane = gridId === undefined ? undefined : byId.get(gridId)
    active = chosen ?? gridPane ?? remembered ?? order.find((tab) => tab.spaceId === spaceId) ?? null
    if (active) {
      const id = active.id
      recentIds = [id, ...recentIds.filter((other) => other !== id)]
    }
  }

  function remove(id: string): void {
    const tab = byId.get(id)
    if (!tab) return
    byId.delete(id)
    order.splice(order.indexOf(tab), 1)
    agents.delete(id)
    detectedKinds.delete(id)
    const recent = recentBySpace.get(tab.spaceId)
    if (recent) recentBySpace.set(tab.spaceId, recent.filter((other) => other !== id))
    recentIds = recentIds.filter((other) => other !== id)
    if (active === tab) {
      active = null
      select(activeSpace)
    }
  }

  return {
    get tabs() {
      return order
    },
    get activeTab() {
      return active
    },
    get activeSpace() {
      return activeSpace
    },
    get refused() {
      return refused
    },
    get recentIds() {
      return recentIds
    },
    tab: (id) => byId.get(id),
    tabsOfSpace: (spaceId) => order.filter((tab) => tab.spaceId === spaceId),
    gridTabs: () => gridMembers(order),
    tabName(id) {
      const tab = byId.get(id)
      return tab ? tab.label || String(tab.number) : id
    },
    stateOf(id) {
      const tab = byId.get(id)
      return tab ? stateOfTab(tab) : 'idle'
    },
    recent: (spaceId) => recentBySpace.get(spaceId) ?? [],
    spaces: () => [...spaces.values()],
    space: (id) => spaces.get(id),
    agent: (tabId) => agents.get(tabId),
    agents: () => [...agents.values()],
    urgent() {
      return urgentTabs(
        order.map((tab) => ({
          id: tab.id,
          state: stateOfTab(tab),
          since: agents.get(tab.id)?.since ?? 0,
        })),
      )
    },

    addTab(info) {
      const existing = byId.get(info.id)
      if (existing) {
        existing.label = info.label
        // The core knows a tab by what it started, so a kind this store detected from the agent is kept.
        const kind = kindOf(info)
        if (!(kind === 'shell' && detectedKinds.has(info.id))) existing.kind = kind
        commit()
        return existing
      }
      const tab: Mutable<Tab> = {
        id: info.id,
        spaceId: info.spaceId,
        spacePath: info.spacePath,
        kind: kindOf(info),
        label: info.label,
        number: 0,
        inGrid: false,
        exited: false,
      }
      byId.set(tab.id, tab)
      order.push(tab)
      commit()
      return tab
    },
    renameTab(id, label) {
      const tab = byId.get(id)
      if (!tab) return
      tab.label = label || null
      commit()
    },
    markExited(id) {
      const tab = byId.get(id)
      if (!tab || tab.exited) return false
      tab.exited = true
      commit()
      return true
    },
    markAlive(id) {
      const tab = byId.get(id)
      if (!tab || !tab.exited) return false
      tab.exited = false
      commit()
      return true
    },
    removeTab(id) {
      // A closed tab's agent row goes with it, even when the tab itself was never listed.
      if (!byId.has(id) && !agents.delete(id)) return
      remove(id)
      commit()
    },
    activateTab(id) {
      const tab = byId.get(id)
      if (!tab) return
      recentBySpace.set(tab.spaceId, visited(recentBySpace.get(tab.spaceId) ?? [], id))
      select(tab.spaceId, id)
      commit()
    },
    selectSpace(spaceId, chosenId) {
      select(spaceId, chosenId)
      commit()
    },
    setInGrid(id, inGrid) {
      const tab = byId.get(id)
      if (!tab) return
      tab.inGrid = inGrid
      commit()
    },
    setGridTabs(ids) {
      for (const tab of order) tab.inGrid = ids.includes(tab.id)
      commit()
    },
    setRefused(reason) {
      refused = reason
      commit()
    },
    setSpaces(list) {
      spaces.clear()
      for (const space of list) spaces.set(space.id, space)
      commit()
    },
    upsertSpace(info) {
      spaces.set(info.id, info)
      commit()
    },
    dropSpace(id) {
      for (const tab of order.filter((other) => other.spaceId === id)) remove(tab.id)
      recentBySpace.delete(id)
      spaces.delete(id)
      if (activeSpace === id) select(sidebarSpaceOrder([...spaces.values()])[0] ?? null)
      commit()
    },
    setAgents(list) {
      agents.clear()
      for (const agent of list) agents.set(agent.tabId, agent)
      syncKinds()
      commit()
    },
    applyStatusChange(change) {
      const previous = agents.get(change.tabId)
      agents.set(change.tabId, {
        tabId: change.tabId,
        agent: change.agent,
        state: change.state,
        ...(change.reason ? { reason: change.reason } : {}),
        since: change.since,
        source: change.source,
        resumable: previous?.resumable ?? false,
        ...(previous?.context ? { context: previous.context } : {}),
      })
      syncKinds()
      commit()
      return { previous }
    },
    applyContext(tabId, context) {
      const entry = agents.get(tabId)
      if (!entry) return
      agents.set(tabId, { ...entry, context })
      commit()
    },
  }
}
