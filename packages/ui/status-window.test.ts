// @vitest-environment happy-dom
// The window's status path, through the real entry point: the core's status.changed notifications arrive on the bridge's
// channel and must draw the indicator on the tab strip, the pane header and the sidebar's rows. Each agent
// is typed by hand into a shell tab, as a human does, so its tab was created as a shell.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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
  // The spaces the test announced, by id, so the mocked core can answer a pin with the space as it would now be.
  known: new Map<string, Record<string, unknown>>(),
  pinCalls: [] as Array<{ id: string; pinned: boolean }>,
  // A message makes the next pins fail as the core does while its state file is refused.
  pinFails: null as string | null,
  clock: 1_000,
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
      case 'spaces.pin': {
        const { id, pinned } = params as unknown as { id: string; pinned: boolean }
        fake.pinCalls.push({ id, pinned })
        if (fake.pinFails !== null) throw new Error(fake.pinFails)
        const before = fake.known.get(id)!
        // Pinning a pinned space keeps its place, as in the core.
        const pinnedAt = pinned ? (typeof before.pinnedAt === 'number' ? before.pinnedAt : ++fake.clock) : null
        const next = { ...before, pinnedAt }
        fake.known.set(id, next)
        fake.channel!.onmessage(JSON.stringify({ jsonrpc: '2.0', method: 'spaces.changed', params: next }))
        return {}
      }
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
      try {
        return JSON.stringify({ jsonrpc: '2.0', id: request.id, result: answer(request.method, request.params) })
      } catch (error) {
        return JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: (error as Error).message } })
      }
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

  it('shows a space on one line: node, name, what is open as icons with counts, and the time', () => {
    const since = Date.now() - 90_000
    notify('status.changed', change('tab-claude', 'claude', 'needs-you', since))
    notify('status.changed', change('tab-copilot', 'copilot', 'working'))
    notify('status.changed', change('tab-opencode', 'opencode', 'idle'))
    expect(lines('s1')).toMatchObject({ name: 'proj', time: '1m', detail: '3 agents', node: 'indicator ind-needs-you' })
    expect(row('s1')?.classList.contains('state-working')).toBe(false)
    notify('status.changed', change('tab-claude', 'claude', 'idle'))
    expect(row('s1')?.classList.contains('state-working')).toBe(true)
    expect(lines('s1').detail).toBe('3 agents')
    notify('status.changed', change('tab-claude', 'claude', 'finished', since))
    expect(lines('s1')).toMatchObject({ time: '1m', detail: '3 agents', node: 'indicator ind-finished' })
    expect(row('s1')?.textContent).not.toContain('Ready')
    // Something that needs you reads heavier and carries its colour on the time; an idle row has no time at all.
    notify('status.changed', change('tab-claude', 'claude', 'needs-you', since))
    expect(row('s1')?.classList.contains('state-needs-you')).toBe(true)
    notify('status.changed', change('tab-claude', 'claude', 'idle'))
    notify('status.changed', change('tab-copilot', 'copilot', 'idle'))
    expect(lines('s1')).toMatchObject({ time: null, node: 'indicator ind-idle' })
    notify('status.changed', change('tab-claude', 'claude', 'finished', since))
    // No tab name on the row, whichever tab decides.
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
    // The quiet spaces fold as in the sidebar, and a query searches them too.
    const fold = () => goto().querySelector<HTMLElement>('.goto-quiet')
    expect(fold()?.textContent).toBe('2 quiet spaces ▾')
    fold()!.click()
    expect(fold()?.textContent).toBe('Hide quiet spaces ▴')
    expect([...goto().querySelectorAll('.goto-space-name')].map((el) => el.textContent)).toEqual(['main', 'proj-wt', 'master', 'old-wt'])
    const input = document.querySelector<HTMLInputElement>('#goto-input')!
    // Typing flattens it: worktrees then tabs, each hit with its match marked, the count in the field and the chips counting.
    input.value = 'proj'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect([...goto().querySelectorAll('.goto-section')].map((el) => el.textContent)).toEqual(['Worktrees'])
    expect(goto().querySelector('.goto-hit .goto-row-name')?.textContent).toBe('main')
    expect(goto().querySelector('.goto-hit .goto-hit-where')?.textContent).toBe('proj')
    expect(document.querySelector('#goto-count')?.textContent).toBe('1 result')
    expect(document.querySelector('#goto-chip-needs')?.textContent).toBe('Needs you1')
    expect(goto().querySelector('.goto-heading')).toBeNull()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    notify('spaces.removed', { id: 'old-wt' })
    notify('spaces.removed', { id: 'old' })
    notify('spaces.removed', { id: 'proj-wt' })
    notify('spaces.changed', space('s1', { path: '/Users/test/proj', name: 'proj' }))
  })

  it('names no agent type anywhere in the sidebar, and draws no mark, tile or agent list', () => {
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

  describe('pinned spaces', () => {
    // The spaces whose row carries the pin, and whether any does. A pinned space is never folded away, so it is always drawn.
    const pinnedIds = () => [...document.querySelectorAll<HTMLElement>('#spaces .space.pinned')].map((el) => el.dataset.spaceId)
    const anyPinned = () => pinnedIds().length > 0
    // The pin at the end of a row: only a pinned row has one.
    const pinOf = (id: string) => treeRow(id).querySelector<HTMLElement>('.space-pin')
    // A space the core would announce: the window hears it, and the mocked core can answer a pin on it.
    const announce = (id: string, extra: Record<string, unknown> = {}) => {
      const info = space(id, extra)
      fake.known.set(id, { ...fake.known.get(id), ...info })
      notify('spaces.changed', fake.known.get(id))
    }
    const remove = (id: string) => {
      fake.known.delete(id)
      notify('spaces.removed', { id })
    }
    const press = (init: KeyboardEventInit) => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }))
    const PIN_KEY = { key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true }
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
    const menuFor = (el: Element): string[] => {
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
      return [...document.querySelectorAll('.context-menu .context-item')].map((item) => item.textContent ?? '')
    }
    const chooseInMenu = async (label: string) => {
      ;[...document.querySelectorAll<HTMLElement>('.context-menu .context-item')].find((item) => item.textContent === label)!.click()
      await settle()
    }
    // The tree row of a space, with the quiet fold open so a space nobody visited is there to find.
    const treeRow = (id: string): HTMLElement => {
      quietFold(true)
      return row(id)!
    }
    const pinThroughMenu = async (id: string) => {
      expect(menuFor(treeRow(id))).toContain('Pin')
      await chooseInMenu('Pin')
    }
    const repoSpaces = () => {
      announce('s1', { path: '/Users/test/proj', name: 'proj', repoName: 'proj', branch: 'main' })
      announce('proj-wt', { name: 'proj-wt', worktree: true, repoName: 'proj', parent: 's1', branch: 'feat' })
    }
    // Back to the plain window the other tests expect: nothing pinned, one plain space, selected.
    const reset = async () => {
      quietFold(false)
      for (const id of [...fake.known.keys()]) if (id !== 's1') remove(id)
      announce('s1', { path: '/Users/test/proj', name: 'proj', pinnedAt: null })
      treeRow('s1').click()
      // The fold stays open in memory when its line went away; a quiet space brings the line back to close it.
      announce('tmp-quiet')
      quietFold(false)
      remove('tmp-quiet')
      fake.pinFails = null
      fake.pinCalls.length = 0
    }
    const gotoNames = () =>
      [...document.querySelectorAll<HTMLElement>('#goto-list > *')].flatMap((node) => {
        const name = node.querySelector('.goto-space-name, .goto-row-name')?.textContent
        return name ? [{ name, pinned: node.querySelector('.goto-pin') !== null }] : []
      })
    const openGoToWith = (query = '') => {
      if (document.querySelector<HTMLElement>('#goto-modal')!.hidden) document.querySelector<HTMLElement>('#search-button')!.click()
      const input = document.querySelector<HTMLInputElement>('#goto-input')!
      input.value = query
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const closeGoTo = () => document.querySelector<HTMLInputElement>('#goto-input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    afterEach(async () => {
      closeGoTo()
      await reset()
    })

    it('marks a pinned space\'s own row with a pin, and draws no section for pins', async () => {
      announce('s1', { path: '/Users/test/proj', name: 'proj' })
      expect(anyPinned()).toBe(false)
      expect(pinOf('s1')).toBeNull()
      press(PIN_KEY)
      await vi.waitFor(() => expect(pinnedIds()).toEqual(['s1']))
      expect(pinOf('s1')?.getAttribute('aria-label')).toBe('Unpin proj')
      // Nothing else is drawn: one row for the space, no Pinned section, no extra heading.
      expect(document.querySelector('#pinned, .pinned-label')).toBeNull()
      expect(document.querySelectorAll('#spaces .space[data-space-id="s1"]')).toHaveLength(1)
      press(PIN_KEY)
      await vi.waitFor(() => expect(anyPinned()).toBe(false))
      expect(pinOf('s1')).toBeNull()
    })

    it('unpins from the pin on the row without opening the space, and an unpinned row has no pin', async () => {
      repoSpaces()
      const names = () => [...document.querySelectorAll('#spaces .space-name')].map((el) => el.textContent)
      const before = names()
      expect(document.querySelector('#spaces .space-pin')).toBeNull()
      await pinThroughMenu('proj-wt')
      expect(pinnedIds()).toEqual(['proj-wt'])
      expect(document.querySelectorAll('#spaces .space-pin')).toHaveLength(1)
      expect(row('s1')?.getAttribute('aria-current')).toBe('true')
      expect(names()).toEqual(before)
      expect([...document.querySelectorAll('#spaces .heading .heading-label')].map((el) => el.textContent)).toEqual(['proj'])
      pinOf('proj-wt')!.click()
      await vi.waitFor(() => expect(anyPinned()).toBe(false))
      expect(row('s1')?.getAttribute('aria-current')).toBe('true')
    })

    it('shows no pin in the tab strip, the pane header or the title bar', async () => {
      announce('s1', { path: '/Users/test/proj', name: 'proj' })
      press(PIN_KEY)
      await vi.waitFor(() => expect(anyPinned()).toBe(true))
      expect(document.querySelector('#tabs .icon-pin, .tabstrip .icon-pin, #terminals .icon-pin')).toBeNull()
    })

    it('keeps Cmd+1 to Cmd+9 where they were when spaces are pinned', async () => {
      repoSpaces()
      announce('lone', { branch: 'dev' })
      await pinThroughMenu('lone')
      await pinThroughMenu('proj-wt')
      // The tree is main, proj-wt, lone, whatever is pinned.
      treeRow('lone').click()
      press({ key: '1', code: 'Digit1', ctrlKey: true })
      expect(row('s1')?.getAttribute('aria-current')).toBe('true')
      press({ key: '3', code: 'Digit3', ctrlKey: true })
      expect(row('lone')?.getAttribute('aria-current')).toBe('true')
      press({ key: '2', code: 'Digit2', ctrlKey: true })
      expect(row('proj-wt')?.getAttribute('aria-current')).toBe('true')
    })

    it('never folds a pinned space into the quiet count', async () => {
      announce('s1', { path: '/Users/test/proj', name: 'proj' })
      announce('hush', { branch: 'dev' })
      const fold = () => document.querySelector<HTMLElement>('#spaces .spaces-quiet')
      expect(fold()?.textContent).toBe('1 quiet space ▾')
      expect(row('hush')).toBeNull()
      await pinThroughMenu('hush')
      quietFold(false)
      expect(fold()).toBeNull()
      expect(row('hush')?.classList.contains('pinned')).toBe(true)
    })

    it('has Pin or Unpin in a space\'s menu by its state, and none in a heading\'s', async () => {
      repoSpaces()
      expect(menuFor(treeRow('proj-wt'))).toEqual(['Rename', 'Pin', 'New worktree', 'Open worktree', 'Close'])
      await chooseInMenu('Pin')
      expect(pinnedIds()).toEqual(['proj-wt'])
      expect(menuFor(treeRow('proj-wt'))).toContain('Unpin')
      await chooseInMenu('Unpin')
      expect(anyPinned()).toBe(false)
      const heading = menuFor(document.querySelector('#spaces .heading .heading-name')!)
      expect(heading).toEqual(['New worktree', 'Open worktree'])
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    it('toggles the pin of the active space with its key', async () => {
      announce('s1', { path: '/Users/test/proj', name: 'proj' })
      press(PIN_KEY)
      await vi.waitFor(() => expect(pinnedIds()).toEqual(['s1']))
      press(PIN_KEY)
      await vi.waitFor(() => expect(anyPinned()).toBe(false))
    })

    it('says so when a pin fails, and shows no pin', async () => {
      announce('s1', { path: '/Users/test/proj', name: 'proj' })
      fake.pinFails = 'state file has version 2; this core reads version 1'
      press(PIN_KEY)
      await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('version 2'))
      expect(anyPinned()).toBe(false)
    })

    it('ends a pin with its space: one added again is not pinned', async () => {
      repoSpaces()
      await pinThroughMenu('proj-wt')
      remove('proj-wt')
      announce('proj-wt', { name: 'proj-wt', worktree: true, repoName: 'proj', parent: 's1', branch: 'feat' })
      expect(anyPinned()).toBe(false)
    })

    describe('in Go to', () => {
      // Three plain spaces with one tab each, none visited: quiet unless pinned or busy.
      const threeSpaces = () => {
        for (const [id, name] of [['a1', 'alpha'], ['b1', 'bravo'], ['c1', 'charlie']] as const) {
          announce(id, { name })
          notify('tabs.opened', { ...TABS[0], id: `${id}-tab`, spaceId: id, spacePath: `/Users/test/${id}`, label: name })
        }
      }
      const dropTabs = () => {
        for (const id of ['a1', 'b1', 'c1']) notify('tabs.closed', { id: `${id}-tab` })
      }

      it('lists pinned spaces first within each group, marked, once, and never behind the quiet line', async () => {
        announce('s1', { path: '/Users/test/proj', name: 'proj' })
        threeSpaces()
        await pinThroughMenu('b1')
        // After the awaits: the window re-reads the agents list as it goes, and the mocked core has none to give.
        notify('status.changed', change('c1-tab', 'claude', 'needs-you'))
        openGoToWith()
        // Needs-you leads though it is not pinned; then the active space; then the pinned one, though it is quiet; alpha is quiet.
        expect(gotoNames()).toEqual([
          { name: 'charlie', pinned: false },
          { name: 'proj', pinned: false },
          { name: 'bravo', pinned: true },
        ])
        expect(document.querySelector('#goto-list .goto-quiet')?.textContent).toBe('1 quiet space ▾')
        // No way to pin or unpin from here.
        expect(document.querySelector('#goto-list .space-pin')).toBeNull()
        expect([...document.querySelectorAll('#goto-list button')].some((el) => /pin/i.test(el.textContent ?? '') || /pin/i.test(el.getAttribute('aria-label') ?? ''))).toBe(false)
        closeGoTo()
        dropTabs()
      })

      it('puts pinned spaces first, in pin order, among the rest of their group', async () => {
        announce('s1', { path: '/Users/test/proj', name: 'proj' })
        threeSpaces()
        await pinThroughMenu('c1')
        await pinThroughMenu('a1')
        openGoToWith()
        document.querySelector<HTMLElement>('#goto-list .goto-quiet')?.click()
        const names = gotoNames()
        expect(names.map((n) => n.name)).toEqual(['proj', 'charlie', 'alpha', 'bravo'])
        expect(names.filter((n) => n.pinned).map((n) => n.name)).toEqual(['charlie', 'alpha'])
        closeGoTo()
        dropTabs()
      })

      it('keeps the ranking of a search and only adds the mark', async () => {
        announce('s1', { path: '/Users/test/proj', name: 'proj' })
        threeSpaces()
        const hits = () => [...document.querySelectorAll<HTMLElement>('#goto-list .goto-hit')].map((el) => ({ name: el.querySelector('.goto-row-name')?.textContent, pinned: el.querySelector('.goto-pin') !== null }))
        openGoToWith('a')
        const before = hits()
        expect(before.length).toBeGreaterThan(1)
        expect(before.some((hit) => hit.pinned)).toBe(false)
        closeGoTo()
        await pinThroughMenu('c1')
        openGoToWith('a')
        const after = hits()
        expect(after.map((hit) => hit.name)).toEqual(before.map((hit) => hit.name))
        expect(after.filter((hit) => hit.pinned).map((hit) => hit.name)).toEqual(['charlie'])
        closeGoTo()
        dropTabs()
      })
    })

    // Last of the file: dropping the only space takes its tabs with it, which the tests above must not lose.
    it('does nothing with no active space', async () => {
      announce('s1', { path: '/Users/test/proj', name: 'proj' })
      remove('s1')
      fake.pinCalls.length = 0
      press(PIN_KEY)
      await settle()
      expect(fake.pinCalls).toEqual([])
      expect(anyPinned()).toBe(false)
    })
  })

})
