// @vitest-environment happy-dom
// The window's status path, through the real entry point: the core's status.changed notifications arrive on the bridge's
// channel and must draw the indicator on the tab strip, the pane header, the agents list and the space tile. Each agent
// is typed by hand into a shell tab, as a human does, so its tab was created as a shell.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentInfo, AgentStateName, SpaceTabInfo, StatusChange } from '../protocol/messages.ts'
import { DEFAULT_VALUES } from '../core/config/schema.ts'

const fake = vi.hoisted(() => ({
  channel: null as null | { onmessage: (line: string) => void },
  tabs: [] as unknown[],
  agents: [] as unknown[],
}))

vi.mock('@tauri-apps/api/core', () => {
  class Channel {
    onmessage: (line: string) => void = () => {}
    constructor() {
      fake.channel = this
    }
  }
  const answer = (method: string): unknown => {
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
      case 'tabs.attach':
        return { screenB64: '', cols: 80, rows: 24 }
      default:
        return {}
    }
  }
  const invoke = async (command: string, args?: { events?: unknown; request?: { id: number; method: string } }) => {
    if (command === 'env_info') return { home: '/Users/test' }
    if (command === 'connect') return undefined
    if (command === 'rpc') {
      const request = args!.request!
      return JSON.stringify({ jsonrpc: '2.0', id: request.id, result: answer(request.method) })
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

function change(tabId: string, agent: StatusChange['agent'], state: AgentStateName): StatusChange {
  return {
    tabId,
    agent,
    state,
    ...(state === 'needs-you' ? { reason: 'permission' as const } : {}),
    since: 1_000,
    source: agent,
  }
}

// The indicator each part of the window draws for a tab, found by what it shows.
function indicatorsFor(label: string): Record<'pill' | 'pane' | 'agent' | 'space', string | null> {
  const classOf = (root: Element | null) => root?.querySelector('.indicator')?.className ?? null
  const pill = [...document.querySelectorAll('#tabs > *')].find((el) => el.textContent?.includes(label)) ?? null
  const pane = [...document.querySelectorAll('#terminals .pane')].find((el) => el.querySelector('.pane-kind')?.textContent === label) ?? null
  const agent = [...document.querySelectorAll('#agents .agent-row')].find((el) => el.querySelector('.agent-label')?.textContent === label) ?? null
  return {
    pill: classOf(pill),
    pane: classOf(pane?.querySelector('.pane-head') ?? null),
    agent: classOf(agent),
    space: null,
  }
}

function spaceIndicator(): string | null {
  return document.querySelector('#spaces .space .indicator')?.className ?? null
}

describe('window status path', () => {
  beforeAll(async () => {
    // The page the window loads, without its script; the window's start-up reads the ids from it.
    const html = readFileSync(path.join(import.meta.dirname, 'index.html'), 'utf8')
    const body = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, '')
    document.body.innerHTML = body
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load: async () => [] } })
    fake.tabs = TABS
    await import('./main.ts')
    await vi.waitFor(() => expect(document.querySelectorAll('#tabs > *').length).toBe(TABS.length))
  })

  beforeEach(() => {
    fake.agents = []
  })

  it('shows each typed agent tab in the same states as the core reports them', async () => {
    for (const state of STATES) {
      for (const { tabId, agent } of TYPED) notify('status.changed', change(tabId, agent, state))
      for (const label of ['claude', 'copilot', 'opencode']) {
        const shown = indicatorsFor(label)
        expect(shown.pill, `${label} tab strip, ${state}`).toBe(`indicator ind-${state}`)
        expect(shown.pane, `${label} pane header, ${state}`).toBe(`indicator ind-${state}`)
        expect(shown.agent, `${label} agents list, ${state}`).toBe(`indicator ind-${state}`)
      }
      expect(spaceIndicator(), `space tile, ${state}`).toBe(`indicator ind-${state}`)
    }
  })
})
