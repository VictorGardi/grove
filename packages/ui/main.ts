import { invoke } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { createBridge, fromBase64, toBase64 } from './bridge.ts'
import { createSoundGate, noticeBody, soundFile } from './alerts.ts'
import { readSound, writeSound } from './sound-pref.ts'
import {
  AGENT_APPEARANCE_SWATCHES,
  applyAgentAppearance,
  readAgentAppearance,
  writeAgentAppearance,
  type AgentAppearance,
  type AgentAppearanceColor,
} from './appearance-pref.ts'
import { THEMES, applyThemeChoice, isThemeId, readTheme, writeTheme } from './theme-pref.ts'
import { DEFAULT_ZOOM, readZoom, stepZoom, writeZoom, type ZoomStep } from './zoom-pref.ts'
import { applyLayout, applySettings, applyTheme, findAction, formatBinding, launcherLine } from './config.ts'
import { openTerminal, terminalFontSize, tokenValue, type TerminalView } from './terminal.ts'
import { createArranger, clearPlacement, PANE_MIN } from './grid/arrange.ts'
import type { PaneDirection } from './grid/layout.ts'
import { autoTree, neighborByGeometry, nudge, swapPanes, type Tree } from './grid/tree.ts'
import { previousOf, stepFrom } from './recent-tabs.ts'
import { PANE_DIM_RANGE, readPaneDim, writePaneDim } from './pane-dim.ts'
import type { KeyValueStore } from './persisted-pref.ts'
import { readSidebarHidden, writeSidebarHidden } from './sidebar-state.ts'
import { createFocusSignal } from './focus-signal.ts'
import { noViewState, storageViewState } from './view-state.ts'
import { groupAgents, jumpTargets, nextUrgent, shortFolder, sidebarSpaceOrder, spaceAt, tileIndex } from './sidebar-model.ts'
import { createWindowStore, type Tab, type TabKind } from './window-store.ts'
import { contextMeter, hideContextTip, markWithContext } from './context-badge.ts'
import { createTabPill, type TabPill } from './tab-pill.ts'
import { createNotesEditor } from './notes-editor.ts'
import { diffModule, notesModule } from './dock-modules.ts'
import { createHostBus, mountModules } from './modules.ts'
import { createDock } from './dock.ts'
import { settled, summarize } from './diff-model.ts'
import { createGoTo } from './goto.ts'
import { createRenameModal } from './rename-modal.ts'
import { createContextMenu } from './context-menu.ts'
import { createSpaceDialog } from './space-dialog.ts'
import { bindSpaceRename } from './space-rename.ts'
import { createIntegrationPanel } from './integrations.ts'
import { createKeysPanel } from './keys-panel.ts'
import { indicatorClass, indicatorLabel } from './indicator.ts'
import { createAgentWorkingMark } from './agent-thinking-dots.ts'
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

// A tab's DOM and terminal, by the tab's id. The store holds what the tab is; this holds what shows it.
interface TabDom {
  id: string
  // The kind the strip button's agent mark shows, so a kind change swaps the mark.
  kind: TabKind
  attached: boolean
  attaching: Promise<void> | null
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
// The states demo keeps the window's view state to itself: it saves nothing and restores nothing. Demo mode is only known
// once start() runs, so the port is chosen on each call.
const storedViewState = storageViewState(storage)
const viewStatePort = () => (demoMode ? noViewState : storedViewState)
const store = createWindowStore({
  changed: onStoreChanged,
  viewState: { read: () => viewStatePort().read(), write: (state) => viewStatePort().write(state) },
})
const doms = new Map<string, TabDom>()
// Whether the window is connected to the core: the changes panel says so instead of showing an empty diff.
let coreConnected = false
let homeDir = ''
let windowFocused = false
// The config in use: the key bindings, the theme tokens set on the root, and the note the status line shows for them.
let keys: Record<KeyAction, string> = DEFAULT_VALUES.keys
let themeTokens: string[] = []
let noteShown = ''
const isMac = navigator.platform.startsWith('Mac')
// The last attention.focus sent, as a key; an identical one is skipped until a reconnect clears it.
let sentFocus: string | null = null
// The states page (?demo=states) runs without a core: nothing is sent to it.
let demoMode = false
const playSound = createSoundGate()
let soundOn = readSound(storage())
// The chosen theme goes on the root before the first terminal opens, so every terminal starts with its colours.
let themeId = readTheme(storage())
applyThemeChoice(document.documentElement, themeId)
// The whole window is zoomed by the webview, so the terminals' ResizeObserver refits them. The saved level is applied
// before the first terminal opens.
let zoom = readZoom(storage())
function applyZoom(): void {
  void getCurrentWebview().setZoom(zoom).catch(report)
}
function setZoom(step: ZoomStep): void {
  zoom = stepZoom(zoom, step)
  writeZoom(storage(), zoom)
  applyZoom()
}
if (zoom !== DEFAULT_ZOOM) applyZoom()
let agentAppearance = readAgentAppearance(storage())
applyAgentAppearance(document.documentElement, agentAppearance)

const appEl = byId('app')
const contextMenu = createContextMenu(document.body, { closed: focusActive })
const spaceDialog = createSpaceDialog(document.body)
const tabStrip = byId('tabs')
const terminals = byId('terminals')
const statusLine = byId('status')
const spaceList = byId('spaces')
const gridToggle = byId('grid-toggle') as HTMLButtonElement
const paneDim = byId('pane-dim') as HTMLInputElement
const gridReset = byId('grid-reset') as HTMLButtonElement
const agentList = byId('agents')
const agentsEmpty = byId('agents-empty')
const installCliButton = byId('install-cli') as HTMLButtonElement
const installCliStatus = byId('install-cli-status')
const soundToggle = byId('sound-toggle') as HTMLButtonElement
const restartCoreButton = byId('restart-core') as HTMLButtonElement
const coreIndicator = byId('core-indicator')
const coreStatusText = byId('core-status-text')
const themeSelect = byId('theme-select') as HTMLSelectElement
const workingIndicatorSelect = byId('working-indicator-style') as HTMLSelectElement
const settingsTabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.settings-tab'))
const settingsSections = Array.from(document.querySelectorAll<HTMLElement>('.settings-section'))
const sidebar = byId('sidebar')
const sidebarToggle = byId('sidebar-toggle') as HTMLButtonElement
const urgentBanner = byId('urgent-banner') as HTMLButtonElement
const launcherBar = byId('launchers')
const emptyState = byId('empty-state')
const emptyTitle = byId('empty-title')
const emptyText = byId('empty-text')
coreIndicator.append(createAgentWorkingMark())
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
    renamed: (id, label) => store.renameTab(id, label),
    closed: focusActive,
  },
)
// Go to lists the tabs of every space, in the order of the sidebar, and jumps to the one chosen. Key bindings wait while it is open.
const goTo = createGoTo(
  { modal: byId('goto-modal'), input: byId('goto-input') as HTMLInputElement, list: byId('goto-list') },
  {
    source: () => ({
      spaces: sidebarSpaceOrder(store.spaces()).flatMap((id) => {
        const space = store.space(id)
        return space ? [{ id, name: space.name, parent: space.parent, worktree: space.worktree, repoName: space.repoName }] : []
      }),
      tabs: store.tabs.map((tab) => ({
        id: tab.id,
        spaceId: tab.spaceId,
        name: tabName(tab),
        agent: store.agent(tab.id)?.agent ?? (tab.kind === 'shell' ? null : tab.kind),
        state: stateOf(tab),
      })),
      recent: [...store.recentIds],
      activeSpaceId: store.activeSpace,
      activeTabId: store.activeTab?.id ?? null,
    }),
    tile: (group) => {
      const space = store.space(group.spaceId)
      const worktree = group.worktreeOf !== null
      const tile = element('span', worktree ? 'space-tile' : `space-tile tile-${tileIndex(group.name)}`, worktree ? '' : group.name.charAt(0).toUpperCase())
      if (worktree || space?.worktree) tile.innerHTML = iconSvg('branch')
      return tile
    },
    indicator: (state, agent) => indicatorEl(state, agent ?? undefined),
    agentMark: (row) => {
      const mark = markEl(row.agent)
      mark.title = row.agentName
      return markWithContext(mark, store.agent(row.tabId)?.context, row.agent)
    },
    go: (tabId) => activate(tabId),
    closed: focusActive,
  },
)
byId('search-button').addEventListener('click', () => goTo.open())
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
    expand: byId('dock-expand') as HTMLButtonElement,
    edge: byId('dock-edge'),
  },
  {
    store: storage(),
    applyWidth: (width) => appEl.style.setProperty('--dock-width', `${width}px`),
    closed: focusActive,
    changed: (id) => rail.pressed(id),
  },
)
// The modules in the dock (src modules.ts): each brings its panel, rail button and key action, and follows the host events the window
// emits below (tab switch, an agent that stopped working, a connection that opened or closed).
const hostBus = createHostBus((error) => report(error))
const rail = mountModules(
  [
    notesModule({
      read: async () => (await bridge.rpc('notes.read', {})).text,
      write: (text) => bridge.rpc('notes.write', { text }),
      createEditor: createNotesEditor,
    }),
    diffModule({
      tab: () => store.activeTab?.id ?? null,
      connected: () => coreConnected,
      get: (tabId, mode, base, showUntracked) => bridge.rpc('diff.get', { tabId, mode, base, showUntracked }),
      bases: (tabId) => bridge.rpc('diff.bases', { tabId }),
      file: (tabId, mode, file) => bridge.rpc('diff.file', { tabId, mode, file }),
      prefs: (tabId) => bridge.rpc('diff.prefs.get', { tabId }),
      setPrefs: (tabId, prefs) => bridge.rpc('diff.prefs.set', { tabId, ...prefs }),
      comments: {
        list: async (tabId) => (await bridge.rpc('diff.comments.list', { tabId })).comments,
        add: (tabId, comment) => bridge.rpc('diff.comments.add', { tabId, ...comment }),
        update: (tabId, id, change) => bridge.rpc('diff.comments.update', { tabId, id, ...change }),
        remove: async (tabId, id) => void (await bridge.rpc('diff.comments.delete', { tabId, id })),
        markSent: async (tabId, ids) => (await bridge.rpc('diff.comments.markSent', { tabId, ids })).comments,
      },
      target: () => {
        const tab = store.activeTab
        if (!tab) return null
        const info = store.agent(tab.id)
        return { name: tabName(tab), kind: tab.kind, state: stateOf(tab), ...(info?.reason ? { reason: info.reason } : {}), exited: tab.exited }
      },
      write: async (tabId, data) => void (await bridge.rpc('tabs.write', { id: tabId, dataB64: toBase64(encoder.encode(data)) })),
      focusTab: (tabId) => activate(tabId),
    }),
  ],
  byId('dock-toggles'),
  dock,
  hostBus,
  (error) => report(error),
)
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
    if (store.activeSpace !== null && store.refused === null) void newShellTab()
  },
  'new-space': () => void newSpaceTab().catch(report),
  'close-tab': () => {
    if (store.activeTab) void closeTab(store.activeTab.id).catch(report)
  },
  'previous-tab': () => {
    const recent = store.activeSpace === null ? [] : store.recent(store.activeSpace)
    const current = store.activeTab?.id ?? null
    // A tab not visited yet is not in the recent list, so with no other visited tab the key steps along the strip instead of doing nothing.
    const previous = previousOf(recent, current) ?? stepFrom(spaceTabIds(), current, 1)
    if (previous) activate(previous)
  },
  'grid-tab': () => toggleGridTab(),
  'grid-reset-layout': () => {
    store.setGridLayout(null)
  },
  'next-urgent': () => jumpToUrgent(),
  palette: () => goTo.open(),
  'sidebar-toggle': () => sidebarToggle.click(),
  notes: () => rail.toggle('notes')?.(),
  diff: () => rail.toggle('diff')?.(),
  'dock-expand': () => dock.toggleExpanded(),
  'zoom-in': () => setZoom('in'),
  'zoom-out': () => setZoom('out'),
  'zoom-reset': () => setZoom('reset'),
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
  return store.space(spaceId)?.name ?? spaceId
}

// The tab's name: the one the user gave it, else "Tab N".
function tabName(tab: Tab): string {
  return store.tabName(tab.id)
}

// The tab's name with its space, for titles and notifications.
function tabLabel(tab: Tab): string {
  return `${spaceName(tab.spaceId)}: ${tabName(tab)}`
}

// The state a tab shows: its agent's status, or idle for a shell or a gone tab.
function stateOf(tab: Tab): AgentStateName {
  return store.stateOf(tab.id)
}

// The state indicator; a live agent tab with no report also names its minimum supported version.
function indicatorEl(state: AgentStateName, agent?: AgentKind, live = false): HTMLElement {
  const node = element('span', indicatorClass(state))
  if (state === 'working') node.append(createAgentWorkingMark())
  const label = indicatorLabel(state, agent, live)
  node.title = label
  node.setAttribute('aria-label', label)
  return node
}

function markEl(kind: TabKind): HTMLElement {
  const mark = element('span', `agent-mark mark-${kind}`)
  mark.innerHTML = kind === 'shell' ? iconSvg('terminal') : agentIconSvg(kind)
  return mark
}

// The DOM of a tab the store holds: its pane, terminal and strip button. Built by the change loop, dropped with the tab.
function createTabDom(tab: Tab): TabDom {
  const id = tab.id
  const pane = document.createElement('section')
  pane.className = 'pane'
  const head = document.createElement('header')
  head.className = 'pane-head'
  gridArranger.grab(head, () => id)
  const host = document.createElement('div')
  host.className = 'term-host'
  pane.append(head, host)
  terminals.append(pane)

  const pill = createTabPill(markEl(tab.kind), {
    onActivate: () => activate(id),
    onRename: () => {
      const current = store.tab(id)
      if (current) renameModal.open({ id, label: current.label, number: current.number })
    },
    onClose: () => closeTab(id).catch(report),
  })
  const tabEl = pill.root
  tabStrip.append(tabEl)

  const dom: TabDom = {
    id,
    kind: tab.kind,
    attached: false,
    attaching: null,
    queue: null,
    pane,
    head,
    host,
    tabEl,
    pill,
    view: undefined as unknown as TerminalView,
  }
  host.addEventListener('click', () => activate(id))
  dom.view = openTerminal(host, {
    onInput: (text) => {
      if (dom.attached) void bridge.rpc('tabs.write', { id, dataB64: toBase64(encoder.encode(text)) }).catch(report)
    },
    onResize: (cols, rows) => {
      if (dom.attached) void bridge.rpc('tabs.resize', { id, cols, rows }).catch(report)
    },
    onContextLoss: () => console.warn(`WebGL context lost in tab ${id}; using the DOM renderer`),
  })
  // The host's own size is what the terminal fits to, so it refits whenever that changes, shown or not.
  new ResizeObserver(() => dom.view.fit()).observe(host)
  return dom
}

// Every store write ends here: tabs the store gained get their DOM, tabs it lost lose theirs, a tab whose kind changed swaps its
// agent mark, then the window paints.
function onStoreChanged(): void {
  const held = new Set(store.tabs.map((tab) => tab.id))
  for (const [id, dom] of doms) {
    if (held.has(id)) continue
    dom.pane.remove()
    dom.tabEl.remove()
    doms.delete(id)
  }
  for (const tab of store.tabs) {
    const dom = doms.get(tab.id)
    if (!dom) {
      doms.set(tab.id, createTabDom(tab))
    } else if (dom.kind !== tab.kind) {
      dom.kind = tab.kind
      dom.pill.root.querySelector('.agent-mark')?.replaceWith(markEl(tab.kind))
    }
  }
  paint()
}

// The × and Cmd+W: the core kills the tab and drops its record. The tab leaves the strip and the agents list at once.
async function closeTab(id: string): Promise<void> {
  const tab = store.tab(id)
  if (!tab) return
  await bridge.rpc('tabs.close', { id })
  store.removeTab(id)
  focusActive()
  // The last tab of a space is a likely end of the space: ask, and leave the empty space alone when the answer is no.
  const space = store.space(tab.spaceId)
  if (space && store.tabsOfSpace(space.id).length === 0) void askRemoveSpace(space, true).then(focusActive)
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
      store.dropSpace(space.id)
    },
  })
}

function askRemoveSpaceOnce(space: SpaceInfo, lastTab: boolean, refused: (reason: string) => void): Promise<boolean> {
  const count = store.tabsOfSpace(space.id).length
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
      store.dropSpace(space.id)
    },
  })
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
      store.upsertSpace({ ...space, name: name || baseName(space.path), label: name || null })
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
      store.upsertSpace(created)
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
      store.upsertSpace(added)
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

function deliver(dom: TabDom, bytes: Uint8Array): void {
  if (dom.queue) dom.queue.push(bytes)
  else dom.view.write(bytes)
}

function markExited(id: string, exitCode: number | null = null): void {
  if (store.markExited(id)) writeExited(id, exitCode)
}

// The tab's process is gone: it stops counting as attached and its screen says so.
function writeExited(id: string, exitCode: number | null): void {
  const dom = doms.get(id)
  if (!dom) return
  dom.attached = false
  const code = exitCode === null ? '' : ` with code ${exitCode}`
  deliver(dom, encoder.encode(`\r\n\x1b[2m[process exited${code}]\x1b[0m\r\n`))
}

// Shows the core's saved screen first, then output that arrived while the attach was in flight.
function attach(dom: TabDom): Promise<void> {
  if (dom.attaching) return dom.attaching
  const pending = attachScreen(dom).finally(() => { dom.attaching = null })
  dom.attaching = pending
  return pending
}

async function attachScreen(dom: TabDom): Promise<void> {
  dom.queue = []
  try {
    const { screenB64 } = await bridge.rpc('tabs.attach', { id: dom.id })
    dom.view.reset()
    dom.view.write(fromBase64(screenB64))
    const pending = dom.queue
    dom.queue = null
    for (const bytes of pending) dom.view.write(bytes)
  } finally {
    dom.queue = null
  }
  dom.attached = true
  store.markAlive(dom.id)
  const { cols, rows } = dom.view.term
  await bridge.rpc('tabs.resize', { id: dom.id, cols, rows })
}

// The tree the grid shows: the human's layout fitted to the panes, else the automatic one.
function gridTree(members: readonly Tab[]): Tree | null {
  return store.gridLayout ?? autoTree(members.map((tab) => tab.id))
}

function terminalsSize(): { w: number; h: number } {
  const box = terminals.getBoundingClientRect()
  return { w: box.width, h: box.height }
}

// The human changed the grid's layout: it is theirs from now on, so it is shown, kept, and the terminals refit to their new sizes.
function arrangeGrid(tree: Tree): void {
  store.setGridLayout(tree)
  requestAnimationFrame(fitShown)
}

const gridArranger = createArranger({
  container: terminals,
  tree: () => gridTree(store.gridTabs()),
  pane: (id) => doms.get(id)?.pane,
  change: arrangeGrid,
})

// Lays the panes out in grid mode, or clears the grid's classes and placement when it is off.
function paintGrid(members: readonly Tab[]): void {
  const gridOn = store.gridOn
  terminals.classList.toggle('grid-panes', gridOn)
  gridArranger.paint(gridOn ? gridTree(members) : null)
  // Reset only has something to do once the human has made the layout their own.
  gridReset.hidden = !gridOn || store.gridLayout === null
  for (const tab of store.tabs) {
    const dom = doms.get(tab.id)
    if (!dom) continue
    const inGrid = gridOn && members.includes(tab)
    if (!inGrid) clearPlacement(dom.pane)
    dom.host.classList.toggle('pane-dim', inGrid && tab !== store.activeTab)
  }
}

// Refits what is on screen: the grid's panes, else the active tab.
function fitShown(): void {
  for (const tab of store.gridOn ? store.gridTabs() : store.activeTab ? [store.activeTab] : []) doms.get(tab.id)?.view.fit()
}

// The tab's strip button and its pane header, from its name and state.
function paintTab(tab: Tab): void {
  const dom = doms.get(tab.id)
  if (!dom) return
  const state = stateOf(tab)
  const name = tabName(tab)
  const agent = tab.kind === 'shell' ? undefined : tab.kind
  dom.pill.update({ name, title: tabLabel(tab), state, agent, live: !tab.exited, inGrid: tab.inGrid })
  // A meter replaced under the pointer never sends its leave, so its tooltip is put away first.
  if (dom.head.querySelector('.context-meter')) hideContextTip()
  const space = store.space(tab.spaceId)
  const changes = changeCounts.get(tab.id)
  const parts: HTMLElement[] = [markEl(tab.kind)]
  parts.push(element('span', tab.label ? 'pane-kind' : 'pane-kind unnamed', name))
  if (space?.branch) parts.push(branchButton(space.branch, space.worktree))
  parts.push(element('span', 'pane-folder', shortFolder(tab.spacePath, homeDir)))
  if (changes && changes.additions + changes.deletions > 0) parts.push(changesButton(changes))
  if (agent) parts.push(contextMeter(store.agent(tab.id)?.context, agent))
  parts.push(indicatorEl(state, agent, !tab.exited))
  dom.head.replaceChildren(...parts)
}

// The pane's branch: a click copies the name, which reads "copied" for a moment.
function branchButton(name: string, worktree: boolean): HTMLElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = worktree ? 'pane-branch worktree' : 'pane-branch'
  button.title = 'Copy the branch name'
  button.innerHTML = `${iconSvg('branch')}<span></span>`
  const label = button.querySelector('span')!
  label.textContent = name
  button.addEventListener('pointerdown', (event) => event.stopPropagation())
  button.addEventListener('click', () => {
    navigator.clipboard.writeText(name).then(() => {
      label.textContent = 'copied'
      setTimeout(() => (label.textContent = name), 1000)
    }, report)
  })
  return button
}

// The pane's line changes, as the diff panel counts them; a click opens the diff.
function changesButton(counts: { additions: number; deletions: number }): HTMLElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'pane-changes'
  button.title = 'Show the changes'
  button.append(element('b', 'add', `+${counts.additions}`), element('b', 'del', `−${counts.deletions}`))
  button.addEventListener('pointerdown', (event) => event.stopPropagation())
  button.addEventListener('click', () => {
    const dom = [...doms.values()].find((candidate) => candidate.head === button.parentElement)
    if (dom && dom.id !== store.activeTab?.id) activate(dom.id)
    rail.toggle('diff')?.()
  })
  return button
}

// Line changes per agent tab, read from the same diff the panel shows. Refreshed while the pane is on screen and when its agent settles.
const changeCounts = new Map<string, { additions: number; deletions: number }>()
const CHANGES_EVERY_MS = 15000
const changesBusy = new Set<string>()

async function refreshChanges(tab: Tab): Promise<void> {
  if (demoMode || tab.kind === 'shell' || tab.exited || changesBusy.has(tab.id)) return
  changesBusy.add(tab.id)
  try {
    const result = await bridge.rpc('diff.get', { tabId: tab.id, mode: 'branch' })
    const total = result.state === 'ok' ? summarize(result.files) : { additions: 0, deletions: 0 }
    const before = changeCounts.get(tab.id)
    if (before?.additions !== total.additions || before?.deletions !== total.deletions) {
      changeCounts.set(tab.id, { additions: total.additions, deletions: total.deletions })
      paintTab(tab)
    }
  } catch {
    // a folder that is gone or a core that is away: the last counts stay
  } finally {
    changesBusy.delete(tab.id)
  }
}

setInterval(() => {
  for (const tab of store.gridOn ? store.gridTabs() : store.activeTab ? [store.activeTab] : []) refreshChanges(tab).catch(report)
}, CHANGES_EVERY_MS)

// The empty state shows when there is no space, or the space has no tabs.
function paintEmpty(): void {
  const none = store.activeSpace === null
  const bare = store.tabsOfSpace(store.activeSpace).length === 0
  emptyState.hidden = !(none || bare)
  emptyTitle.textContent = none ? 'No space open' : 'No tabs in this space'
  emptyText.textContent = none
    ? `Press ${shortcut('new-space')} to open a space at your home folder.`
    : `Press + in the tab strip (${shortcut('new-shell')}) to open a shell.`
}

const signalActiveTab = createFocusSignal(() => hostBus.emit('activeTabChanged', undefined))

// Tabs of other spaces stay mounted and only hidden, so their shells keep running and their screens keep filling.
function paint(): void {
  const shown = store.gridTabs()
  const active = store.activeTab
  const activeSpace = store.activeSpace
  const gridOn = store.gridOn
  const members = gridOn ? shown : []
  for (const tab of store.tabs) {
    const dom = doms.get(tab.id)
    if (!dom) continue
    const on = tab === active
    dom.tabEl.hidden = tab.spaceId !== activeSpace
    dom.tabEl.classList.toggle('active', on)
    dom.tabEl.classList.toggle('exited', tab.exited)
    dom.tabEl.setAttribute('aria-selected', String(on))
    dom.pane.hidden = gridOn ? !members.includes(tab) : !on
    dom.pane.classList.toggle('focused', on)
    paintTab(tab)
  }
  paintGrid(members)
  requestAnimationFrame(fitShown)
  renderSpaces()
  renderAgents()
  paintEmpty()
  signalActiveTab(activeSpace, active?.id ?? null)
  const idle = activeSpace === null || store.refused !== null
  gridToggle.setAttribute('aria-pressed', String(gridOn))
  paneDim.hidden = !gridOn
  gridToggle.disabled = !gridOn && (idle || shown.length === 0)
  for (const button of launcherBar.querySelectorAll('button')) button.disabled = idle
  reportFocus()
}

// The shortcuts the window lists are written from the bindings in use, so a rebound key shows its new name.
function shortcut(action: KeyAction): string {
  return formatBinding(keys[action], isMac)
}

function paintShortcuts(): void {
  paintUrgent()
  rail.paintShortcuts(shortcut)
  byId('dock-expand').title = `Expand the side panel (${shortcut('dock-expand')})`
  gridReset.title = `Put the grid back to its automatic layout (${shortcut('grid-reset-layout')}).`
  gridToggle.title = `Show the tabs put in the grid, from any space, (${shortcut('grid-toggle')}). ${shortcut('grid-tab')} puts the focused tab in it.`
  const hidden = appEl.classList.contains('sidebar-hidden')
  sidebarToggle.title = `${hidden ? 'Show' : 'Hide'} the sidebar (${shortcut('sidebar-toggle')})`
}

// The core needs the tab on screen and whether the window has focus, to decide what to notify and mark seen.
function reportFocus(): void {
  if (demoMode) return
  const params = { tabId: store.activeTab?.id ?? null, windowFocused }
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
  const dom = store.activeTab ? doms.get(store.activeTab.id) : undefined
  if (dom && !dom.pane.hidden) {
    dom.view.fit()
    dom.view.term.focus()
  }
}

// The tabs with something for the human, in any space (see urgentTabs). A gone tab shows idle, so it is not one.
function tabItems(): Array<{ id: string; state: AgentStateName; since: number }> {
  return store.tabs.map((tab) => ({ id: tab.id, state: stateOf(tab), since: store.agent(tab.id)?.since ?? 0 }))
}

// Cmd+. and the footer banner: goes to the next tab that needs you or has finished, in any space; with none, to the next working one.
function jumpToUrgent(): void {
  const next = nextUrgent(jumpTargets(tabItems()), store.activeTab?.id ?? null)
  if (next) activate(next.id)
}

// The footer banner: how many tabs jumpToUrgent can reach, toned for the most urgent of them. Hidden when there are none.
function paintUrgent(): void {
  const urgent = store.urgent()
  urgentBanner.hidden = urgent.length === 0
  if (urgent.length === 0) return
  const tone = urgent[0].state
  urgentBanner.className = `urgent-banner tone-${tone}`
  const needing = urgent.filter((item) => item.state === 'needs-you').length
  const label = needing === 0 ? 'finished' : needing === urgent.length ? 'need you' : `· ${needing} need you`
  urgentBanner.replaceChildren(indicatorEl(tone), element('span', 'urgent-count', String(urgent.length)), element('span', 'urgent-label', label))
  urgentBanner.title = `Go to the next tab with something for you (${shortcut('next-urgent')})`
}

function activate(id: string): void {
  store.activateTab(id)
  focusActive()
}

// Shows the space's most recently visited tab, or its first tab, or nothing when the space has no tabs.
function selectSpace(spaceId: string | null, chosenId?: string): void {
  store.selectSpace(spaceId, chosenId)
}

function renderSpaces(): void {
  const all = store.spaces()
  // A space's indicator is the most urgent state among its own tabs; a worktree's tabs count only towards itself.
  const states = rollupSpaces(
    all.map((space) => space.id),
    store.tabs.map((tab) => ({ spaceId: tab.spaceId, state: stateOf(tab) })),
  )
  const top = all.filter((space) => !space.parent || !store.space(space.parent))
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
  button.dataset.spaceId = space.id
  button.title = space.path
  const tile = element(
    'span',
    worktree ? 'space-tile' : `space-tile tile-${tileIndex(space.name)}`,
    worktree ? '' : space.name.charAt(0).toUpperCase(),
  )
  if (worktree) tile.innerHTML = iconSvg('branch')
  button.append(tile, element('span', 'space-name', space.name), element('span', 'space-branch', worktree ? '' : (space.branch ?? '')))
  button.append(indicatorEl(state))
  if (space.id === store.activeSpace) button.setAttribute('aria-current', 'true')
  button.addEventListener('click', () => {
    selectSpace(space.id)
    focusActive()
  })
  if (!demoMode) button.addEventListener('contextmenu', (event) => openSpaceMenu(space, event))
  return button
}

// Opens a shell tab in the active space. A launcher passes the line it types once the tab's first output arrives.
async function newShellTab(typed: string | null = null): Promise<void> {
  const spaceId = store.activeSpace
  const space = spaceId ? store.space(spaceId) : undefined
  if (!spaceId || !space) return
  const shown = store.activeTab ? doms.get(store.activeTab.id) : undefined
  let opened: string | undefined
  try {
    const { id } = await bridge.rpc('tabs.open', {
      spaceId,
      cols: shown?.view.term.cols ?? 80,
      rows: shown?.view.term.rows ?? 24,
    })
    opened = id
    // The opened notification can arrive before this call's reply.
    if (!store.tab(id)) store.addTab({ id, spaceId, spacePath: space.path, kind: 'terminal', label: null, alive: true, exitCode: null })
    const dom = doms.get(id)!
    if (!dom.attached || dom.attaching) await attach(dom)
    if (typed !== null) void bridge.rpc('tabs.write', { id, dataB64: toBase64(encoder.encode(`${typed}\r`)) }).catch(report)
    activate(id)
  } catch (error) {
    if (opened) store.removeTab(opened)
    report(error)
  }
}

// Cmd+1 to Cmd+9: focuses the space at that place in the sidebar order, with the tab it last showed. A place past the last space does nothing.
function spaceTabIds(): string[] {
  return store.tabsOfSpace(store.activeSpace).map((tab) => tab.id)
}

function focusSpace(place: number): void {
  const spaceId = spaceAt(sidebarSpaceOrder(store.spaces()), place)
  if (spaceId === null) return
  selectSpace(spaceId)
  focusActive()
}

// Cmd+Shift+G: the active tab goes into the grid, and the grid shows. A tab already in the grid goes out of it and shows full screen.
// A tenth tab is refused, with the reason in the status line.
function toggleGridTab(): void {
  if (store.toggleGridTab(terminalsSize()) === 'refused') statusLine.textContent = 'The grid holds nine tabs. Take a tab out of it first.'
}

// Cmd+N: adds a new space at the home folder (spaces.add always adds one), selects it, and opens one shell tab there.
async function newSpaceTab(): Promise<void> {
  const space = await bridge.rpc('spaces.add', { path: homeDir })
  store.upsertSpace(space)
  selectSpace(space.id)
  await newShellTab()
}

// Starts a gone agent tab again under its own id; the core resumes the saved session.
async function resumeAgent(tab: Tab, kind: AgentKind): Promise<void> {
  const dom = doms.get(tab.id)
  if (!dom) return
  const { cols, rows } = dom.view.term
  await bridge.rpc('tabs.create', {
    id: tab.id,
    command: AGENT_COMMANDS[kind],
    cwd: tab.spacePath,
    cols,
    rows,
    agent: { kind },
  })
  await attach(dom)
  activate(tab.id)
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
      button.disabled = store.activeSpace === null || store.refused !== null
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
  store.setAgents(await bridge.rpc('agents.list', {}))
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
  if (tab === store.activeTab) focus.setAttribute('aria-current', 'true')
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
  const agentKind = tab.kind === 'shell' ? undefined : tab.kind
  focus.append(
    markWithContext(markEl(tab.kind), agent.context, agent.agent),
    element('span', 'agent-label', tabName(tab)),
    tail,
    indicatorEl(stateOf(tab), agentKind, !tab.exited),
  )
  focus.addEventListener('click', () => activate(tab.id))
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
  hideContextTip()
  const rows: AgentRow[] = []
  for (const agent of store.agents()) {
    const tab = store.tab(agent.tabId)
    if (tab) rows.push({ spaceId: tab.spaceId, tabNumber: tab.number, agent, exited: tab.exited, tab })
  }
  agentsEmpty.hidden = rows.length > 0
  agentList.replaceChildren(
    ...groupAgents(store.spaces().map((space) => space.id), rows).map((group) => {
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
  const effects = store.reconcile(state)
  if (state.refused) statusLine.textContent = `State file refused: ${state.refused}`
  for (const { id, exitCode } of effects.exited) writeExited(id, exitCode)
  // One tab that fails to attach is reported and the others still attach, so a bad tab cannot leave every terminal blank.
  for (const id of effects.attach) await attach(doms.get(id)!).catch(report)
  await refreshAgents()
}

bridge.on('tabs.output', ({ id, dataB64 }) => {
  const dom = doms.get(id)
  if (!dom) return
  deliver(dom, fromBase64(dataB64))
})

bridge.on('tabs.opened', (info) => {
  store.addTab(info)
  attach(doms.get(info.id)!).then(paint).catch(report)
  refreshAgents().catch(report)
})

bridge.on('tabs.exit', ({ id, exitCode }) => {
  markExited(id, exitCode)
  refreshAgents().catch(report)
})

bridge.on('status.changed', (change) => {
  const { previous } = store.applyStatusChange(change)
  const changed = store.tab(change.tabId)
  if (changed) refreshChanges(changed).catch(report)
  hostBus.emit('agentStateChanged', { tabId: change.tabId, settled: settled(previous?.state, change.state) })
  // resumable depends on the holder's liveness, which the change does not carry; the core's list settles it.
  refreshAgents().catch(report)
})

// A context reading belongs to one session's row; a tab with no entry yet waits for its status.
bridge.on('context.changed', ({ tabId, context }) => store.applyContext(tabId, context))

bridge.on('attention.notify', (notice) => {
  const tab = store.tab(notice.tabId)
  const title = tab ? tabLabel(tab) : notice.tabId
  invoke('notify', { title, body: noticeBody(notice), sound: soundOn ? playSound(notice) : null }).catch(report)
})

bridge.on('config.changed', applyConfig)

// The CLI asked for a tab: its space and tab are shown, then the window comes forward. An unknown tab only raises the window.
bridge.on('tabs.focus', ({ id }) => {
  if (store.tab(id)) activate(id)
  invoke('raise_window').catch(report)
})

// The CLI closed the tab: it leaves the strip and the agents list at once, not at the next resync.
bridge.on('tabs.closed', ({ id }) => store.removeTab(id))

// Another window or the CLI removed a space: it leaves the sidebar at once.
bridge.on('spaces.removed', ({ id }) => store.dropSpace(id))

// A space was added or changed: the sidebar updates at once.
bridge.on('spaces.changed', (info) => store.upsertSpace(info))

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
    hostBus.emit('connectionChanged', { open: false })
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
  hostBus.emit('connectionChanged', { open: true })
})

new ResizeObserver(() => fitShown()).observe(terminals)
// The sidebar's column and the dock's width animate, so a terminal can be fit to a size from partway through. It refits once more
// when the animation ends, whatever the observers last said.
appEl.addEventListener('transitionend', (event) => {
  if (event.propertyName === 'grid-template-columns' || event.propertyName === 'width') fitShown()
})
gridReset.addEventListener('click', () => keyActions['grid-reset-layout']())
gridToggle.addEventListener('click', () => {
  store.setGrid(!store.gridOn)
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
bindSpaceRename(spaceList, (spaceId) => {
  const space = demoMode ? undefined : store.space(spaceId)
  if (!space) return
  void askRenameSpace(space).then(focusActive)
})
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
const AGENT_APPEARANCE_STATES = [
  { key: 'needsYou', id: 'appearance-needs-you', label: 'Waiting' },
  { key: 'working', id: 'appearance-working', label: 'Running' },
  { key: 'finished', id: 'appearance-finished', label: 'Finished' },
] as const
function syncAgentAppearanceControls(): void {
  for (const { key, id } of AGENT_APPEARANCE_STATES) {
    const group = byId(id)
    for (const button of group.querySelectorAll<HTMLButtonElement>('.appearance-swatch')) {
      button.setAttribute('aria-pressed', String(agentAppearance[key] === button.dataset.color))
    }
    group.querySelector<HTMLButtonElement>('.appearance-default')?.setAttribute(
      'aria-pressed',
      String(agentAppearance[key] === null),
    )
  }
}
function renderAgentAppearanceControls(): void {
  for (const { key, id, label } of AGENT_APPEARANCE_STATES) {
    const swatches = AGENT_APPEARANCE_SWATCHES.map(({ id: color, label: colorName }) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'appearance-swatch'
      button.dataset.color = color
      button.style.setProperty('--swatch-color', `var(--${color})`)
      button.title = colorName
      button.setAttribute('aria-label', `${label} color ${colorName}`)
      button.addEventListener('click', () => updateAgentAppearance(key, color))
      return button
    })
    const useTheme = document.createElement('button')
    useTheme.type = 'button'
    useTheme.className = 'appearance-default'
    useTheme.textContent = 'Theme default'
    useTheme.setAttribute('aria-label', `${label} color: Theme default`)
    useTheme.addEventListener('click', () => updateAgentAppearance(key, null))
    byId(id).replaceChildren(...swatches, useTheme)
  }
  workingIndicatorSelect.value = agentAppearance.workingIndicator
  syncAgentAppearanceControls()
}
function updateAgentAppearance<K extends 'needsYou' | 'working' | 'finished'>(
  key: K,
  color: AgentAppearance[K],
): void {
  agentAppearance = { ...agentAppearance, [key]: color }
  applyAgentAppearance(document.documentElement, agentAppearance)
  writeAgentAppearance(storage(), agentAppearance)
  syncAgentAppearanceControls()
}
renderAgentAppearanceControls()
themeSelect.addEventListener('change', () => {
  if (!isThemeId(themeSelect.value)) return
  themeId = themeSelect.value
  applyThemeChoice(document.documentElement, themeId)
  writeTheme(storage(), themeId)
  // Open terminals read their colours when they open, so each one reads them again.
  for (const dom of doms.values()) dom.view?.restyle()
})
workingIndicatorSelect.addEventListener('change', () => {
  if (workingIndicatorSelect.value !== 'dots' && workingIndicatorSelect.value !== 'waveform') return
  agentAppearance = { ...agentAppearance, workingIndicator: workingIndicatorSelect.value }
  applyAgentAppearance(document.documentElement, agentAppearance)
  writeAgentAppearance(storage(), agentAppearance)
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
// How far a keyboard resize moves a divider, as a share of the area it divides.
const GRID_NUDGE = 0.05
const ARROW_DIRECTIONS: Record<string, PaneDirection | undefined> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }
// Key bindings are read in the capture phase, so a matched key does not also reach the terminal. While the rename modal is open they wait.
window.addEventListener(
  'keydown',
  (event) => {
    if (goTo.isOpen()) {
      // The key that opened Go to closes it; every other key belongs to the overlay.
      if (findAction(keys, event, isMac) === 'palette') {
        event.preventDefault()
        event.stopPropagation()
        goTo.close()
      }
      return
    }
    if (renameModal.isOpen() || integrationPanel.isOpen() || spaceDialog.isOpen() || contextMenu.isOpen()) return
    let action = findAction(keys, event, isMac)
    if (action === null && event.shiftKey) {
      // Shift added to the previous-tab key goes the other way, along the strip.
      const plain = { code: event.code, key: event.key, metaKey: event.metaKey, ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: false }
      if (findAction(keys, plain, isMac) === 'previous-tab') {
        event.preventDefault()
        event.stopPropagation()
        const back = stepFrom(spaceTabIds(), store.activeTab?.id ?? null, -1)
        if (back) activate(back)
        return
      }
    }
    if (action === null) {
      // In grid mode Cmd+Option+arrow (Ctrl+Alt off the Mac) moves between the panes, with Shift it swaps the pane with its neighbour, and
      // Cmd+Ctrl+Option+arrow moves the divider next to the pane. Plain Cmd+arrow never reaches the page, and Ctrl+arrow is Mission Control.
      const direction = store.gridOn ? ARROW_DIRECTIONS[event.key] : undefined
      const modifier = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
      const resizing = event.metaKey && event.ctrlKey && event.altKey && !event.shiftKey
      if (!direction || !event.altKey || (!resizing && !modifier)) return
      event.preventDefault()
      event.stopPropagation()
      const active = store.activeTab
      const members = store.gridTabs()
      const tree = active && members.includes(active) ? gridTree(members) : null
      if (!active || !tree) return
      if (resizing) {
        arrangeGrid(nudge(tree, active.id, direction, GRID_NUDGE, terminalsSize(), PANE_MIN))
        return
      }
      const next = store.tab(neighborByGeometry(tree, active.id, direction))
      if (!next || next === active) return
      if (event.shiftKey) {
        arrangeGrid(swapPanes(tree, active.id, next.id))
      } else {
        activate(next.id)
      }
      return
    }
    event.preventDefault()
    event.stopPropagation()
    keyActions[action]()
  },
  { capture: true },
)
setInterval(refreshAges, AGE_REFRESH_MS)
// A window that comes back (from the background, or a night of sleep) repaints its terminals: the GPU may have dropped their contexts meanwhile.
function repaintTerminals(): void {
  for (const dom of doms.values()) dom.view.repaint()
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
async function startDemo(demo: typeof import('./demo/states.ts'), rows: DemoRows): Promise<void> {
  demoMode = true
  windowFocused = true
  homeDir = rows.home
  demo.seedDemo(store, rows)
}

async function start(): Promise<void> {
  if (import.meta.env.DEV) {
    const demo = await import('./demo/states.ts')
    if (demo.isDemoStates(window.location, import.meta.env.DEV)) {
      await loadFonts()
      await startDemo(demo, demo.demoRows())
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
