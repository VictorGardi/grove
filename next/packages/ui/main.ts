import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { createBridge, fromBase64, toBase64 } from './bridge.ts'
import { createSoundGate, noticeBody } from './alerts.ts'
import { applyLayout, applySettings, applyTheme, findAction, launcherLine } from './config.ts'
import { openTerminal, type TerminalView } from './terminal.ts'
import { gridMembers, gridShape, paneSpans } from './grid/layout.ts'
import type { AgentInfo, AgentStateName, ConfigSnapshot, KeyAction, Launcher, SpaceInfo } from '../protocol/messages.ts'
import type { AgentKind } from '../core/status/adapter.ts'
import { DEFAULT_VALUES } from '../core/config/schema.ts'
import './styles.css'

interface EnvInfo {
  home: string
}

interface Tab {
  id: string
  spacePath: string
  attached: boolean
  exited: boolean
  queue: Uint8Array[] | null
  host: HTMLDivElement
  button: HTMLButtonElement
  view: TerminalView
}

const bridge = createBridge()
const encoder = new TextEncoder()
const tabs = new Map<string, Tab>()
const order: Tab[] = []
const spaces = new Map<string, SpaceInfo>()
const activeBySpace = new Map<string, Tab>()
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
const playSound = createSoundGate()

const tabStrip = byId('tabs')
const terminals = byId('terminals')
const statusLine = byId('status')
const spaceList = byId('spaces')
const addSpaceForm = byId('add-space') as HTMLFormElement
const spacePathInput = byId('space-path') as HTMLInputElement
const newTabButton = byId('new-tab') as HTMLButtonElement
const gridToggle = byId('grid-toggle') as HTMLButtonElement
const newAgentButtons = [
  { kind: 'claude', button: byId('new-claude') as HTMLButtonElement },
  { kind: 'opencode', button: byId('new-opencode') as HTMLButtonElement },
  { kind: 'copilot', button: byId('new-copilot') as HTMLButtonElement },
] satisfies Array<{ kind: AgentKind; button: HTMLButtonElement }>
const agentList = byId('agents')
const agentsEmpty = byId('agents-empty')
const installCliButton = byId('install-cli') as HTMLButtonElement
const sidebar = byId('sidebar')
const launcherBar = byId('launchers')
// The buttons a key binding presses; a disabled button ignores the press, as it does a click.
const keyButtons: Record<KeyAction, HTMLButtonElement> = {
  'grid-toggle': gridToggle,
  'new-shell': newTabButton,
  'new-claude': byId('new-claude') as HTMLButtonElement,
  'new-opencode': byId('new-opencode') as HTMLButtonElement,
  'new-copilot': byId('new-copilot') as HTMLButtonElement,
}

// The command the window starts; the core builds the args from the agent kind.
const AGENT_COMMANDS: Record<AgentKind, string> = { claude: 'claude', opencode: 'opencode', copilot: 'copilot' }
const AGENT_LABELS: Record<AgentKind, string> = { claude: 'Claude', opencode: 'OpenCode', copilot: 'Copilot' }

// The sidebar groups agents in this order; the state names match the core's.
const AGENT_GROUPS: Array<{ state: AgentStateName; label: string }> = [
  { state: 'needs-you', label: 'Needs you' },
  { state: 'working', label: 'Working' },
  { state: 'finished', label: 'Finished' },
  { state: 'idle', label: 'Idle' },
  { state: 'unknown', label: 'Unknown' },
]
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

function spaceName(path: string): string {
  return spaces.get(path)?.name ?? path
}

// The same label the tab button's title shows: the space name and the tab's number in it.
function tabLabel(tab: Tab): string {
  const number = order.filter((other) => other.spacePath === tab.spacePath).indexOf(tab) + 1
  return `${spaceName(tab.spacePath)}: tab ${number}`
}

function createTab(spacePath: string): Tab {
  const host = document.createElement('div')
  host.className = 'term-host'
  host.hidden = true
  terminals.append(host)

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'tab'
  button.setAttribute('role', 'tab')
  button.addEventListener('click', () => activate(tab))
  tabStrip.append(button)
  host.addEventListener('click', () => activate(tab))

  const tab: Tab = {
    id: '',
    spacePath,
    attached: false,
    exited: false,
    queue: null,
    host,
    button,
    view: undefined as unknown as TerminalView,
  }
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

function removeTab(tab: Tab): void {
  tab.host.remove()
  tab.button.remove()
  if (tab.id) tabs.delete(tab.id)
  const index = order.indexOf(tab)
  if (index !== -1) order.splice(index, 1)
  if (active === tab) active = null
  paint()
}

function deliver(tab: Tab, bytes: Uint8Array): void {
  if (tab.queue) tab.queue.push(bytes)
  else tab.view.write(bytes)
}

function markExited(tab: Tab, exitCode: number | null = null): void {
  if (tab.exited) return
  tab.exited = true
  tab.attached = false
  tab.button.classList.add('exited')
  const code = exitCode === null ? '' : ` with code ${exitCode}`
  deliver(tab, encoder.encode(`\r\n\x1b[2m[process exited${code}]\x1b[0m\r\n`))
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
  tab.button.classList.remove('exited')
  const { cols, rows } = tab.view.term
  await bridge.rpc('tabs.resize', { id: tab.id, cols, rows })
}

// The active space's first nine tabs, in tab order: the panes grid mode shows.
function gridTabs(): Tab[] {
  const spaceTabs = order.filter((tab) => tab.spacePath === activeSpace)
  const ids = gridMembers(spaceTabs.map((tab) => tab.id))
  return spaceTabs.filter((tab) => ids.includes(tab.id))
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
    tab.host.style.gridColumn = span ? `span ${span.cols}` : ''
    tab.host.style.gridRow = span ? `span ${span.rows}` : ''
    tab.host.classList.toggle('pane-dim', span !== undefined && tab !== active)
  }
}

// Refits what is on screen: the grid's panes, else the active tab.
function fitShown(): void {
  for (const tab of gridOn ? gridTabs() : active ? [active] : []) tab.view.fit()
}

// Tabs of other spaces stay mounted and only hidden, so their shells keep running and their screens keep filling.
function paint(): void {
  // A tab the grid does not show cannot be focused there, so the grid gives way to it.
  if (gridOn && active && !gridTabs().includes(active)) gridOn = false
  const members = gridOn ? gridTabs() : []
  const counts = new Map<string, number>()
  for (const tab of order) {
    const on = tab === active
    const number = (counts.get(tab.spacePath) ?? 0) + 1
    counts.set(tab.spacePath, number)
    tab.button.textContent = String(number)
    tab.button.title = `${spaceName(tab.spacePath)}: tab ${number}`
    tab.button.hidden = tab.spacePath !== activeSpace
    tab.host.hidden = gridOn ? !members.includes(tab) : !on
    tab.button.classList.toggle('active', on)
    tab.button.setAttribute('aria-selected', String(on))
  }
  paintGrid(members)
  requestAnimationFrame(fitShown)
  renderSpaces()
  newTabButton.disabled = activeSpace === null || refused !== null
  gridToggle.setAttribute('aria-pressed', String(gridOn))
  gridToggle.disabled = !gridOn && (activeSpace === null || refused !== null)
  for (const { button } of newAgentButtons) button.disabled = activeSpace === null || refused !== null
  for (const button of launcherBar.querySelectorAll('button')) button.disabled = activeSpace === null || refused !== null
  for (const control of addSpaceForm.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')) {
    control.disabled = refused !== null
  }
  reportFocus()
}

// The core needs the tab on screen and whether the window has focus, to decide what to notify and mark seen.
function reportFocus(): void {
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
  if (active && !active.host.hidden) {
    active.view.fit()
    active.view.term.focus()
  }
}

function activate(tab: Tab): void {
  activeBySpace.set(tab.spacePath, tab)
  selectSpace(tab.spacePath)
  focusActive()
}

// Shows the space's last active tab, or its first tab, or nothing when the space has no tabs.
function selectSpace(path: string | null): void {
  activeSpace = path
  const remembered = path ? activeBySpace.get(path) : undefined
  active = remembered && order.includes(remembered) ? remembered : (order.find((tab) => tab.spacePath === path) ?? null)
  paint()
}

function renderSpaces(): void {
  const all = [...spaces.values()]
  const top = all.filter((space) => !space.parent || !spaces.has(space.parent))
  spaceList.replaceChildren(
    ...top.map((space) => {
      const item = document.createElement('li')
      item.append(spaceButton(space, true))
      const children = all.filter((child) => child.parent === space.path)
      if (children.length > 0) {
        const nested = document.createElement('ul')
        nested.className = 'spaces nested'
        for (const child of children) {
          const li = document.createElement('li')
          li.append(spaceButton(child, false))
          nested.append(li)
        }
        item.append(nested)
      }
      return item
    }),
  )
}

function spaceButton(space: SpaceInfo, top: boolean): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'space'
  button.title = space.path
  if (top && space.repoName && space.repoName !== space.name) {
    const folder = document.createElement('span')
    folder.className = 'space-folder'
    folder.textContent = space.name
    button.append(space.repoName, ' ', folder)
  } else {
    button.textContent = space.name
  }
  if (space.path === activeSpace) button.setAttribute('aria-current', 'true')
  button.addEventListener('click', () => {
    selectSpace(space.path)
    focusActive()
  })
  return button
}

// Opens a shell tab in the active space. A launcher passes the line it types once the tab's first output arrives.
async function newShellTab(typed: string | null = null): Promise<void> {
  const spacePath = activeSpace
  if (!spacePath) return
  const tab = createTab(spacePath)
  try {
    const { id } = await bridge.rpc('tabs.open', {
      spacePath,
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

// Opens an agent tab in the space root. The core launches the agent and records the session.
async function newAgentTab(kind: AgentKind): Promise<void> {
  const spacePath = activeSpace
  if (!spacePath) return
  const tab = createTab(spacePath)
  try {
    const { id } = await bridge.rpc('tabs.create', {
      command: AGENT_COMMANDS[kind],
      cwd: spacePath,
      cols: tab.view.term.cols,
      rows: tab.view.term.rows,
      agent: { kind },
    })
    adopt(tab, id)
    await attach(tab)
    activate(tab)
    await refreshAgents()
  } catch (error) {
    removeTab(tab)
    report(error)
  }
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

function stateText(agent: AgentInfo): string {
  const name = agent.state === 'needs-you' ? 'needs you' : agent.state
  return agent.state === 'needs-you' && agent.reason ? `${name}: ${agent.reason}` : name
}

function element(tag: string, className: string, text = ''): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  node.textContent = text
  return node
}

function agentRow(agent: AgentInfo): HTMLLIElement {
  const tab = tabs.get(agent.tabId)
  const li = document.createElement('li')
  li.className = tab?.exited ? 'agent-row gone' : 'agent-row'

  const focus = document.createElement('button')
  focus.type = 'button'
  focus.className = 'agent'
  const label = tab ? tabLabel(tab) : agent.tabId
  focus.title = label
  const meta = element('span', 'agent-meta')
  const state = element('span', `agent-state state-${agent.state}`, stateText(agent))
  const age = element('span', 'agent-age', formatAge(Date.now() - agent.since))
  age.dataset.since = String(agent.since)
  meta.append(state, ' · ', age)
  const title = element('span', 'agent-title')
  title.append(element('span', 'agent-label', label), element('span', 'agent-kind', AGENT_LABELS[agent.agent]))
  focus.append(title, meta)
  focus.addEventListener('click', () => {
    if (tab) activate(tab)
  })
  li.append(focus)

  if (tab && agent.resumable) {
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

// Rebuilds the sidebar list. Empty groups are left out; within a group, the one waiting longest comes first.
function renderAgents(): void {
  const all = [...agents.values()]
  agentsEmpty.hidden = all.length > 0
  agentList.replaceChildren(
    ...AGENT_GROUPS.flatMap((group) => {
      const rows = all.filter((agent) => agent.state === group.state).sort((a, b) => a.since - b.since)
      if (rows.length === 0) return []
      const section = document.createElement('li')
      const heading = element('h3', 'agent-group', group.label)
      const list = document.createElement('ul')
      list.className = 'agent-rows'
      list.append(...rows.map(agentRow))
      section.append(heading, list)
      return [section]
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

async function addSpace(): Promise<void> {
  const typed = spacePathInput.value.trim()
  if (!typed) return
  const path = typed === '~' || typed.startsWith('~/') ? homeDir + typed.slice(1) : typed
  const space = await bridge.rpc('spaces.add', { path })
  await resync()
  selectSpace(space.path)
  focusActive()
}

// Brings the page in line with the core: spaces and their tabs are listed, alive tabs are shown and reattached, gone ones are marked.
async function resync(): Promise<void> {
  const state = await bridge.rpc('spaces.list', {})
  spaces.clear()
  for (const space of state.spaces) spaces.set(space.path, space)
  refused = state.refused
  if (refused) statusLine.textContent = `State file refused: ${refused}`

  const alive = new Set(state.tabs.filter((info) => info.alive).map((info) => info.id))
  if (state.refused === null) {
    for (const tab of order) if (!alive.has(tab.id)) markExited(tab)
  }
  for (const info of state.tabs) {
    const existing = tabs.get(info.id)
    if (info.alive) {
      if (existing) {
        await attach(existing)
      } else {
        const tab = createTab(info.spacePath)
        adopt(tab, info.id)
        await attach(tab)
      }
    } else if (!existing) {
      const tab = createTab(info.spacePath)
      adopt(tab, info.id)
      markExited(tab, info.exitCode)
    }
  }

  if (!activeSpace || !spaces.has(activeSpace)) activeSpace = state.spaces[0]?.path ?? null
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
  renderAgents()
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
  if (tab) removeTab(tab)
  agents.delete(id)
  renderAgents()
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
  gridOn = !gridOn
  gridToggle.setAttribute('aria-pressed', String(gridOn))
  paint()
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
// Key bindings are read in the capture phase, so a matched key does not also reach the terminal.
window.addEventListener(
  'keydown',
  (event) => {
    const action = findAction(keys, event, isMac)
    if (action === null) return
    event.preventDefault()
    event.stopPropagation()
    keyButtons[action].click()
  },
  { capture: true },
)
for (const { kind, button } of newAgentButtons) {
  button.addEventListener('click', () => void newAgentTab(kind))
}
setInterval(refreshAges, AGE_REFRESH_MS)
addSpaceForm.addEventListener('submit', (event) => {
  event.preventDefault()
  addSpace().catch(report)
})

async function start(): Promise<void> {
  if (import.meta.env.DEV) byId('stress-link').hidden = false
  const env = await invoke<EnvInfo>('env_info')
  homeDir = env.home
  spacePathInput.value = env.home
  const appWindow = getCurrentWindow()
  windowFocused = await appWindow.isFocused()
  await appWindow.onFocusChanged(({ payload }: { payload: boolean }) => {
    windowFocused = payload
    reportFocus()
  })
  await bridge.connect()
  await loadConfig()
  await resync()
}

start().catch((error: unknown) => {
  report(error instanceof Error ? `Could not start: ${error.message}` : error)
})
