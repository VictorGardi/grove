// @vitest-environment happy-dom
// The window's status path, through the real entry point: the core's status.changed notifications arrive on the bridge's
// channel and must draw the indicator on the tab strip, the pane header and the sidebar's rows. Each agent
// is typed by hand into a shell tab, as a human does, so its tab was created as a shell.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentInfo, AgentStateName, SpaceTabInfo, StatusChange } from '../protocol/messages.ts'
import { DEFAULT_VALUES } from '../core/config/schema.ts'
import { VIEW_STATE_KEY } from './view-state.ts'

const fake = vi.hoisted(() => ({
  channel: null as null | { onmessage: (line: string) => void },
  tabs: [] as unknown[],
  agents: [] as unknown[],
  opening: null as SpaceTabInfo | null,
  attaches: [] as string[],
  creates: [] as unknown[],
}))

vi.mock('@tauri-apps/api/core', () => {
  class Channel {
    onmessage: (line: string) => void = () => {}
    constructor() {
      fake.channel = this
    }
  }
  const answer = (method: string, params: { id?: string } = {}): unknown => {
    switch (method) {
      case 'spaces.list':
        return {
          spaces: [{ id: 's1', path: '/Users/test/proj', name: 'proj', repoName: null, parent: null, branch: null }],
          tabs: fake.tabs,
          refused: null,
        }
      case 'agents.list':
        return fake.agents
      case 'config.get':
        return { path: '', values: DEFAULT_VALUES, notes: {} }
      case 'integration.status':
        return { agents: [] }
      case 'tabs.create':
        fake.creates.push(params)
        return {}
      case 'tabs.attach':
        fake.attaches.push(params.id!)
        return { screenB64: '', cols: 80, rows: 24 }
      case 'tabs.open':
        if (!fake.opening) throw new Error('no tab configured')
        fake.channel!.onmessage(JSON.stringify({ jsonrpc: '2.0', method: 'tabs.opened', params: fake.opening }))
        return { id: fake.opening.id }
      default:
        return {}
    }
  }
  const invoke = async (command: string, args?: { events?: unknown; request?: { id: number; method: string; params?: { id?: string } } }) => {
    if (command === 'env_info') return { home: '/Users/test' }
    if (command === 'connect') return undefined
    if (command === 'rpc') {
      const request = args!.request!
      return JSON.stringify({ jsonrpc: '2.0', id: request.id, result: answer(request.method, request.params) })
    }
    return undefined
  }
  return { Channel, invoke }
})

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ isFocused: async () => true, onFocusChanged: async () => () => {} }),
}))

vi.mock('./terminal.ts', () => ({
  terminalFontSize: () => 12,
  tokenValue: () => 'monospace',
  openTerminal: () => ({
    term: { cols: 80, rows: 24, focus: () => {}, onSelectionChange: () => {}, options: {} },
    write: () => {},
    reset: () => {},
    fit: () => {},
    restyle: () => {},
    dispose: () => {},
  }),
}))

const TABS: SpaceTabInfo[] = [
  { id: 'tab-claude', spaceId: 's1', spacePath: '/Users/test/proj', kind: 'terminal', label: 'claude', alive: true, exitCode: null },
  { id: 'tab-copilot', spaceId: 's1', spacePath: '/Users/test/proj', kind: 'terminal', label: 'copilot', alive: true, exitCode: null },
  { id: 'tab-opencode', spaceId: 's1', spacePath: '/Users/test/proj', kind: 'terminal', label: 'opencode', alive: true, exitCode: null },
]

const TYPED: Array<{ tabId: string; agent: StatusChange['agent'] }> = [
  { tabId: 'tab-claude', agent: 'claude' },
  { tabId: 'tab-copilot', agent: 'copilot' },
  { tabId: 'tab-opencode', agent: 'opencode' },
]

const STATES: AgentStateName[] = ['needs-you', 'working', 'finished', 'unknown', 'idle']

// The window's own notification handler, fed as the core sends it: one JSON line on the bridge's channel.
function notify(method: string, params: unknown): void {
  fake.channel!.onmessage(JSON.stringify({ jsonrpc: '2.0', method, params }))
}

function change(tabId: string, agent: StatusChange['agent'], state: AgentStateName, since = 1_000): StatusChange {
  return {
    tabId,
    agent,
    state,
    ...(state === 'needs-you' ? { reason: 'permission' as const } : {}),
    since,
    source: agent,
  }
}

// The indicator each part of the window draws for a tab, found by what it shows.
function indicatorsFor(label: string): Record<'pill' | 'pane', string | null> {
  const classOf = (root: Element | null) => root?.querySelector('.indicator')?.className ?? null
  const pill = [...document.querySelectorAll('#tabs > *')].find((el) => el.textContent?.includes(label)) ?? null
  const pane = [...document.querySelectorAll('#terminals .pane')].find((el) => el.querySelector('.pane-kind')?.textContent === label) ?? null
  return { pill: classOf(pill), pane: classOf(pane?.querySelector('.pane-head') ?? null) }
}

// A space's row in the sidebar, by the space's id.
function row(spaceId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`#spaces .space[data-space-id="${spaceId}"]`)
}

const lines = (spaceId: string) => ({
  name: row(spaceId)?.querySelector('.space-name')?.textContent ?? null,
  time: row(spaceId)?.querySelector('.space-time')?.textContent ?? null,
  // Line 2: what is open as "agents 3, terminals 1" read off the counts' labels, or its text ("No tabs open").
  detail: (() => {
    const counts = [...(row(spaceId)?.querySelectorAll('.space-count') ?? [])].map((el) => `${el.textContent} ${el.getAttribute('aria-label')?.replace(/^\d+ /, '')}`)
    return counts.length > 0 ? counts.join(', ') : (row(spaceId)?.querySelector('.space-detail')?.textContent ?? null)
  })(),
  node: row(spaceId)?.querySelector('.indicator')?.className ?? null,
})

// Opens (or closes) the sidebar's fold of quiet spaces, when there is one: a space with no tab visited is quiet, and these tests
// look at rows of spaces no one has visited.
function quietFold(open: boolean): void {
  const toggle = document.querySelector<HTMLElement>('#spaces .spaces-quiet')
  if (toggle && toggle.textContent?.endsWith(open ? '▾' : '▴')) toggle.click()
}

const space = (id: string, extra: Record<string, unknown> = {}) => ({
  id, path: `/Users/test/${id}`, name: id, label: null, repoName: null, parent: null, worktree: false, branch: null, ...extra,
})

describe('window status path', () => {
  beforeAll(async () => {
    // The page the window loads, without its script; the window's start-up reads the ids from it.
    const html = readFileSync(path.join(import.meta.dirname, 'index.html'), 'utf8')
    const body = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, '')
    document.body.innerHTML = body
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load: async () => [] } })
    fake.tabs = TABS
    const stored = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value) },
    })
    localStorage.setItem(VIEW_STATE_KEY, JSON.stringify({
      gridOn: true, gridTabs: ['tab-claude', 'tab-copilot', 'removed-tab'], activeSpace: 's1', activeTab: 'tab-copilot',
    }))
    await import('./main.ts')
    await vi.waitFor(() => expect(document.querySelectorAll('#tabs > *').length).toBe(TABS.length))
    await vi.waitFor(() => expect(document.querySelector('#grid-toggle')?.getAttribute('aria-pressed')).toBe('true'))
  })

  beforeEach(() => {
    fake.agents = []
  })

  afterAll(() => vi.unstubAllGlobals())

  it('restores grid mode, its surviving sessions and the selected tab on startup', () => {
    expect(document.querySelector('#terminals')?.classList.contains('grid-panes')).toBe(true)
    expect(document.querySelectorAll('#terminals .pane:not([hidden])')).toHaveLength(2)
    expect(document.querySelector('#tabs > .active')?.textContent).toContain('copilot')
    expect(document.querySelectorAll('#grid-toggle svg.icon-grid circle')).toHaveLength(4)
    expect(JSON.parse(localStorage.getItem(VIEW_STATE_KEY)!)).toEqual({
      gridOn: true, gridTabs: ['tab-claude', 'tab-copilot'], gridLayout: null, activeSpace: 's1', activeTab: 'tab-copilot',
    })
  })

  it('adds CLI sessions immediately without changing the active grid', async () => {
    const info: SpaceTabInfo = { ...TABS[0], id: 'cli-tab', label: 'CLI session' }
    notify('tabs.opened', info)
    await vi.waitFor(() => expect(fake.attaches).toContain('cli-tab'))
    expect(document.querySelectorAll('#tabs > *')).toHaveLength(4)
    expect(document.querySelector('#tabs > .active')?.textContent).toContain('copilot')
    expect(document.querySelector('#grid-toggle')?.getAttribute('aria-pressed')).toBe('true')
    notify('tabs.closed', { id: info.id })
  })

  it('adds a CLI-created space to the sidebar immediately', () => {
    notify('spaces.changed', { id: 'cli-space', path: '/cli', name: 'CLI space', label: null, repoName: null, parent: null, worktree: false, branch: null })
    quietFold(true)
    expect(document.querySelector('#spaces')?.textContent).toContain('CLI space')
    notify('spaces.removed', { id: 'cli-space' })
  })

  it('does not duplicate a UI-created tab when the opened notification precedes the RPC reply', async () => {
    fake.opening = { ...TABS[0], id: 'ui-tab', label: 'UI session' }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', ctrlKey: true, bubbles: true }))
    await vi.waitFor(() => expect(document.querySelector('#tabs > .active')?.textContent).toContain('UI session'))
    expect(document.querySelectorAll('#tabs > *')).toHaveLength(4)
    expect(fake.attaches.filter((id) => id === 'ui-tab')).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem(VIEW_STATE_KEY)!).activeTab).toBe('ui-tab')
    notify('tabs.closed', { id: 'ui-tab' })
    fake.opening = null
  })

  it('shows each typed agent tab in the same states as the core reports them', async () => {
    for (const state of STATES) {
      for (const { tabId, agent } of TYPED) notify('status.changed', change(tabId, agent, state))
      for (const label of ['claude', 'copilot', 'opencode']) {
        const shown = indicatorsFor(label)
        expect(shown.pill, `${label} tab strip, ${state}`).toBe(`indicator ind-${state}`)
        expect(shown.pane, `${label} pane header, ${state}`).toBe(`indicator ind-${state}`)
      }
      if (state === 'working') {
        const workingIndicator = [...document.querySelectorAll('#tabs .indicator')].find((node) =>
          node.closest('.tab')?.textContent?.includes('claude'),
        )
        expect(workingIndicator?.querySelectorAll('.agent-thinking-dot')).toHaveLength(3)
      }
      expect(lines('s1').node, `sidebar row, ${state}`).toBe(`indicator ind-${state}`)
    }
  })

  it('applies agent appearance choices across the window and restores theme defaults', () => {
    for (const { tabId, agent } of TYPED) notify('status.changed', change(tabId, agent, 'working'))

    const appearanceTab = document.querySelector<HTMLButtonElement>('.settings-tab[data-section="appearance"]')!
    appearanceTab.click()
    expect(appearanceTab.textContent).toContain('Appearance')
    expect(document.querySelector<HTMLElement>('.settings-section[data-section="appearance"]')?.hidden).toBe(false)
    expect(document.querySelector<HTMLElement>('.settings-section[data-section="general"]')?.hidden).toBe(true)

    const waitingSwatch = document.querySelector<HTMLButtonElement>('#appearance-needs-you [aria-label="Waiting color Teal"]')
    const runningSwatch = document.querySelector<HTMLButtonElement>('#appearance-working [aria-label="Running color Violet"]')
    const finishedSwatch = document.querySelector<HTMLButtonElement>('#appearance-finished [aria-label="Finished color Teal"]')
    expect(waitingSwatch).not.toBeNull()
    expect(runningSwatch).not.toBeNull()
    expect(finishedSwatch).not.toBeNull()
    waitingSwatch!.focus()
    waitingSwatch!.click()
    expect(document.activeElement).toBe(waitingSwatch)
    expect(waitingSwatch!.getAttribute('aria-pressed')).toBe('true')
    runningSwatch!.click()
    finishedSwatch!.click()

    const root = document.documentElement
    expect(root.style.getPropertyValue('--agent-state-needs-you')).toBe('var(--tile-1)')
    expect(root.style.getPropertyValue('--agent-state-working')).toBe('var(--tile-4)')
    expect(root.style.getPropertyValue('--agent-state-finished')).toBe('var(--tile-1)')

    const themeSelect = document.querySelector<HTMLSelectElement>('#theme-select')!
    themeSelect.value = 'nord'
    themeSelect.dispatchEvent(new Event('change', { bubbles: true }))
    expect(root.dataset.theme).toBe('nord')
    expect(root.style.getPropertyValue('--agent-state-working')).toBe('var(--tile-4)')

    const styleSelect = document.querySelector<HTMLSelectElement>('#working-indicator-style')!
    styleSelect.value = 'waveform'
    styleSelect.dispatchEvent(new Event('change', { bubbles: true }))
    expect(root.dataset.workingIndicator).toBe('waveform')
    expect(JSON.parse(localStorage.getItem('grove.agent-appearance')!).workingIndicator).toBe('waveform')
    for (const indicator of document.querySelectorAll('.indicator.ind-working')) {
      expect(indicator.querySelectorAll('.agent-wave-bar')).toHaveLength(3)
    }
    expect(document.querySelectorAll('#spaces .indicator.ind-working .agent-wave-bar')).toHaveLength(3)

    document.querySelector<HTMLButtonElement>('#appearance-needs-you [aria-label="Waiting color: Theme default"]')!.click()
    expect(root.style.getPropertyValue('--agent-state-needs-you')).toBe('')
    expect(JSON.parse(localStorage.getItem('grove.agent-appearance')!).needsYou).toBeNull()
  })

  it('shows a space as two lines: its name and time, then what is open as icons with counts', () => {
    const since = Date.now() - 90_000
    notify('status.changed', change('tab-claude', 'claude', 'needs-you', since))
    notify('status.changed', change('tab-copilot', 'copilot', 'working'))
    notify('status.changed', change('tab-opencode', 'opencode', 'idle'))
    expect(lines('s1')).toMatchObject({ name: 'proj', time: '1m', detail: '3 agents', node: 'indicator ind-needs-you' })
    expect(row('s1')?.classList.contains('working')).toBe(false)
    notify('status.changed', change('tab-claude', 'claude', 'idle'))
    expect(row('s1')?.classList.contains('working')).toBe(true)
    expect(lines('s1').detail).toBe('3 agents')
    notify('status.changed', change('tab-claude', 'claude', 'finished', since))
    expect(lines('s1')).toMatchObject({ time: '1m', detail: '3 agents', node: 'indicator ind-finished' })
    expect(row('s1')?.textContent).not.toContain('Ready')
    // No tab name on line 2, whichever tab decides.
    expect(row('s1')?.textContent).not.toMatch(/claude|copilot|opencode/)
  })

  it('shows agents then terminals as icons with counts, each only above zero', () => {
    for (const [id, agent] of [['tab-claude', 'claude'], ['tab-copilot', 'copilot'], ['tab-opencode', 'opencode']] as const) notify('status.changed', change(id, agent, 'idle'))
    notify('tabs.opened', { ...TABS[0], id: 'shell-b', spaceId: 's1', spacePath: '/Users/test/proj', label: 'sh' })
    expect(lines('s1').detail).toBe('3 agents, 1 terminal')
    expect(row('s1')?.querySelectorAll('.space-detail .space-count svg')).toHaveLength(2)
    notify('tabs.closed', { id: 'shell-b' })
    expect(row('s1')?.querySelectorAll('.space-detail .space-count')).toHaveLength(1)
  })

  it('opens the tab a row names when it needs you or has finished, else the one last visited', () => {
    notify('status.changed', change('tab-opencode', 'opencode', 'finished'))
    notify('status.changed', change('tab-claude', 'claude', 'idle'))
    row('s1')!.click()
    expect(document.querySelector('#tabs > .active')?.textContent).toContain('opencode')
    notify('status.changed', change('tab-opencode', 'opencode', 'working'))
    document.querySelector<HTMLElement>('#tabs > :not(.active)')!.querySelector<HTMLElement>('.tab-main')!.click()
    const visited = document.querySelector('#tabs > .active')?.textContent
    notify('spaces.changed', space('other'))
    notify('tabs.opened', { ...TABS[0], id: 'other-tab', spaceId: 'other', spacePath: '/Users/test/other', label: 'other' })
    quietFold(true)
    row('other')!.click()
    row('s1')!.click()
    expect(document.querySelector('#tabs > .active')?.textContent).toBe(visited)
    notify('tabs.closed', { id: 'other-tab' })
    notify('spaces.removed', { id: 'other' })
  })

  it('shows a plain space with no tabs on one line, and no tabs open on a worktree', () => {
    notify('spaces.changed', space('empty', { branch: 'dev' }))
    quietFold(true)
    expect(lines('empty')).toMatchObject({ name: 'empty', time: null, detail: null, node: 'indicator ind-unknown' })
    expect(row('empty')?.textContent).toContain('dev')
    notify('spaces.changed', space('empty-wt', { worktree: true, repoName: 'empty', parent: 'empty' }))
    quietFold(true)
    expect(lines('empty-wt')).toMatchObject({ detail: 'No tabs open', time: null, node: 'indicator ind-unknown' })
    expect(row('empty-wt')?.getAttribute('title')).toBe('/Users/test/empty-wt')
    expect(row('empty-wt')?.querySelector('.indicator')?.getAttribute('aria-label')).toBe('no tabs open')
    notify('spaces.removed', { id: 'empty-wt' })
    notify('spaces.removed', { id: 'empty' })
  })

  it('counts a terminal with no time; a plain space is two lines while it has a live tab', () => {
    notify('spaces.changed', space('shells', { branch: 'dev' }))
    notify('tabs.opened', { ...TABS[0], id: 'shell-a', spaceId: 'shells', spacePath: '/Users/test/shells', label: 'sh' })
    expect(lines('shells')).toMatchObject({ name: 'shells', time: null, detail: '1 terminal', node: 'indicator ind-idle' })
    notify('tabs.exit', { id: 'shell-a', exitCode: 0 })
    expect(lines('shells')).toMatchObject({ detail: null, node: 'indicator ind-unknown' })
    notify('tabs.closed', { id: 'shell-a' })
    notify('spaces.removed', { id: 'shells' })
  })

  it('draws a repo with worktrees under a heading, and clicking the heading switches no space', () => {
    notify('spaces.changed', space('s1', { path: '/Users/test/proj', name: 'proj', repoName: 'proj', branch: 'main' }))
    notify('spaces.changed', space('proj-wt', { name: 'proj-wt', worktree: true, repoName: 'proj', parent: 's1', branch: 'feat' }))
    notify('spaces.changed', space('lone-wt', { name: 'lone-wt', worktree: true, repoName: 'lone', branch: 'x' }))
    quietFold(true)
    const headings = [...document.querySelectorAll('#spaces .heading')]
    expect(headings.map((el) => el.querySelector('.heading-name')?.textContent)).toEqual(['proj', 'lone'])
    expect([...headings[0].querySelectorAll('.space-name')].map((el) => el.textContent)).toEqual(['main', 'proj-wt'])
    expect([...headings[1].querySelectorAll('.space-name')].map((el) => el.textContent)).toEqual(['lone-wt'])
    expect(headings[0].querySelector('.heading-name')?.closest('button')).toBeNull()
    const active = document.querySelector('#tabs > .active')?.textContent
    headings[0].querySelector<HTMLElement>('.heading-name')!.click()
    expect(row('s1')?.getAttribute('aria-current')).toBe('true')
    expect(document.querySelector('#tabs > .active')?.textContent).toBe(active)
    expect(lines('s1').name).toBe('main')
    headings[0].querySelector<HTMLElement>('.heading-name')!.click()
    notify('spaces.removed', { id: 'proj-wt' })
    notify('spaces.removed', { id: 'lone-wt' })
    notify('spaces.changed', space('s1', { path: '/Users/test/proj', name: 'proj' }))
    expect(document.querySelector('#spaces .heading')).toBeNull()
  })

  it('folds a heading, rolls its rows\' state up while folded, and keeps it across a reload', () => {
    const headingOf = (repo: string) => [...document.querySelectorAll<HTMLElement>('#spaces .heading')].find((el) => el.querySelector('.heading-label')?.textContent === repo)!
    notify('spaces.changed', space('s1', { path: '/Users/test/proj', name: 'proj', repoName: 'proj', branch: 'main' }))
    notify('spaces.changed', space('proj-wt', { name: 'proj-wt', worktree: true, repoName: 'proj', parent: 's1' }))
    notify('spaces.changed', space('lone-wt', { name: 'lone-wt', worktree: true, repoName: 'lone' }))
    notify('tabs.opened', { ...TABS[0], id: 'lone-tab', spaceId: 'lone-wt', spacePath: '/Users/test/lone-wt', label: 'lone' })
    notify('status.changed', change('lone-tab', 'claude', 'working'))
    const lone = (): HTMLElement => headingOf('lone')
    expect(lone().querySelector('.heading-name .indicator')).toBeNull()
    lone().querySelector<HTMLElement>('.heading-name')!.click()
    expect(lone().querySelector<HTMLElement>('.graph')!.hidden).toBe(true)
    expect(lone().querySelector('.heading-name .indicator')?.className).toBe('indicator ind-working')
    notify('status.changed', change('lone-tab', 'claude', 'needs-you'))
    expect(lone().querySelector('.heading-name .indicator')?.className).toBe('indicator ind-needs-you')
    expect(JSON.parse(localStorage.getItem('grove.sidebar-folds')!)).toEqual(['lone'])
    // The active space's heading stays open while it is active, and the saved choice still changes.
    headingOf('proj').querySelector<HTMLElement>('.heading-name')!.click()
    expect(headingOf('proj').querySelector<HTMLElement>('.graph')!.hidden).toBe(false)
    expect(JSON.parse(localStorage.getItem('grove.sidebar-folds')!)).toEqual(['lone', 'proj'])
    // Going to a tab in the folded heading opens it, and leaving brings the saved fold back.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '.', ctrlKey: true, bubbles: true }))
    expect(lone().querySelector<HTMLElement>('.graph')!.hidden).toBe(false)
    expect(lone().querySelector('.heading-name .indicator')).toBeNull()
    expect(headingOf('proj').querySelector<HTMLElement>('.graph')!.hidden).toBe(true)
    headingOf('proj').querySelector<HTMLElement>('.heading-name')!.click()
    lone().querySelector<HTMLElement>('.heading-name')!.click()
    expect(JSON.parse(localStorage.getItem('grove.sidebar-folds')!)).toEqual([])
    notify('tabs.closed', { id: 'lone-tab' })
    notify('spaces.removed', { id: 'proj-wt' })
    notify('spaces.removed', { id: 'lone-wt' })
    notify('spaces.changed', space('s1', { path: '/Users/test/proj', name: 'proj' }))
    row('s1')!.click()
  })

  it('folds the quiet spaces behind one line that counts spaces, and opens them in the sidebar order', () => {
    const listed = () => [...document.querySelectorAll('#spaces .space-name')].map((el) => el.textContent)
    const fold = () => document.querySelector<HTMLElement>('#spaces .spaces-quiet')
    notify('spaces.changed', space('s1', { path: '/Users/test/proj', name: 'proj', repoName: 'proj', branch: 'main' }))
    notify('spaces.changed', space('proj-wt', { name: 'proj-wt', worktree: true, repoName: 'proj', parent: 's1' }))
    notify('spaces.changed', space('old', { repoName: 'old', branch: 'master' }))
    notify('spaces.changed', space('old-wt', { name: 'old-wt', worktree: true, repoName: 'old', parent: 'old' }))
    notify('spaces.changed', space('lone', { branch: 'master' }))
    quietFold(false)
    // The active space and its heading stay; the quiet plain space and the all-quiet heading are folded.
    expect(listed()).toEqual(['main', 'proj-wt'])
    expect(fold()?.textContent).toBe('3 quiet spaces ▾')
    fold()!.click()
    expect(listed()).toEqual(['main', 'proj-wt', 'master', 'old-wt', 'lone'])
    expect(fold()?.textContent).toBe('Hide quiet spaces ▴')
    fold()!.click()
    expect(listed()).toEqual(['main', 'proj-wt'])
    // Something that needs you in a folded space brings its heading back.
    notify('tabs.opened', { ...TABS[0], id: 'old-tab', spaceId: 'old-wt', spacePath: '/Users/test/old-wt', label: 'old' })
    notify('status.changed', change('old-tab', 'claude', 'needs-you'))
    expect(listed()).toEqual(['main', 'proj-wt', 'master', 'old-wt'])
    expect(fold()?.textContent).toBe('1 quiet space ▾')
    notify('tabs.closed', { id: 'old-tab' })
    for (const id of ['proj-wt', 'old', 'old-wt', 'lone']) notify('spaces.removed', { id })
    notify('spaces.changed', space('s1', { path: '/Users/test/proj', name: 'proj' }))
    expect(fold()).toBeNull()
  })

  it('draws Go to as the sidebar\'s tree: a heading, branches to its spaces, nodes, and the same quiet line', () => {
    const goto = () => document.querySelector<HTMLElement>('#goto-list')!
    notify('spaces.changed', space('s1', { path: '/Users/test/proj', name: 'proj', repoName: 'proj', branch: 'main' }))
    notify('spaces.changed', space('proj-wt', { name: 'proj-wt', worktree: true, repoName: 'proj', parent: 's1' }))
    notify('spaces.changed', space('old', { repoName: 'old', branch: 'master' }))
    notify('spaces.changed', space('old-wt', { name: 'old-wt', worktree: true, repoName: 'old', parent: 'old' }))
    notify('status.changed', change('tab-claude', 'claude', 'needs-you'))
    document.querySelector<HTMLElement>('#search-button')!.click()
    // One heading holds the main checkout (named by its branch) and the worktree; the tabs keep their rows.
    expect([...goto().querySelectorAll('.goto-heading .heading-label')].map((el) => el.textContent)).toEqual(['proj'])
    expect([...goto().querySelectorAll('.goto-heading .goto-space-name')].map((el) => el.textContent)).toEqual(['main', 'proj-wt'])
    expect(goto().querySelector('.goto-heading .goto-space .indicator')?.className).toBe('indicator ind-needs-you')
    expect(goto().querySelector('.goto-heading .goto-space .indicator')?.getAttribute('aria-label')).toBe('needs you')
    expect(goto().querySelectorAll('.goto-heading .goto-row').length).toBeGreaterThan(0)
    expect(goto().querySelector('.space-tile')).toBeNull()
    // The quiet spaces fold as in the sidebar, and a query searches them too.
    const fold = () => goto().querySelector<HTMLElement>('.goto-quiet')
    expect(fold()?.textContent).toBe('2 quiet spaces ▾')
    fold()!.click()
    expect(fold()?.textContent).toBe('Hide quiet spaces ▴')
    expect([...goto().querySelectorAll('.goto-space-name')].map((el) => el.textContent)).toEqual(['main', 'proj-wt', 'master', 'old-wt'])
    const input = document.querySelector<HTMLInputElement>('#goto-input')!
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    notify('spaces.removed', { id: 'old-wt' })
    notify('spaces.removed', { id: 'old' })
    notify('spaces.removed', { id: 'proj-wt' })
    notify('spaces.changed', space('s1', { path: '/Users/test/proj', name: 'proj' }))
  })

  it('names no agent type anywhere in the sidebar, and draws no mark or tile', () => {
    expect(document.querySelector('#spaces .agent-mark, #spaces .space-tile, #agents')).toBeNull()
    expect(document.querySelector('#spaces')?.textContent).not.toMatch(/Claude|Copilot|OpenCode/)
  })

  it('shows an unknown agent minimum-version hint only while its PTY is live', () => {
    notify('status.changed', change('tab-copilot', 'copilot', 'unknown'))

    const tab = [...document.querySelectorAll('#tabs > *')].find((el) => el.textContent?.includes('copilot'))
    const indicator = tab?.querySelector('.tab-main .indicator')
    expect(indicator).not.toBeNull()
    for (const attribute of ['title', 'aria-label']) {
      expect(indicator?.getAttribute(attribute)).toContain('no status report yet')
      expect(indicator?.getAttribute(attribute)).toContain('1.0.107')
    }

    notify('tabs.exit', { id: 'tab-copilot', exitCode: 0 })
    for (const attribute of ['title', 'aria-label']) {
      expect(indicator?.getAttribute(attribute)).not.toContain('no status report yet')
      expect(indicator?.getAttribute(attribute)).not.toContain('1.0.107')
    }
  })

  it('offers Resume in the pane of an exited tab whose agent can resume, and only there', async () => {
    const paneOf = (label: string) =>
      [...document.querySelectorAll('#terminals .pane')].find((el) => el.querySelector('.pane-kind')?.textContent === label)!
    const resumeIn = (label: string) => [...paneOf(label).querySelectorAll('button')].find((b) => b.textContent === 'Resume')
    const info = (tabId: string, agent: AgentInfo['agent'], resumable: boolean) =>
      ({ tabId, agent, state: 'idle', since: 1_000, source: agent, resumable }) as AgentInfo
    notify('tabs.exit', { id: 'tab-claude', exitCode: 0 })
    notify('tabs.exit', { id: 'tab-opencode', exitCode: 0 })
    fake.agents = [info('tab-claude', 'claude', true), info('tab-copilot', 'copilot', true), info('tab-opencode', 'opencode', false)]
    notify('status.changed', change('tab-claude', 'claude', 'idle'))
    await vi.waitFor(() => expect(resumeIn('claude')).toBeDefined())
    expect(resumeIn('opencode')).toBeUndefined()
    resumeIn('claude')!.click()
    await vi.waitFor(() => expect(fake.creates).toContainEqual(expect.objectContaining({ id: 'tab-claude', agent: { kind: 'claude' } })))
    await vi.waitFor(() => expect(fake.attaches.filter((id) => id === 'tab-claude').length).toBeGreaterThan(1))
  })
})
