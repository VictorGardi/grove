// The window's spaces, tabs and agents, with no DOM and no Tauri, so every rule runs in plain tests. The entry file forwards core
// events here as plain calls and repaints from the single change notification; it keeps the DOM of each tab, keyed by id.
import type { AgentInfo, AgentStateName, ContextUsage, SpaceInfo, SpaceTabInfo, StatusChange } from '../protocol/messages.ts'
import type { AgentKind } from '../core/status/adapter.ts'
import { canJoinGrid, gridMembers } from './grid/layout.ts'
import { addPane, removePane, repair, type Size, type Tree } from './grid/tree.ts'
import { visited } from './recent-tabs.ts'
import { sidebarSpaceOrder, tabStateOf, urgentTabs } from './sidebar-model.ts'
import type { ViewStatePort } from './view-state.ts'

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
// A window kind passes through, so rows that already speak the window's kind (the states demo) need no mapping of their own.
function kindOf(info: { kind: 'terminal' | TabKind }): TabKind {
  return info.kind === 'terminal' ? 'shell' : info.kind
}

export interface WindowStoreOptions {
  // Called once, synchronously, at the end of every write that changed something, after the invariants hold.
  changed: () => void
  // Where the view state is saved to and restored from; saving starts once restoreViewState has run.
  viewState: ViewStatePort
}

// What toggling the Active tab in the grid did: it joined, it left, the grid was full, or there was no Active tab.
type GridToggle = 'joined' | 'left' | 'refused' | 'none'

// The core's answer to spaces.list.
export interface ListedState {
  spaces: SpaceInfo[]
  tabs: SpaceTabInfo[]
  refused: string | null
}

// What reconciling asks of the caller: the alive tabs to attach, in tab order, and the tabs just marked exited with their exit codes.
export interface ReconcileEffects {
  attach: string[]
  exited: { id: string; exitCode: number | null }[]
}

// A tab to add: the core's record, or the same with the window's own kind.
export type NewTab = Omit<SpaceTabInfo, 'kind'> & { kind: 'terminal' | TabKind }

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

export interface WindowStore {
  readonly tabs: readonly Tab[]
  readonly activeTab: Tab | null
  readonly activeSpace: string | null
  readonly refused: string | null
  // Grid mode shows the tabs the human put in it, across spaces.
  readonly gridOn: boolean
  // The grid's custom layout, or null while it arranges itself; kept fitted to the grid's tabs while the grid shows.
  readonly gridLayout: Tree | null
  // The last grid pane that had the focus: the one a joining tab splits.
  readonly lastGridFocus: string | null
  // Whether the saved view state has been restored, which is when saving it starts.
  readonly viewStateReady: boolean
  // Every tab's id, most recently shown first: Go to lists tabs and spaces in this order.
  readonly recentIds: readonly string[]
  tab(id: string): Tab | undefined
  tabsOfSpace(spaceId: string | null): Tab[]
  gridTabs(): Tab[]
  // The tab's name: its own label if the human set one, else the session name its agent keeps, else its number.
  tabName(id: string): string
  // Whether the tab has a name of either kind, so its number is only a stand-in.
  hasName(id: string): boolean
  stateOf(id: string): AgentStateName
  // A space's tabs by id, most recently visited first.
  recent(spaceId: string): readonly string[]
  spaces(): SpaceInfo[]
  space(id: string): SpaceInfo | undefined
  agent(tabId: string): AgentInfo | undefined
  agents(): AgentInfo[]
  // The tabs with something for the human, in any space (see urgentTabs).
  urgent(): Array<{ id: string; state: AgentStateName; since: number }>

  addTab(info: NewTab): Tab
  renameTab(id: string, label: string | null): void
  // True when the tab was not an Exited tab before.
  markExited(id: string): boolean
  // True when the tab was an Exited tab before.
  markAlive(id: string): boolean
  removeTab(id: string): void
  activateTab(id: string): void
  selectSpace(spaceId: string | null, chosenId?: string): void
  // Puts the Active tab in the grid and shows it, or takes it out and shows it full screen; a grid of nine refuses.
  // `size` is the grid's area, for splitting a custom layout.
  toggleGridTab(size?: Size): GridToggle
  // Shows or hides the grid; showing it focuses its first pane when the Active tab is not one.
  setGrid(on: boolean): void
  // The human arranged the grid: the layout is theirs, or null returns it to automatic.
  setGridLayout(layout: Tree | null): void
  // Restores the saved Active tab, Active space, grid and layout, once; saving starts here.
  restoreViewState(): void
  // Brings the window in line with the core's spaces-and-tabs list: the effects are the work left for the caller, so the store never awaits.
  reconcile(state: ListedState): ReconcileEffects
  upsertSpace(info: SpaceInfo): void
  dropSpace(id: string): void
  setAgents(list: AgentInfo[]): void
  applyStatusChange(change: StatusChange): { previous: AgentInfo | undefined }
  applyContext(tabId: string, context: ContextUsage): void
  applyName(tabId: string, name: string): void
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
  let gridOn = false
  let gridLayout: Tree | null = null
  let lastGridFocus: string | null = null
  let viewStateReady = false
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
    // The Active tab belongs to the Active space, unless that space has no tabs.
    if (active && active.spaceId !== activeSpace && order.some((tab) => tab.spaceId === activeSpace)) select(activeSpace)
    // The grid gives way when it holds no tabs, or the Active tab is not one of its panes: a tab the grid does not show cannot be focused there.
    const panes = gridMembers(order)
    if (gridOn && (panes.length === 0 || (active !== null && !panes.includes(active)))) gridOn = false
    if (gridOn) gridLayout &&= repair(gridLayout, panes.map((tab) => tab.id))
    if (gridOn && active?.inGrid) lastGridFocus = active.id
    if (viewStateReady) {
      options.viewState.write({
        gridOn,
        gridTabs: panes.map((tab) => tab.id),
        gridLayout,
        activeSpace,
        activeTab: active?.id ?? null,
      })
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
    const gridPane = gridOn ? gridMembers(order).find((tab) => tab.spaceId === spaceId) : undefined
    active = chosen ?? gridPane ?? remembered ?? order.find((tab) => tab.spaceId === spaceId) ?? null
    if (active) {
      const id = active.id
      recentIds = [id, ...recentIds.filter((other) => other !== id)]
    }
  }

  // Adds a tab the core listed, or takes the kind and label of one already held.
  function upsertTab(info: NewTab): Mutable<Tab> {
    const existing = byId.get(info.id)
    if (existing) {
      existing.label = info.label
      // The core knows a tab by what it started, so a kind this store detected from the agent is kept.
      const kind = kindOf(info)
      if (!(kind === 'shell' && detectedKinds.has(info.id))) existing.kind = kind
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
    return tab
  }

  function exit(id: string): boolean {
    const tab = byId.get(id)
    if (!tab || tab.exited) return false
    tab.exited = true
    return true
  }

  function restore(): void {
    const saved = options.viewState.read()
    // A saved grid tab that is gone is dropped silently.
    for (const tab of order) tab.inGrid = saved.gridTabs.includes(tab.id)
    gridLayout = saved.gridLayout
    const panes = gridMembers(order)
    gridOn = saved.gridOn && panes.length > 0
    let tab = saved.activeTab ? byId.get(saved.activeTab) ?? null : null
    if (gridOn && (!tab || !tab.inGrid)) tab = panes[0]
    if (tab) activate(tab)
    else if (saved.activeSpace && spaces.has(saved.activeSpace)) select(saved.activeSpace)
    viewStateReady = true
  }

  // Shows the tab, and its space with it, and counts it as the most recently visited.
  function activate(tab: Tab): void {
    recentBySpace.set(tab.spaceId, visited(recentBySpace.get(tab.spaceId) ?? [], tab.id))
    select(tab.spaceId, tab.id)
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
    if (active === tab) active = null
    if (active === null) select(activeSpace)
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
    get gridOn() {
      return gridOn
    },
    get gridLayout() {
      return gridLayout
    },
    get lastGridFocus() {
      return lastGridFocus
    },
    get viewStateReady() {
      return viewStateReady
    },
    get recentIds() {
      return recentIds
    },
    tab: (id) => byId.get(id),
    tabsOfSpace: (spaceId) => order.filter((tab) => tab.spaceId === spaceId),
    gridTabs: () => gridMembers(order),
    tabName(id) {
      const tab = byId.get(id)
      return tab ? tab.label || agents.get(id)?.name || String(tab.number) : id
    },
    hasName(id) {
      const tab = byId.get(id)
      return tab ? Boolean(tab.label || agents.get(id)?.name) : false
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
      const tab = upsertTab(info)
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
      if (!exit(id)) return false
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
      activate(tab)
      commit()
    },
    selectSpace(spaceId, chosenId) {
      select(spaceId, chosenId)
      commit()
    },
    toggleGridTab(size) {
      const tab = active
      if (!tab) return 'none'
      if (tab.inGrid) {
        if (gridLayout) gridLayout = removePane(gridLayout, tab.id)
        gridOn = false
        tab.inGrid = false
        commit()
        return 'left'
      }
      if (!canJoinGrid(gridMembers(order).length)) return 'refused'
      // With a layout of the human's own, the new pane splits the one they last had focus in.
      if (gridLayout) gridLayout = addPane(gridLayout, lastGridFocus ?? '', tab.id, size)
      gridOn = true
      tab.inGrid = true
      commit()
      return 'joined'
    },
    setGrid(on) {
      const panes = gridMembers(order)
      if (on && panes.length > 0 && (active === null || !panes.includes(active))) activate(panes[0])
      gridOn = on
      commit()
    },
    setGridLayout(layout) {
      gridLayout = layout
      commit()
    },
    restoreViewState() {
      if (viewStateReady) return
      restore()
      commit()
    },
    reconcile(state) {
      spaces.clear()
      for (const space of state.spaces) spaces.set(space.id, space)
      refused = state.refused
      const effects: ReconcileEffects = { attach: [], exited: [] }
      const alive = new Set(state.tabs.filter((info) => info.alive).map((info) => info.id))
      // A refused state file says nothing about which tabs are alive, so no tab is marked exited for it.
      if (refused === null) {
        for (const tab of order) if (!alive.has(tab.id) && exit(tab.id)) effects.exited.push({ id: tab.id, exitCode: null })
      }
      for (const info of state.tabs) {
        const known = byId.has(info.id)
        upsertTab(info)
        if (info.alive) effects.attach.push(info.id)
        else if (!known && exit(info.id)) effects.exited.push({ id: info.id, exitCode: info.exitCode })
      }
      if (!viewStateReady && refused === null) restore()
      const spaceId = activeSpace && spaces.has(activeSpace) ? activeSpace : (state.spaces[0]?.id ?? null)
      select(spaceId, active?.spaceId === spaceId ? active.id : undefined)
      commit()
      return effects
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
        ...(previous?.name ? { name: previous.name } : {}),
        ...(previous?.sessionId ? { sessionId: previous.sessionId } : {}),
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
    applyName(tabId, name) {
      const entry = agents.get(tabId)
      if (!entry || entry.name === name) return
      agents.set(tabId, { ...entry, name })
      commit()
    },
  }
}
