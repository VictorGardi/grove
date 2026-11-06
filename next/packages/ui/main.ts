import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { createBridge, fromBase64, toBase64 } from './bridge.ts'
import { createSoundGate, noticeBody, soundFile } from './alerts.ts'
import { readSound, writeSound } from './sound-pref.ts'
import { THEMES, applyThemeChoice, isThemeId, readTheme, writeTheme } from './theme-pref.ts'
import { applyLayout, applySettings, applyTheme, findAction, formatBinding, launcherLine } from './config.ts'
import { openTerminal, terminalFontSize, tokenValue, type TerminalView } from './terminal.ts'
import { canJoinGrid, gridMembers, gridShape, paneSpans } from './grid/layout.ts'
import { previousOf, stepFrom, visited } from './recent-tabs.ts'
import { PANE_DIM_RANGE, readPaneDim, writePaneDim } from './pane-dim.ts'
import { readSidebarHidden, writeSidebarHidden, type KeyValueStore } from './sidebar-state.ts'
import { readViewState, writeViewState } from './view-state.ts'
import { groupAgents, jumpTargets, nextUrgent, shortFolder, sidebarSpaceOrder, spaceAt, tabStateOf, tileIndex, urgentTabs } from './sidebar-model.ts'
import { createTabPill, type TabPill } from './tab-pill.ts'
import { createNotesEditor } from './notes-editor.ts'
import { createNotesPanel } from './notes-panel.ts'
import { createDock } from './dock.ts'
import { settled } from './diff-model.ts'
import { createDiffPanel } from './diff-panel.ts'
import { createRenameModal } from './rename-modal.ts'
import { createContextMenu } from './context-menu.ts'
import { createSpaceDialog } from './space-dialog.ts'
import { createIntegrationPanel } from './integrations.ts'
import { createKeysPanel } from './keys-panel.ts'
import { indicatorClass, indicatorLabel } from './indicator.ts'
import { agentIconSvg, iconSvg } from './icons.ts'
import { rollupSpaces } from '../protocol/rollup.ts'
import { ERROR_CODES } from '../protocol/messages.ts'
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
  // Whether the human put the tab in the grid, saved with the window's view state.
  inGrid: boolean
  attached: boolean
  attaching: Promise<void> | null
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
// Whether the window is connected to the core: the changes panel says so instead of showing an empty diff.
let coreConnected = false
let activeSpace: string | null = null
let refused: string | null = null
let homeDir = ''
let windowFocused = false
// The config in use: the key bindings, the theme tokens set on the root, and the note the status line shows for them.
let keys: Record<KeyAction, string> = DEFAULT_VALUES.keys
let themeTokens: string[] = []
let noteShown = ''
const isMac = navigator.platform.startsWith('Mac')
// Grid mode shows the tabs the human put in it, across spaces.
let gridOn = false
let viewStateReady = false
// The last attention.focus sent, as a key; an identical one is skipped until a reconnect clears it.
let sentFocus: string | null = null
// The states page (?demo=states) runs without a core: nothing is sent to it.
let demoMode = false
const playSound = createSoundGate()
let soundOn = readSound(storage())
// The chosen theme goes on the root before the first terminal opens, so every terminal starts with its colours.
let themeId = readTheme(storage())
applyThemeChoice(document.documentElement, themeId)

const appEl = byId('app')
const contextMenu = createContextMenu(document.body, { closed: focusActive })
const spaceDialog = createSpaceDialog(document.body)
const tabStrip = byId('tabs')
const terminals = byId('terminals')
const statusLine = byId('status')
const spaceList = byId('spaces')
const gridToggle = byId('grid-toggle') as HTMLButtonElement
const paneDim = byId('pane-dim') as HTMLInputElement
const agentList = byId('agents')
const agentsEmpty = byId('agents-empty')
const installCliButton = byId('install-cli') as HTMLButtonElement
const installCliStatus = byId('install-cli-status')
const soundToggle = byId('sound-toggle') as HTMLButtonElement
const restartCoreButton = byId('restart-core') as HTMLButtonElement
const coreIndicator = byId('core-indicator')
const coreStatusText = byId('core-status-text')
const themeSelect = byId('theme-select') as HTMLSelectElement
const settingsTabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.settings-tab'))
const settingsSections = Array.from(document.querySelectorAll<HTMLElement>('.settings-section'))
const sidebar = byId('sidebar')
const sidebarToggle = byId('sidebar-toggle') as HTMLButtonElement
const urgentBanner = byId('urgent-banner') as HTMLButtonElement
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
// The dock is the right sidebar: one panel at a time, each with a key binding. The notes are the first panel; they are one markdown
// file kept by the core. The dock is not modal, so key bindings keep working while a panel has focus.
const dock = createDock(
  {
    app: appEl,
    dock: byId('dock'),
    title: byId('dock-title'),
    status: byId('dock-status'),
    meta: byId('dock-meta'),
    error: byId('dock-error'),
    body: byId('dock-body'),
    close: byId('dock-close') as HTMLButtonElement,
    edge: byId('dock-edge'),
  },
  {
    store: storage(),
    applyWidth: (width) => appEl.style.setProperty('--dock-width', `${width}px`),
    closed: focusActive,
    changed: (id) => {
      byId('notes-toggle').setAttribute('aria-pressed', String(id === 'notes'))
      byId('diff-toggle').setAttribute('aria-pressed', String(id === 'diff'))
    },
  },
)
dock.register(
  createNotesPanel({
    read: async () => (await bridge.rpc('notes.read', {})).text,
    write: (text) => bridge.rpc('notes.write', { text }),
    createEditor: createNotesEditor,
  }),
)
// The changes panel shows the active tab's folder. It names the tab and the core finds the folder; it asks again on the triggers below
// (tab switch, an agent that stopped working, a new connection), the core never pushes.
const diffPanel = createDiffPanel({
  tab: () => active?.id ?? null,
  connected: () => coreConnected,
  get: (tabId, mode, base, showUntracked) => bridge.rpc('diff.get', { tabId, mode, base, showUntracked }),
  bases: (tabId) => bridge.rpc('diff.bases', { tabId }),
  prefs: (tabId) => bridge.rpc('diff.prefs.get', { tabId }),
  setPrefs: (tabId, prefs) => bridge.rpc('diff.prefs.set', { tabId, ...prefs }),
})
dock.register(diffPanel.panel)
// Keys: the settings section that rebinds an action. The core checks and saves it, then every window applies the new config.
const keysPanel = createKeysPanel(byId('keys-list'), byId('keys-error'), {
  keys: () => keys,
  defaults: DEFAULT_VALUES.keys,
  isMac,
  save: async (action, binding) => applyConfig(await bridge.rpc('config.setKey', { action, binding })),
})
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
  // Like the tab-strip button this replaced, the key does nothing with no space open or a refused one.
  'new-shell': () => {
    if (activeSpace !== null && refused === null) void newShellTab()
  },
  'new-space': () => void newSpaceTab().catch(report),
  'close-tab': () => {
    if (active) void closeTab(active).catch(report)
  },
  'previous-tab': () => {
    const recent = activeSpace === null ? [] : (recentBySpace.get(activeSpace) ?? [])
    // A tab not visited yet is not in the recent list, so with no other visited tab the key steps along the strip instead of doing nothing.
    const previous = previousOf(recent, active) ?? stepFrom(spaceTabs(), active, 1)
    if (previous) activate(previous)
  },
  'grid-tab': () => toggleGridTab(),
  'next-urgent': () => jumpToUrgent(),
  'sidebar-toggle': () => sidebarToggle.click(),
  notes: () => void dock.toggle('notes').catch(report),
  diff: () => void dock.toggle('diff').catch(report),
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
  return tab.label || String(tab.number)
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
  const mark = element('span', `agent-mark mark-${kind}`)
  mark.innerHTML = kind === 'shell' ? iconSvg('terminal') : agentIconSvg(kind)
  return mark
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
    attaching: null,
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
  // The host's own size is what the terminal fits to, so it refits whenever that changes, shown or not.
  new ResizeObserver(() => tab.view.fit()).observe(host)
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
  // The last tab of a space is a likely end of the space: ask, and leave the empty space alone when the answer is no.
  const space = spaces.get(tab.spaceId)
  if (space && !order.some((other) => other.spaceId === space.id)) void askRemoveSpace(space, true).then(focusActive)
}

function baseName(folder: string): string {
  return folder.split('/').filter(Boolean).pop() ?? folder
}

// Removes a space: its tabs close and it leaves the sidebar. A worktree's checkout is deleted too, and the dialog says so;
// git refuses a checkout with changes, and the dialog then keeps the space and shows git's reason.
async function askRemoveSpace(space: SpaceInfo, lastTab = false): Promise<boolean> {
  let refusal: string | null = null
  const removed = await askRemoveSpaceOnce(space, lastTab, (reason) => (refusal = reason))
  if (refusal === null) return removed
  return askForceRemove(space, refusal)
}

// Git said no to deleting the checkout: its message is shown, and the human may force it, losing what git refused to lose.
function askForceRemove(space: SpaceInfo, reason: string): Promise<boolean> {
  return spaceDialog.open({
    title: `Force remove worktree ${space.name}?`,
    text: `Git refused to remove ${space.path}:\n${reason.trim()}\n\nForcing deletes the checkout, including uncommitted changes.${space.branch ? ` The branch ${space.branch} stays.` : ''}`,
    confirm: 'Force remove',
    cancel: 'Keep space',
    danger: true,
    submit: async () => {
      await bridge.rpc('spaces.remove', { id: space.id, removeWorktree: true, force: true })
      dropSpace(space.id)
    },
  })
}

function askRemoveSpaceOnce(space: SpaceInfo, lastTab: boolean, refused: (reason: string) => void): Promise<boolean> {
  const count = order.filter((tab) => tab.spaceId === space.id).length
  const tabsLine = count === 0 ? '' : ` Its ${count === 1 ? 'tab closes' : `${count} tabs close`}.`
  const lead = lastTab ? 'That was the last tab. ' : ''
  return spaceDialog.open({
    title: space.worktree ? `Remove worktree ${space.name}?` : `Remove ${space.name}?`,
    text: space.worktree
      ? `${lead}This deletes the checkout at ${space.path}.${space.branch ? ` The branch ${space.branch} stays.` : ''} Git refuses if the checkout has changes.${tabsLine}`
      : `${lead}The folder ${space.path} is not touched.${tabsLine}`,
    confirm: space.worktree ? 'Remove worktree' : 'Remove space',
    cancel: lastTab ? 'Keep space' : 'Cancel',
    danger: space.worktree || !lastTab,
    submit: async () => {
      try {
        await bridge.rpc('spaces.remove', { id: space.id, removeWorktree: space.worktree })
      } catch (error) {
        // The dialog closes and the force question replaces it; any other failure stays inside this dialog.
        if ((error as { code?: number }).code !== ERROR_CODES.gitRefused) throw error
        return refused(error instanceof Error ? error.message : String(error))
      }
      dropSpace(space.id)
    },
  })
}

// Takes a space and its tabs out of the window. The core has already closed them; a second call finds nothing to do.
function dropSpace(spaceId: string): void {
  for (const tab of order.filter((other) => other.spaceId === spaceId)) {
    agents.delete(tab.id)
    removeTab(tab)
  }
  recentBySpace.delete(spaceId)
  spaces.delete(spaceId)
  if (activeSpace === spaceId) selectSpace(sidebarSpaceOrder([...spaces.values()])[0] ?? null)
  else paint()
}

function askRenameSpace(space: SpaceInfo): Promise<boolean> {
  return spaceDialog.open({
    title: 'Rename space',
    text: 'A name for the sidebar. The folder and the branch keep theirs. Empty goes back to the folder name.',
    input: { placeholder: baseName(space.path), value: space.label ?? '' },
    confirm: 'Save',
    hint: 'save',
    submit: async (name) => {
      await bridge.rpc('spaces.rename', { id: space.id, name })
      spaces.set(space.id, { ...space, name: name || baseName(space.path), label: name || null })
      paint()
    },
  })
}

// Adds a space on a checkout of the branch the human names, and opens a shell in it.
function askNewWorktree(space: SpaceInfo): Promise<boolean> {
  return spaceDialog.open({
    title: `New worktree of ${space.repoName ?? space.name}`,
    text: `A new space on a checkout in ~/.grove/worktrees/${space.repoName ?? space.name}/. A branch that exists is checked out; a new one starts from here.`,
    input: { placeholder: 'branch name' },
    confirm: 'Create',
    hint: 'create',
    submit: async (branch) => {
      const created = await bridge.rpc('worktrees.add', { spaceId: space.id, branch })
      spaces.set(created.id, created)
      selectSpace(created.id)
      await newShellTab()
    },
  })
}

// Lists the repo's worktrees that are not spaces yet; picking one adds it as a space and opens a shell in it.
async function askOpenWorktree(space: SpaceInfo): Promise<boolean> {
  const { worktrees } = await bridge.rpc('worktrees.list', { spaceId: space.id })
  return spaceDialog.open({
    title: `Open worktree of ${space.repoName ?? space.name}`,
    choices: worktrees.map((entry) => ({ label: baseName(entry.path), detail: entry.branch ?? 'detached', value: entry.path })),
    empty: 'Every worktree of this repo is already a space.',
    submit: async (folder) => {
      const added = await bridge.rpc('spaces.add', { path: folder })
      spaces.set(added.id, added)
      selectSpace(added.id)
      await newShellTab()
    },
  })
}

function openSpaceMenu(space: SpaceInfo, event: MouseEvent): void {
  event.preventDefault()
  const done = (): void => focusActive()
  contextMenu.open(
    [
      { label: 'Rename', icon: iconSvg('edit'), run: () => void askRenameSpace(space).then(done) },
      { label: 'New worktree', icon: iconSvg('branch'), run: () => void askNewWorktree(space).then(done) },
      { label: 'Open worktree', icon: iconSvg('branch'), run: () => void askOpenWorktree(space).then(done).catch(report) },
      { label: 'Close', icon: iconSvg('x'), separated: true, run: () => void askRemoveSpace(space).then(done) },
    ],
    event.clientX,
    event.clientY,
  )
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
function attach(tab: Tab): Promise<void> {
  if (tab.attaching) return tab.attaching
  const pending = attachScreen(tab).finally(() => { tab.attaching = null })
  tab.attaching = pending
  return pending
}

async function attachScreen(tab: Tab): Promise<void> {
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

// The tabs the human put in the grid, from any space, in tab order: the panes grid mode shows.
function gridTabs(): Tab[] {
  return gridMembers(order)
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
  tab.pill.update({ name, title: tabLabel(tab), state, inGrid: tab.inGrid })
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

// The bar under the panes: the active space's branch and how many agents are running in it.
// A click on the footer's branch copies its name; the name reads "copied" for a moment.
function copyBranch(): void {
  const name = activeSpace ? spaces.get(activeSpace)?.branch : null
  if (!name) return
  navigator.clipboard.writeText(name).then(() => {
    const label = byId('statusbar-branch').querySelector('span')
    if (!label) return
    label.textContent = 'copied'
    setTimeout(paintStatusbar, 1000)
  }, report)
}
byId('statusbar-branch').addEventListener('click', copyBranch)

function paintStatusbar(): void {
  const branch = byId('statusbar-branch')
  const space = activeSpace ? spaces.get(activeSpace) : undefined
  const name = space?.branch ?? null
  branch.hidden = !name
  branch.classList.toggle('worktree', space?.worktree === true)
  branch.title = name ? 'Copy the branch name' : ''
  branch.innerHTML = name ? `${iconSvg('branch')}<span></span>` : ''
  if (name) branch.querySelector('span')!.textContent = name
  const running = [...agents.values()].filter((agent) => {
    const tab = tabs.get(agent.tabId)
    return tab?.exited === false && tab.spaceId === activeSpace
  }).length
  byId('statusbar-agents').textContent = `${running} ${running === 1 ? 'agent' : 'agents'}`
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
  paintStatusbar()
  paintEmpty()
  diffPanel.retarget()
  const idle = activeSpace === null || refused !== null
  gridToggle.setAttribute('aria-pressed', String(gridOn))
  paneDim.hidden = !gridOn
  gridToggle.disabled = !gridOn && (idle || shown.length === 0)
  for (const button of launcherBar.querySelectorAll('button')) button.disabled = idle
  if (viewStateReady && !demoMode) {
    writeViewState(storage(), { gridOn, gridTabs: gridTabs().map((tab) => tab.id), activeSpace, activeTab: active?.id ?? null })
  }
  reportFocus()
}

// The shortcuts the window lists are written from the bindings in use, so a rebound key shows its new name.
function shortcut(action: KeyAction): string {
  return formatBinding(keys[action], isMac)
}

function paintShortcuts(): void {
  paintUrgent()
  byId('notes-toggle').title = `Notes (${shortcut('notes')})`
  byId('diff-toggle').title = `Changes (${shortcut('diff')})`
  gridToggle.title = `Show the tabs put in the grid, from any space, (${shortcut('grid-toggle')}). ${shortcut('grid-tab')} puts the focused tab in it.`
  const hidden = appEl.classList.contains('sidebar-hidden')
  sidebarToggle.title = `${hidden ? 'Show' : 'Hide'} the sidebar (${shortcut('sidebar-toggle')})`
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

// The tabs with something for the human, in any space (see urgentTabs). A gone tab shows idle, so it is not one.
function tabItems(): Array<{ id: string; tab: Tab; state: AgentStateName; since: number }> {
  return order.map((tab) => ({ id: tab.id, tab, state: stateOf(tab), since: agents.get(tab.id)?.since ?? 0 }))
}

function urgentItems(): ReturnType<typeof tabItems> {
  return urgentTabs(tabItems())
}

// Cmd+. and the footer banner: goes to the next tab that needs you or has finished, in any space; with none, to the next working one.
function jumpToUrgent(): void {
  const next = nextUrgent(jumpTargets(tabItems()), active?.id ?? null)
  if (next) activate(next.tab)
}

// The footer banner: how many tabs jumpToUrgent can reach, toned for the most urgent of them. Hidden when there are none.
function paintUrgent(): void {
  const urgent = urgentItems()
  urgentBanner.hidden = urgent.length === 0
  if (urgent.length === 0) return
  const tone = urgent[0].state
  urgentBanner.className = `urgent-banner tone-${tone}`
  const needing = urgent.filter((item) => item.state === 'needs-you').length
  const label = needing === 0 ? 'finished' : needing === urgent.length ? 'need you' : `· ${needing} need you`
  urgentBanner.replaceChildren(indicatorEl(tone), element('span', 'urgent-count', String(urgent.length)), element('span', 'urgent-label', label))
  urgentBanner.title = `Go to the next tab with something for you (${shortcut('next-urgent')})`
}

function activate(tab: Tab): void {
  recentBySpace.set(tab.spaceId, visited(recentBySpace.get(tab.spaceId) ?? [], tab))
  selectSpace(tab.spaceId, tab)
  focusActive()
}

// Shows the space's most recently visited tab, or its first tab, or nothing when the space has no tabs.
function selectSpace(spaceId: string | null, chosen?: Tab): void {
  activeSpace = spaceId
  const remembered = spaceId ? recentBySpace.get(spaceId)?.[0] : undefined
  // With the grid showing, a space that has a pane in it keeps the grid by focusing that pane.
  const gridPane = gridOn ? gridTabs().find((tab) => tab.spaceId === spaceId) : undefined
  active = chosen ?? gridPane ?? (remembered && order.includes(remembered) ? remembered : (order.find((tab) => tab.spaceId === spaceId) ?? null))
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
  const worktree = space.worktree || space.parent !== null
  const button = document.createElement('button')
  button.type = 'button'
  button.className = worktree ? 'space worktree' : 'space'
  button.title = space.path
  const tile = element(
    'span',
    worktree ? 'space-tile' : `space-tile tile-${tileIndex(space.name)}`,
    worktree ? '' : space.name.charAt(0).toUpperCase(),
  )
  if (worktree) tile.innerHTML = iconSvg('branch')
  button.append(tile, element('span', 'space-name', space.name), element('span', 'space-branch', worktree ? '' : (space.branch ?? '')))
  button.append(indicatorEl(state))
  if (space.id === activeSpace) button.setAttribute('aria-current', 'true')
  button.addEventListener('click', () => {
    selectSpace(space.id)
    focusActive()
  })
  if (!demoMode) button.addEventListener('contextmenu', (event) => openSpaceMenu(space, event))
  return button
}

// Opens a shell tab in the active space. A launcher passes the line it types once the tab's first output arrives.
async function newShellTab(typed: string | null = null): Promise<void> {
  const spaceId = activeSpace
  const space = spaceId ? spaces.get(spaceId) : undefined
  if (!spaceId || !space) return
  let tab: Tab | undefined
  try {
    const { id } = await bridge.rpc('tabs.open', {
      spaceId,
      cols: active?.view.term.cols ?? 80,
      rows: active?.view.term.rows ?? 24,
    })
    // The opened notification can arrive before this call's reply.
    tab = tabs.get(id) ?? createTab(spaceId, space.path, 'shell', null)
    if (!tab.id) adopt(tab, id)
    if (!tab.attached || tab.attaching) await attach(tab)
    if (typed !== null) void bridge.rpc('tabs.write', { id, dataB64: toBase64(encoder.encode(`${typed}\r`)) }).catch(report)
    activate(tab)
  } catch (error) {
    if (tab) removeTab(tab)
    report(error)
  }
}

// Cmd+1 to Cmd+9: focuses the space at that place in the sidebar order, with the tab it last showed. A place past the last space does nothing.
function spaceTabs(): Tab[] {
  return order.filter((tab) => tab.spaceId === activeSpace)
}

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

// Cmd+N: adds a new space at the home folder (spaces.add always adds one), selects it, and opens one shell tab there.
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
  // A core from before an action existed sends no binding for it: the default stands until the core is restarted.
  keys = { ...DEFAULT_VALUES.keys, ...values.keys }
  applySettings(document.documentElement, values.settings)
  themeTokens = applyTheme(document.documentElement, values.theme, themeTokens)
  applyLayout(
    sidebar,
    { spaces: byId('section-spaces'), agents: byId('section-agents') },
    values.layout.sidebarOrder,
    sidebar.querySelector<HTMLElement>('.sidebar-foot'),
  )
  renderLaunchers(values.launchers)
  keysPanel.render()
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
  syncKinds()
  renderStates()
}

// A tab's kind follows the agents list: an agent typed by hand into a shell tab turns the tab into an agent tab, and a tab whose
// agent ended turns back into a shell. Only tabs this function changed are turned back; a launched agent tab keeps its kind.
const detectedKinds = new Set<string>()
function syncKinds(): void {
  for (const tab of order) {
    const agent = agents.get(tab.id)
    if (agent && tab.kind === 'shell') {
      tab.kind = agent.agent
      detectedKinds.add(tab.id)
      tab.pill.root.querySelector('.agent-mark')?.replaceWith(markEl(tab.kind))
    } else if (!agent && detectedKinds.delete(tab.id)) {
      tab.kind = 'shell'
      tab.pill.root.querySelector('.agent-mark')?.replaceWith(markEl(tab.kind))
    }
  }
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
  const tail = element('span', 'agent-tail', '')
  if (tab.inGrid) {
    const grid = element('span', 'tab-grid', '')
    grid.title = 'In the grid'
    grid.innerHTML = iconSvg('grid')
    tail.append(grid)
  }
  tail.append(age)
  focus.append(markEl(tab.kind), element('span', 'agent-label', tabName(tab)), tail, indicatorEl(stateOf(tab)))
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
  paintUrgent()
  const rows: AgentRow[] = []
  for (const agent of agents.values()) {
    const tab = tabs.get(agent.tabId)
    if (tab) rows.push({ spaceId: tab.spaceId, tabNumber: tab.number, agent, exited: tab.exited, tab })
  }
  agentsEmpty.hidden = rows.length > 0
  paintStatusbar()
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
      // One tab that fails to attach is reported and the others still attach, so a bad tab cannot leave every terminal blank.
      if (existing) {
        await attach(existing).catch(report)
      } else {
        const tab = createTab(info.spaceId, info.spacePath, kind, info.label)
        adopt(tab, info.id)
        await attach(tab).catch(report)
      }
    } else if (!existing) {
      const tab = createTab(info.spaceId, info.spacePath, kind, info.label)
      adopt(tab, info.id)
      markExited(tab, info.exitCode)
    }
  }

  if (!viewStateReady && state.refused === null) {
    const saved = readViewState(storage())
    for (const tab of order) tab.inGrid = saved.gridTabs.includes(tab.id)
    gridOn = saved.gridOn && gridTabs().length > 0
    active = saved.activeTab ? tabs.get(saved.activeTab) ?? null : null
    if (gridOn && (!active || !active.inGrid)) active = gridTabs()[0]
    activeSpace = active?.spaceId ?? (saved.activeSpace && spaces.has(saved.activeSpace) ? saved.activeSpace : null)
    if (active) recentBySpace.set(active.spaceId, visited(recentBySpace.get(active.spaceId) ?? [], active))
    viewStateReady = true
  }
  if (!activeSpace || !spaces.has(activeSpace)) activeSpace = state.spaces[0]?.id ?? null
  selectSpace(activeSpace, active?.spaceId === activeSpace ? active : undefined)
  await refreshAgents()
}

bridge.on('tabs.output', ({ id, dataB64 }) => {
  const tab = tabs.get(id)
  if (!tab) return
  deliver(tab, fromBase64(dataB64))
})

bridge.on('tabs.opened', (info) => {
  let tab = tabs.get(info.id)
  if (!tab) {
    tab = createTab(info.spaceId, info.spacePath, info.kind === 'terminal' ? 'shell' : info.kind, info.label)
    adopt(tab, info.id)
  } else {
    tab.label = info.label
    tab.kind = info.kind === 'terminal' ? 'shell' : info.kind
  }
  attach(tab).then(paint).catch(report)
  refreshAgents().catch(report)
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
  syncKinds()
  renderStates()
  diffPanel.agentChanged(change.tabId, settled(previous?.state, change.state))
  // resumable depends on the holder's liveness, which the change does not carry; the core's list settles it.
  refreshAgents().catch(report)
})

bridge.on('attention.notify', (notice) => {
  const tab = tabs.get(notice.tabId)
  const title = tab ? tabLabel(tab) : notice.tabId
  invoke('notify', { title, body: noticeBody(notice), sound: soundOn ? playSound(notice) : null }).catch(report)
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

// Another window or the CLI removed a space: it leaves the sidebar at once.
bridge.on('spaces.removed', ({ id }) => dropSpace(id))

// A space was added or changed: the sidebar updates at once.
bridge.on('spaces.changed', (info) => {
  spaces.set(info.id, info)
  paint()
})

// A restart the human asked for: from the press until the window is connected to the new core again.
let coreRestart: { since: number; closed: boolean; timer: ReturnType<typeof setTimeout> } | null = null
const CORE_RESTART_GIVE_UP_MS = 20000

function showCoreRestart(text: string, busy: boolean): void {
  coreStatusText.textContent = text
  coreIndicator.hidden = !busy
  restartCoreButton.disabled = busy
}

function finishCoreRestart(): void {
  if (coreRestart === null) return
  clearTimeout(coreRestart.timer)
  const seconds = ((Date.now() - coreRestart.since) / 1000).toFixed(1)
  coreRestart = null
  showCoreRestart(`Core restarted in ${seconds} s. You can keep working.`, false)
}

restartCoreButton.addEventListener('click', () => {
  if (coreRestart !== null) return
  const timer = setTimeout(() => {
    coreRestart = null
    statusLine.textContent = ''
    showCoreRestart('The core did not come back. Close and reopen the window to start it.', false)
  }, CORE_RESTART_GIVE_UP_MS)
  coreRestart = { since: Date.now(), closed: false, timer }
  showCoreRestart('Restarting the core...', true)
  statusLine.textContent = 'Restarting the core...'
  // The core may drop the connection right behind its reply, so a dropped call is not an error: the reconnect tells. An answer with
  // an error code means the core is up but refused (an older core does not know the call), and no reconnect will follow.
  bridge.rpc('core.restart', {}).catch((failure: unknown) => {
    if (coreRestart === null || typeof (failure as { code?: unknown }).code !== 'number') return
    clearTimeout(coreRestart.timer)
    coreRestart = null
    statusLine.textContent = ''
    showCoreRestart('This core is too old to restart itself. Stop it once with: pkill -f packages/core/bin.ts. The holder starts a new one, and this button works from then on.', false)
  })
})

bridge.onStatus((status) => {
  coreConnected = status === 'open'
  if (status === 'closed') {
    diffPanel.connection(false)
    if (coreRestart !== null) coreRestart.closed = true
    statusLine.textContent = coreRestart !== null ? 'Restarting the core...' : 'Reconnecting to the core...'
    return
  }
  statusLine.textContent = ''
  if (coreRestart?.closed) finishCoreRestart()
  // A new core socket has no focus yet, so the focus is sent again. The config may have changed while the core was down.
  sentFocus = null
  reportFocus()
  loadConfig().catch(report)
  resync().catch(report)
  diffPanel.connection(true)
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
byId('sidebar-show').addEventListener('click', () => sidebarToggle.click())
sidebarToggle.addEventListener('click', () => {
  const hidden = !appEl.classList.contains('sidebar-hidden')
  showSidebar(hidden)
  writeSidebarHidden(storage(), hidden)
})
showSidebar(readSidebarHidden(storage()))
// The slider sets the unfocused panes' opacity over the theme's; it is shown with the grid.
const chosenDim = readPaneDim(storage())
if (chosenDim !== null) document.documentElement.style.setProperty('--pane-unfocused-opacity', String(chosenDim))
paneDim.value = String(chosenDim ?? (getComputedStyle(document.documentElement).getPropertyValue('--pane-unfocused-opacity').trim() || PANE_DIM_RANGE.max))
paneDim.addEventListener('input', () => {
  document.documentElement.style.setProperty('--pane-unfocused-opacity', paneDim.value)
  writePaneDim(storage(), Number(paneDim.value))
})
byId('new-space').addEventListener('click', () => void newSpaceTab().catch(report))
byId('notes-toggle').addEventListener('click', () => void dock.toggle('notes').catch(report))
byId('diff-toggle').addEventListener('click', () => void dock.toggle('diff').catch(report))
byId('settings-open').addEventListener('click', () => integrationPanel.open())
urgentBanner.addEventListener('click', () => jumpToUrgent())
bridge.on('integration.prompt', ({ agent }) => {
  integrationPanel.ask(agent).catch(report)
})
installCliButton.addEventListener('click', () => {
  installCliButton.disabled = true
  installCliStatus.textContent = ''
  invoke<string>('install_cli')
    .then((path) => {
      installCliStatus.textContent = `Installed ${path}`
    })
    .catch((failure: unknown) => {
      installCliStatus.textContent = `Could not install: ${failure instanceof Error ? failure.message : String(failure)}`
    })
    .finally(() => {
      installCliButton.disabled = false
    })
})
for (const theme of THEMES) {
  const option = document.createElement('option')
  option.value = theme.id
  option.textContent = theme.label
  themeSelect.append(option)
}
themeSelect.value = themeId
themeSelect.addEventListener('change', () => {
  if (!isThemeId(themeSelect.value)) return
  themeId = themeSelect.value
  applyThemeChoice(document.documentElement, themeId)
  writeTheme(storage(), themeId)
  // Open terminals read their colours when they open, so each one reads them again.
  for (const tab of tabs.values()) tab.view?.restyle()
})
soundToggle.setAttribute('aria-checked', String(soundOn))
soundToggle.addEventListener('click', () => {
  soundOn = !soundOn
  soundToggle.setAttribute('aria-checked', String(soundOn))
  writeSound(storage(), soundOn)
  // Turning it on plays the needs-you sound once, so the human hears that the switch and the volume work.
  if (soundOn) invoke('play_sound', { file: soundFile('needs-you') }).catch(report)
})
settingsTabs.forEach((tab) =>
  tab.addEventListener('click', () => {
    settingsTabs.forEach((other) => other.toggleAttribute('aria-current', other === tab))
    settingsSections.forEach((section) => (section.hidden = section.dataset.section !== tab.dataset.section))
  }),
)
// Key bindings are read in the capture phase, so a matched key does not also reach the terminal. While the rename modal is open they wait.
window.addEventListener(
  'keydown',
  (event) => {
    if (renameModal.isOpen() || integrationPanel.isOpen() || spaceDialog.isOpen() || contextMenu.isOpen()) return
    let action = findAction(keys, event, isMac)
    if (action === null && event.shiftKey) {
      // Shift added to the previous-tab key goes the other way, along the strip.
      const plain = { code: event.code, key: event.key, metaKey: event.metaKey, ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: false }
      if (findAction(keys, plain, isMac) === 'previous-tab') {
        event.preventDefault()
        event.stopPropagation()
        const back = stepFrom(spaceTabs(), active, -1)
        if (back) activate(back)
        return
      }
    }
    if (action === null) return
    event.preventDefault()
    event.stopPropagation()
    keyActions[action]()
  },
  { capture: true },
)
setInterval(refreshAges, AGE_REFRESH_MS)
// A window that comes back (from the background, or a night of sleep) repaints its terminals: the GPU may have dropped their contexts meanwhile.
function repaintTerminals(): void {
  for (const tab of order) tab.view.repaint()
  requestAnimationFrame(fitShown)
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) repaintTerminals()
})
window.addEventListener('focus', repaintTerminals)

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
  selectSpace(rows.spaces[0]?.id ?? null)
}

async function start(): Promise<void> {
  if (import.meta.env.DEV) {
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
      reportFocus()
  })
  await loadFonts()
  await bridge.connect()
  // The first connection reports no status (only a reconnect does), so the window notes it here.
  coreConnected = true
  await loadConfig()
  await resync()
  await integrationPanel.ask().catch(report)
}

document.documentElement.classList.toggle('mac', isMac)
start().catch((error: unknown) => {
  report(error instanceof Error ? `Could not start: ${error.message}` : error)
})
