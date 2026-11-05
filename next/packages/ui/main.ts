import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { createBridge, fromBase64, toBase64 } from './bridge.ts'
import { createSoundGate, noticeBody } from './alerts.ts'
import { applyLayout, applySettings, applyTheme, findAction, formatBinding, launcherLine } from './config.ts'
import { openTerminal, terminalFontSize, tokenValue, type TerminalView } from './terminal.ts'
import { canJoinGrid, gridMembers, gridShape, paneSpans } from './grid/layout.ts'
import { previousOf, visited } from './recent-tabs.ts'
import { readSidebarHidden, writeSidebarHidden, type KeyValueStore } from './sidebar-state.ts'
import { groupAgents, shortFolder, sidebarSpaceOrder, spaceAt, tabStateOf, tileIndex } from './sidebar-model.ts'
import { createTabPill, type TabPill } from './tab-pill.ts'
import { createRenameModal } from './rename-modal.ts'
import { createIntegrationPanel } from './integrations.ts'
import { indicatorClass, indicatorLabel } from './indicator.ts'
import { iconSvg } from './icons.ts'
import { rollupSpaces } from '../protocol/rollup.ts'
import type {
  AgentInfo,
  AgentStateName,
  ConfigSnapshot,
  KeyAction,
  Launcher,
  SpaceInfo,
} from '../protocol/messages.ts'
import type { AgentKind } from '../core/status/adapter.ts'
import { DEFAULT_VALUES } from '../core/config/schema.ts'
import type { DemoRows } from './demo/states.ts'
import './styles.css'

interface EnvInfo {
  home: string
}

// What a tab runs: a shell, or one of the agents.
type TabKind = 'shell' | AgentKind

interface Tab {
  id: string
  // The space the tab belongs to, by its id; spacePath is the folder the pane header shows.
  spaceId: string
  spacePath: string
  kind: TabKind
  // The name the user gave the tab; null shows "Tab N".
  label: string | null
  // The tab's number in its space, counted in the order the tabs were opened.
  number: number
  // Whether the human put the tab in the grid. Kept in the window only: a reload starts with no tab in the grid.
  inGrid: boolean
  attached: boolean
  exited: boolean
  queue: Uint8Array[] | null
  // The tab's pane in the terminals area, its terminal, and its button in the strip.
  pane: HTMLElement
  head: HTMLElement
  host: HTMLDivElement
  tabEl: HTMLDivElement
  pill: TabPill
  view: TerminalView
}

// One agent row in the sidebar: the tab it belongs to, with the agent's status.
interface AgentRow {
  spaceId: string
  tabNumber: number
  agent: AgentInfo
  exited: boolean
  tab: Tab
}

const bridge = createBridge()
const encoder = new TextEncoder()
const tabs = new Map<string, Tab>()
const order: Tab[] = []
const spaces = new Map<string, SpaceInfo>()
// Each space's tabs, most recently visited first: the previous-tab key goes back through them, and a space shows its first.
const recentBySpace = new Map<string, Tab[]>()
const agents = new Map<string, AgentInfo>()
let active: Tab | null = null
let activeSpace: string | null = null
let refused: string | null = null
let homeDir = ''
let windowFocused = false
// The config in use: the key bindings, the theme tokens set on the root, and the note the status line shows for them.
let keys: Record<KeyAction, string> = DEFAULT_VALUES.keys
let themeTokens: string[] = []
let noteShown = ''
const isMac = navigator.platform.startsWith('Mac')
// Grid mode shows the active space's first tabs as panes instead of only the active one.
let gridOn = false
// The last attention.focus sent, as a key; an identical one is skipped until a reconnect clears it.
let sentFocus: string | null = null
// The states page (?demo=states) runs without a core: nothing is sent to it.
let demoMode = false
const playSound = createSoundGate()

const appEl = byId('app')
const tabStrip = byId('tabs')
const terminals = byId('terminals')
const statusLine = byId('status')
const spaceList = byId('spaces')
const newTabButton = byId('new-tab') as HTMLButtonElement
const gridToggle = byId('grid-toggle') as HTMLButtonElement
const agentList = byId('agents')
const agentsEmpty = byId('agents-empty')
const installCliButton = byId('install-cli') as HTMLButtonElement
const sidebar = byId('sidebar')
const sidebarToggle = byId('sidebar-toggle') as HTMLButtonElement
const launcherBar = byId('launchers')
const emptyState = byId('empty-state')
const emptyTitle = byId('empty-title')
const emptyText = byId('empty-text')
// The rename modal saves through tabs.rename and shows the tab's new name at once. Key bindings wait while it is open.
const renameModal = createRenameModal(
  {
    modal: byId('rename-modal'),
    form: byId('rename-form') as HTMLFormElement,
    input: byId('rename-input') as HTMLInputElement,
    cancel: byId('rename-cancel') as HTMLButtonElement,
    error: byId('rename-error'),
  },
  {
    rename: (id, label) => bridge.rpc('tabs.rename', { id, label }),
    renamed: (id, label) => {
      const tab = tabs.get(id)
      if (!tab) return
      tab.label = label || null
      paint()
    },
    closed: focusActive,
  },
)
// Agent status: the Agents panel and the one-time prompt. Each install, removal or answer is a call the human made here.
const integrationPanel = createIntegrationPanel(
  {
    panel: byId('integrations-modal'),
    list: byId('integrations-list'),
    error: byId('integrations-error'),
    close: byId('integrations-close') as HTMLButtonElement,
    prompt: byId('integration-prompt'),
    promptTitle: byId('integration-prompt-title'),
    promptText: byId('integration-prompt-text'),
    promptError: byId('integration-prompt-error'),
    enable: byId('integration-enable') as HTMLButtonElement,
    notNow: byId('integration-not-now') as HTMLButtonElement,
  },
  {
    status: async () => (await bridge.rpc('integration.status', {})).agents,
    install: (agent) => bridge.rpc('integration.install', { agent }),
    uninstall: (agent) => bridge.rpc('integration.uninstall', { agent }),
    answer: (agent) => bridge.rpc('integration.answer', { agent, answer: 'not-now' }),
  },
)

// Each key action does what its button does, so a disabled button ignores the key as it ignores a click.
const keyActions: Record<KeyAction, () => void> = {
  'grid-toggle': () => gridToggle.click(),
  'new-shell': () => newTabButton.click(),
  'new-space': () => void newSpaceTab().catch(report),
  'close-tab': () => {
    if (active) void closeTab(active).catch(report)
  },
  'previous-tab': () => {
    const recent = activeSpace === null ? [] : (recentBySpace.get(activeSpace) ?? [])
    const previous = previousOf(recent, active)
    if (previous) activate(previous)
  },
  'grid-tab': () => toggleGridTab(),
  'sidebar-toggle': () => sidebarToggle.click(),
  'space-1': () => focusSpace(1),
  'space-2': () => focusSpace(2),
  'space-3': () => focusSpace(3),
  'space-4': () => focusSpace(4),
  'space-5': () => focusSpace(5),
  'space-6': () => focusSpace(6),
  'space-7': () => focusSpace(7),
  'space-8': () => focusSpace(8),
  'space-9': () => focusSpace(9),
}

// The command the window starts; the core builds the args from the agent kind.
const AGENT_COMMANDS: Record<AgentKind, string> = { claude: 'claude', opencode: 'opencode', copilot: 'copilot' }
// The letter on a tab's mark: C, O and G for the agents (the reference's marks), $ for a shell.
const MARK_TEXT: Record<TabKind, string> = { shell: '$', claude: 'C', opencode: 'O', copilot: 'G' }
const AGE_REFRESH_MS = 5000

function byId(id: string): HTMLElement {
  const element = document.getElementById(id)
  if (!element) throw new Error(`missing #${id}`)
  return element
}

function report(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.error(error)
  statusLine.textContent = message
}

function element(tag: string, className: string, text = ''): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  node.textContent = text
  return node
}

function spaceName(spaceId: string): string {
  return spaces.get(spaceId)?.name ?? spaceId
}

// The tab's name: the one the user gave it, else "Tab N".
function tabName(tab: Tab): string {
  return tab.label || `Tab ${tab.number}`
}

// The tab's name with its space, for titles and notifications.
function tabLabel(tab: Tab): string {
  return `${spaceName(tab.spaceId)}: ${tabName(tab)}`
}

// The state a tab shows: its agent's status, or idle for a shell or a gone tab.
function stateOf(tab: Tab): AgentStateName {
  return tabStateOf({ exited: tab.exited, kind: tab.kind, state: agents.get(tab.id)?.state ?? null })
}

// The state indicator; its label is the same text as the shape's name.
function indicatorEl(state: AgentStateName): HTMLElement {
  const node = element('span', indicatorClass(state))
  node.title = indicatorLabel(state)
  node.setAttribute('aria-label', indicatorLabel(state))
  return node
}

function markEl(kind: TabKind): HTMLElement {
  return element('span', `agent-mark mark-${kind}`, MARK_TEXT[kind])
}

function createTab(spaceId: string, spacePath: string, kind: TabKind, label: string | null): Tab {
  const pane = document.createElement('section')
  pane.className = 'pane'
  const head = document.createElement('header')
  head.className = 'pane-head'
  const host = document.createElement('div')
  host.className = 'term-host'
  pane.append(head, host)
  terminals.append(pane)

  const pill = createTabPill(markEl(kind), {
    onActivate: () => activate(tab),
    onRename: () => {
      if (tab.id) renameModal.open({ id: tab.id, label: tab.label, number: tab.number })
    },
    onClose: () => closeTab(tab).catch(report),
  })
  const tabEl = pill.root
  tabStrip.append(tabEl)

  const tab: Tab = {
    id: '',
    spaceId,
    spacePath,
    kind,
    label,
    number: 0,
    inGrid: false,
    attached: false,
    exited: false,
    queue: null,
    pane,
    head,
    host,
    tabEl,
    pill,
    view: undefined as unknown as TerminalView,
  }
  host.addEventListener('click', () => activate(tab))
  tab.view = openTerminal(host, {
    onInput: (text) => {
      if (tab.attached) void bridge.rpc('tabs.write', { id: tab.id, dataB64: toBase64(encoder.encode(text)) }).catch(report)
    },
    onResize: (cols, rows) => {
      if (tab.attached) void bridge.rpc('tabs.resize', { id: tab.id, cols, rows }).catch(report)
    },
    onContextLoss: () => console.warn(`WebGL context lost in tab ${tab.id}; using the DOM renderer`),
  })
  return tab
}

function adopt(tab: Tab, id: string): void {
  tab.id = id
  tabs.set(id, tab)
  order.push(tab)
  paint()
}

// Takes a tab out of the window. When it was the one on screen, the space's next tab is shown.
function removeTab(tab: Tab): void {
  tab.pane.remove()
  tab.tabEl.remove()
  if (tab.id) tabs.delete(tab.id)
  const index = order.indexOf(tab)
  if (index !== -1) order.splice(index, 1)
  const recent = recentBySpace.get(tab.spaceId)
  if (recent) recentBySpace.set(tab.spaceId, recent.filter((other) => other !== tab))
  if (active === tab) active = null
  if (active === null) selectSpace(activeSpace)
  else paint()
}

// The × and Cmd+W: the core kills the tab and drops its record. The tab leaves the strip and the agents list at once.
async function closeTab(tab: Tab): Promise<void> {
  if (!tab.id) return
  await bridge.rpc('tabs.close', { id: tab.id })
  agents.delete(tab.id)
  removeTab(tab)
  focusActive()
}

function deliver(tab: Tab, bytes: Uint8Array): void {
  if (tab.queue) tab.queue.push(bytes)
  else tab.view.write(bytes)
}

function markExited(tab: Tab, exitCode: number | null = null): void {
  if (tab.exited) return
  tab.exited = true
  tab.attached = false
  const code = exitCode === null ? '' : ` with code ${exitCode}`
  deliver(tab, encoder.encode(`\r\n\x1b[2m[process exited${code}]\x1b[0m\r\n`))
  paint()
}

// Shows the core's saved screen first, then output that arrived while the attach was in flight.
async function attach(tab: Tab): Promise<void> {
  tab.queue = []
  try {
    const { screenB64 } = await bridge.rpc('tabs.attach', { id: tab.id })
    tab.view.reset()
    tab.view.write(fromBase64(screenB64))
    const pending = tab.queue
    tab.queue = null
    for (const bytes of pending) tab.view.write(bytes)
  } finally {
    tab.queue = null
  }
  tab.attached = true
  tab.exited = false
  const { cols, rows } = tab.view.term
  await bridge.rpc('tabs.resize', { id: tab.id, cols, rows })
}

// The active space's tabs the human put in the grid, in tab order: the panes grid mode shows.
function gridTabs(): Tab[] {
  return gridMembers(order.filter((tab) => tab.spaceId === activeSpace))
}

// Lays the panes out in grid mode, or clears the grid's classes and placement when it is off.
function paintGrid(members: Tab[]): void {
  terminals.classList.toggle('grid-panes', gridOn)
  if (gridOn) {
    const shape = gridShape(members.length)
    terminals.style.setProperty('--grid-cols', String(shape.cols))
    terminals.style.setProperty('--grid-rows', String(shape.rows))
  } else {
    terminals.style.removeProperty('--grid-cols')
    terminals.style.removeProperty('--grid-rows')
  }
  const spans = paneSpans(members.length)
  for (const tab of order) {
    const index = members.indexOf(tab)
    const span = gridOn && index >= 0 ? spans[index] : undefined
    // The grid placement of a pane is the one style the window writes per element.
    tab.pane.style.gridColumn = span ? `span ${span.cols}` : ''
    tab.pane.style.gridRow = span ? `span ${span.rows}` : ''
    tab.host.classList.toggle('pane-dim', span !== undefined && tab !== active)
  }
}

// Refits what is on screen: the grid's panes, else the active tab.
function fitShown(): void {
  for (const tab of gridOn ? gridTabs() : active ? [active] : []) tab.view.fit()
}

// The tab's strip button and its pane header, from its name and state.
function paintTab(tab: Tab): void {
  const state = stateOf(tab)
  const name = tabName(tab)
  tab.pill.update({ name, title: tabLabel(tab), state })
  tab.head.replaceChildren(
    markEl(tab.kind),
    element('span', 'pane-kind', name),
    element('span', 'pane-folder', shortFolder(tab.spacePath, homeDir)),
    indicatorEl(state),
  )
}

// The empty state shows when there is no space, or the space has no tabs.
function paintEmpty(): void {
  const none = activeSpace === null
  const bare = !order.some((tab) => tab.spaceId === activeSpace)
  emptyState.hidden = !(none || bare)
  emptyTitle.textContent = none ? 'No space open' : 'No tabs in this space'
  emptyText.textContent = none
    ? `Press ${shortcut('new-space')} to open a space at your home folder.`
    : `Press + in the tab strip (${shortcut('new-shell')}) to open a shell.`
}

// Tabs of other spaces stay mounted and only hidden, so their shells keep running and their screens keep filling.
function paint(): void {
  // The grid gives way when it holds no tabs, or the focused tab is not one of its panes: a tab the grid does not show cannot be focused there.
  const shown = gridTabs()
  if (gridOn && (shown.length === 0 || (active !== null && !shown.includes(active)))) gridOn = false
  const members = gridOn ? shown : []
  const counts = new Map<string, number>()
  for (const tab of order) {
    const on = tab === active
    const number = (counts.get(tab.spaceId) ?? 0) + 1
    counts.set(tab.spaceId, number)
    tab.number = number
    tab.tabEl.hidden = tab.spaceId !== activeSpace
    tab.tabEl.classList.toggle('active', on)
    tab.tabEl.classList.toggle('exited', tab.exited)
    tab.tabEl.setAttribute('aria-selected', String(on))
    tab.pane.hidden = gridOn ? !members.includes(tab) : !on
    tab.pane.classList.toggle('focused', on)
    paintTab(tab)
  }
  paintGrid(members)
  requestAnimationFrame(fitShown)
  renderSpaces()
  renderAgents()
  paintEmpty()
  const idle = activeSpace === null || refused !== null
  newTabButton.disabled = idle
  gridToggle.setAttribute('aria-pressed', String(gridOn))
  gridToggle.disabled = !gridOn && (idle || shown.length === 0)
  for (const button of launcherBar.querySelectorAll('button')) button.disabled = idle
  reportFocus()
}

// The shortcuts the window lists are written from the bindings in use, so a rebound key shows its new name.
function shortcut(action: KeyAction): string {
  return formatBinding(keys[action], isMac)
}

function paintShortcuts(): void {
  newTabButton.title = `New shell tab (${shortcut('new-shell')})`
  gridToggle.title = `Show this space's tabs in a grid (${shortcut('grid-toggle')}). ${shortcut('grid-tab')} puts the focused tab in it.`
  const hidden = appEl.classList.contains('sidebar-hidden')
  sidebarToggle.title = `${hidden ? 'Show' : 'Hide'} the sidebar (${shortcut('sidebar-toggle')})`
}

// The root's unfocused class pauses the spinners: the window is in the background or the page is hidden.
function paintFocus(): void {
  document.documentElement.classList.toggle('unfocused', !windowFocused || document.hidden)
}

// The core needs the tab on screen and whether the window has focus, to decide what to notify and mark seen.
function reportFocus(): void {
  if (demoMode) return
  const params = { tabId: active?.id || null, windowFocused }
  const key = JSON.stringify(params)
  if (key === sentFocus) return
  sentFocus = key
  // Not shown in the status line: during a reconnect that would replace the reconnect message. The next paint or reconnect sends it again.
  bridge.rpc('attention.focus', params).catch((error: unknown) => {
    sentFocus = null
    console.error(error)
  })
}

function focusActive(): void {
  if (active && !active.pane.hidden) {
    active.view.fit()
    active.view.term.focus()
  }
}

function activate(tab: Tab): void {
  recentBySpace.set(tab.spaceId, visited(recentBySpace.get(tab.spaceId) ?? [], tab))
  selectSpace(tab.spaceId)
  focusActive()
}

// Shows the space's most recently visited tab, or its first tab, or nothing when the space has no tabs.
function selectSpace(spaceId: string | null): void {
  activeSpace = spaceId
  const remembered = spaceId ? recentBySpace.get(spaceId)?.[0] : undefined
  active = remembered && order.includes(remembered) ? remembered : (order.find((tab) => tab.spaceId === spaceId) ?? null)
  paint()
}

function renderSpaces(): void {
  const all = [...spaces.values()]
  // A space's indicator is the most urgent state among its own tabs; a worktree's tabs count only towards itself.
  const states = rollupSpaces(
    all.map((space) => space.id),
    order.map((tab) => ({ spaceId: tab.spaceId, state: stateOf(tab) })),
  )
  const top = all.filter((space) => !space.parent || !spaces.has(space.parent))
  spaceList.replaceChildren(
    ...top.map((space) => {
      const item = document.createElement('li')
      item.append(spaceButton(space, states.get(space.id) ?? 'idle'))
      const children = all.filter((child) => child.parent === space.id)
      if (children.length > 0) {
        const nested = document.createElement('ul')
        nested.className = 'spaces nested'
        for (const child of children) {
          const li = document.createElement('li')
          li.append(spaceButton(child, states.get(child.id) ?? 'idle'))
          nested.append(li)
        }
        item.append(nested)
      }
      return item
    }),
  )
}

function spaceButton(space: SpaceInfo, state: AgentStateName): HTMLButtonElement {
  const worktree = space.parent !== null
  const button = document.createElement('button')
  button.type = 'button'
  button.className = worktree ? 'space worktree' : 'space'
  button.title = space.path
  const tile = element(
    'span',
    `space-tile tile-${tileIndex(space.name)}`,
    worktree ? '' : space.name.charAt(0).toUpperCase(),
  )
  if (worktree) tile.innerHTML = iconSvg('worktree')
  button.append(tile, element('span', 'space-name', space.name), element('span', 'space-branch', space.branch ?? ''))
  button.append(indicatorEl(state))
  if (space.id === activeSpace) button.setAttribute('aria-current', 'true')
  button.addEventListener('click', () => {
    selectSpace(space.id)
    focusActive()
  })
  return button
}

// Opens a shell tab in the active space. A launcher passes the line it types once the tab's first output arrives.
async function newShellTab(typed: string | null = null): Promise<void> {
  const spaceId = activeSpace
  const space = spaceId ? spaces.get(spaceId) : undefined
  if (!spaceId || !space) return
  const tab = createTab(spaceId, space.path, 'shell', null)
  try {
    const { id } = await bridge.rpc('tabs.open', {
      spaceId,
      cols: tab.view.term.cols,
      rows: tab.view.term.rows,
    })
    adopt(tab, id)
    await attach(tab)
    if (typed !== null) void bridge.rpc('tabs.write', { id, dataB64: toBase64(encoder.encode(`${typed}\r`)) }).catch(report)
    activate(tab)
  } catch (error) {
    removeTab(tab)
    report(error)
  }
}

// Cmd+1 to Cmd+9: focuses the space at that place in the sidebar order, with the tab it last showed. A place past the last space does nothing.
function focusSpace(place: number): void {
  const spaceId = spaceAt(sidebarSpaceOrder([...spaces.values()]), place)
  if (spaceId === null) return
  selectSpace(spaceId)
  focusActive()
}

// Cmd+Shift+G: the active tab goes into the grid, and the grid shows. A tab already in the grid goes out of it and shows full screen.
// A tenth tab is refused, with the reason in the status line.
function toggleGridTab(): void {
  if (!active) return
  if (active.inGrid) {
    active.inGrid = false
    gridOn = false
  } else if (canJoinGrid(gridTabs().length)) {
    active.inGrid = true
    gridOn = true
  } else {
    statusLine.textContent = 'The grid holds nine tabs. Take a tab out of it first.'
    return
  }
  paint()
}

// Cmd+Shift+N: adds a new space at the home folder (spaces.add always adds one), selects it, and opens one shell tab there.
async function newSpaceTab(): Promise<void> {
  const space = await bridge.rpc('spaces.add', { path: homeDir })
  spaces.set(space.id, space)
  selectSpace(space.id)
  await newShellTab()
}

// Starts a gone agent tab again under its own id; the core resumes the saved session.
async function resumeAgent(tab: Tab, kind: AgentKind): Promise<void> {
  const { cols, rows } = tab.view.term
  await bridge.rpc('tabs.create', {
    id: tab.id,
    command: AGENT_COMMANDS[kind],
    cwd: tab.spacePath,
    cols,
    rows,
    agent: { kind },
  })
  await attach(tab)
  activate(tab)
  await refreshAgents()
}

// The launcher buttons in the tab strip. A click opens a shell tab in the active space that types the launcher's line.
function renderLaunchers(launchers: Launcher[]): void {
  launcherBar.replaceChildren(
    ...launchers.map((launcher) => {
      const line = launcherLine(launcher)
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'new-tab'
      button.textContent = launcher.label
      button.title = line
      button.disabled = activeSpace === null || refused !== null
      button.addEventListener('click', () => void newShellTab(line))
      return button
    }),
  )
}

// Applies the config in use: settings, keys, theme, layout and launchers. Notes about files that do not validate go to the status line.
function applyConfig(snapshot: ConfigSnapshot): void {
  const { values } = snapshot
  keys = values.keys
  applySettings(document.documentElement, values.settings)
  themeTokens = applyTheme(document.documentElement, values.theme, themeTokens)
  applyLayout(
    sidebar,
    { spaces: byId('section-spaces'), agents: byId('section-agents') },
    values.layout.sidebarOrder,
    sidebar.querySelector<HTMLElement>('.sidebar-foot'),
  )
  renderLaunchers(values.launchers)
  paintShortcuts()
  paintEmpty()
  const notes = Object.values(snapshot.notes).join(' ')
  if (notes !== '') statusLine.textContent = notes
  else if (statusLine.textContent === noteShown) statusLine.textContent = ''
  noteShown = notes
}

async function loadConfig(): Promise<void> {
  applyConfig(await bridge.rpc('config.get', {}))
}

async function refreshAgents(): Promise<void> {
  const list = await bridge.rpc('agents.list', {})
  agents.clear()
  for (const agent of list) agents.set(agent.tabId, agent)
  renderStates()
}

// Every place that shows a tab's state: the tab strip, the pane headers, the space tiles and the agents list. A state
// change repaints all of them, not only the list; paint() does the same when the tabs themselves change.
function renderStates(): void {
  for (const tab of order) paintTab(tab)
  renderSpaces()
  renderAgents()
}

function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function agentRow(row: AgentRow): HTMLLIElement {
  const { tab, agent } = row
  const li = document.createElement('li')
  li.className = tab.exited ? 'agent-row gone' : 'agent-row'

  const focus = document.createElement('button')
  focus.type = 'button'
  focus.className = 'agent'
  focus.title = tabLabel(tab)
  if (tab === active) focus.setAttribute('aria-current', 'true')
  const age = element('span', 'agent-age', formatAge(Date.now() - agent.since))
  age.dataset.since = String(agent.since)
  focus.append(markEl(tab.kind), element('span', 'agent-label', tabName(tab)), age, indicatorEl(stateOf(tab)))
  focus.addEventListener('click', () => activate(tab))
  li.append(focus)

  if (agent.resumable) {
    const resume = document.createElement('button')
    resume.type = 'button'
    resume.className = 'agent-resume'
    resume.textContent = 'Resume'
    resume.addEventListener('click', () => {
      resume.disabled = true
      resumeAgent(tab, agent.agent).catch((error: unknown) => {
        resume.disabled = false
        report(error)
      })
    })
    li.append(resume)
  }
  return li
}

// Rebuilds the sidebar list: one group per space, in the space order. Within a group, the most urgent row comes first.
function renderAgents(): void {
  const rows: AgentRow[] = []
  for (const agent of agents.values()) {
    const tab = tabs.get(agent.tabId)
    if (tab) rows.push({ spaceId: tab.spaceId, tabNumber: tab.number, agent, exited: tab.exited, tab })
  }
  agentsEmpty.hidden = rows.length > 0
  agentList.replaceChildren(
    ...groupAgents([...spaces.keys()], rows).map((group) => {
      const section = document.createElement('li')
      section.className = 'agent-group'
      const list = document.createElement('ul')
      list.className = 'agent-rows'
      list.append(...group.rows.map(agentRow))
      section.append(element('h3', 'agent-group-name', spaceName(group.spaceId)), list)
      return section
    }),
  )
}

// Only the ages are rewritten on the timer, so a click on a row is never lost to a rebuild.
function refreshAges(): void {
  const now = Date.now()
  for (const age of agentList.querySelectorAll<HTMLElement>('.agent-age')) {
    age.textContent = formatAge(now - Number(age.dataset.since))
  }
}

// Brings the page in line with the core: spaces and their tabs are listed, alive tabs are shown and reattached, gone ones are marked.
async function resync(): Promise<void> {
  const state = await bridge.rpc('spaces.list', {})
  spaces.clear()
  for (const space of state.spaces) spaces.set(space.id, space)
  refused = state.refused
  if (refused) statusLine.textContent = `State file refused: ${refused}`

  const alive = new Set(state.tabs.filter((info) => info.alive).map((info) => info.id))
  if (state.refused === null) {
    for (const tab of order) if (!alive.has(tab.id)) markExited(tab)
  }
  for (const info of state.tabs) {
    const kind: TabKind = info.kind === 'terminal' ? 'shell' : info.kind
    const existing = tabs.get(info.id)
    if (existing) {
      existing.label = info.label
      existing.kind = kind
    }
    if (info.alive) {
      if (existing) {
        await attach(existing)
      } else {
        const tab = createTab(info.spaceId, info.spacePath, kind, info.label)
        adopt(tab, info.id)
        await attach(tab)
      }
    } else if (!existing) {
      const tab = createTab(info.spaceId, info.spacePath, kind, info.label)
      adopt(tab, info.id)
      markExited(tab, info.exitCode)
    }
  }

  if (!activeSpace || !spaces.has(activeSpace)) activeSpace = state.spaces[0]?.id ?? null
  selectSpace(activeSpace)
  await refreshAgents()
}

bridge.on('tabs.output', ({ id, dataB64 }) => {
  const tab = tabs.get(id)
  if (!tab) return
  deliver(tab, fromBase64(dataB64))
})

bridge.on('tabs.exit', ({ id, exitCode }) => {
  const tab = tabs.get(id)
  if (tab) markExited(tab, exitCode)
  refreshAgents().catch(report)
})

bridge.on('status.changed', (change) => {
  const previous = agents.get(change.tabId)
  agents.set(change.tabId, {
    tabId: change.tabId,
    agent: change.agent,
    state: change.state,
    ...(change.reason ? { reason: change.reason } : {}),
    since: change.since,
    source: change.source,
    resumable: previous?.resumable ?? false,
  })
  renderStates()
  // resumable depends on the holder's liveness, which the change does not carry; the core's list settles it.
  refreshAgents().catch(report)
})

bridge.on('attention.notify', (notice) => {
  const tab = tabs.get(notice.tabId)
  const title = tab ? tabLabel(tab) : notice.tabId
  invoke('notify', { title, body: noticeBody(notice), sound: playSound(notice) }).catch(report)
})

bridge.on('config.changed', applyConfig)

// The CLI asked for a tab: its space and tab are shown, then the window comes forward. An unknown tab only raises the window.
bridge.on('tabs.focus', ({ id }) => {
  const tab = tabs.get(id)
  if (tab) activate(tab)
  invoke('raise_window').catch(report)
})

// The CLI closed the tab: it leaves the strip and the agents list at once, not at the next resync.
bridge.on('tabs.closed', ({ id }) => {
  const tab = tabs.get(id)
  agents.delete(id)
  if (tab) removeTab(tab)
  else renderAgents()
})

bridge.onStatus((status) => {
  if (status === 'closed') {
    statusLine.textContent = 'Reconnecting to the core...'
    return
  }
  statusLine.textContent = ''
  // A new core socket has no focus yet, so the focus is sent again. The config may have changed while the core was down.
  sentFocus = null
  reportFocus()
  loadConfig().catch(report)
  resync().catch(report)
})

new ResizeObserver(() => fitShown()).observe(terminals)
gridToggle.addEventListener('click', () => {
  const shown = gridTabs()
  // Showing the grid focuses its first pane when the focused tab is not one of them.
  if (!gridOn && shown.length > 0 && (active === null || !shown.includes(active))) activate(shown[0])
  gridOn = !gridOn
  gridToggle.setAttribute('aria-pressed', String(gridOn))
  paint()
})
// The button and Cmd+B both come here, so they show the same state. The state is kept in the window's storage across a reload.
function storage(): KeyValueStore | null {
  try {
    return localStorage
  } catch {
    return null
  }
}
function showSidebar(hidden: boolean): void {
  appEl.classList.toggle('sidebar-hidden', hidden)
  sidebarToggle.setAttribute('aria-label', hidden ? 'Show the sidebar' : 'Hide the sidebar')
  paintShortcuts()
}
sidebarToggle.addEventListener('click', () => {
  const hidden = !appEl.classList.contains('sidebar-hidden')
  showSidebar(hidden)
  writeSidebarHidden(storage(), hidden)
})
showSidebar(readSidebarHidden(storage()))
byId('integrations-open').addEventListener('click', () => integrationPanel.open())
bridge.on('integration.prompt', ({ agent }) => {
  integrationPanel.ask(agent).catch(report)
})
installCliButton.addEventListener('click', () => {
  installCliButton.disabled = true
  invoke<string>('install_cli')
    .then((path) => {
      statusLine.textContent = `Installed ${path}`
    })
    .catch(report)
    .finally(() => {
      installCliButton.disabled = false
    })
})
newTabButton.addEventListener('click', () => void newShellTab())
// Key bindings are read in the capture phase, so a matched key does not also reach the terminal. While the rename modal is open they wait.
window.addEventListener(
  'keydown',
  (event) => {
    if (renameModal.isOpen() || integrationPanel.isOpen()) return
    const action = findAction(keys, event, isMac)
    if (action === null) return
    event.preventDefault()
    event.stopPropagation()
    keyActions[action]()
  },
  { capture: true },
)
setInterval(refreshAges, AGE_REFRESH_MS)
document.addEventListener('visibilitychange', paintFocus)

// The bundled fonts load before the first terminal opens, so xterm measures Geist Mono and not a fallback.
async function loadFonts(): Promise<void> {
  await document.fonts.load(`${terminalFontSize()}px ${tokenValue('--font-mono')}`).catch(report)
}

// The states page: the fabricated rows, through the same rendering, with no core and no Tauri call.
async function startDemo(rows: DemoRows): Promise<void> {
  demoMode = true
  windowFocused = true
  homeDir = rows.home
  for (const space of rows.spaces) spaces.set(space.id, space)
  for (const agent of rows.agents) agents.set(agent.tabId, agent)
  for (const item of rows.tabs) {
    const tab = createTab(item.spaceId, spaces.get(item.spaceId)?.path ?? '', item.kind, item.label)
    tab.exited = item.exited
    adopt(tab, item.id)
  }
  paintFocus()
  selectSpace(rows.spaces[0]?.id ?? null)
}

async function start(): Promise<void> {
  if (import.meta.env.DEV) {
    byId('stress-link').hidden = false
    const demo = await import('./demo/states.ts')
    if (demo.isDemoStates(window.location, import.meta.env.DEV)) {
      await loadFonts()
      await startDemo(demo.demoRows())
      return
    }
  }
  const env = await invoke<EnvInfo>('env_info')
  homeDir = env.home
  const appWindow = getCurrentWindow()
  windowFocused = await appWindow.isFocused()
  await appWindow.onFocusChanged(({ payload }: { payload: boolean }) => {
    windowFocused = payload
    paintFocus()
    reportFocus()
  })
  paintFocus()
  await loadFonts()
  await bridge.connect()
  await loadConfig()
  await resync()
  await integrationPanel.ask().catch(report)
}

document.documentElement.classList.toggle('mac', isMac)
start().catch((error: unknown) => {
  report(error instanceof Error ? `Could not start: ${error.message}` : error)
})
