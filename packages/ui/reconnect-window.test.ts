// @vitest-environment happy-dom
// The window after the core restarts, through the real entry point: the core gives each connection its own holder
// attachments, so a tab shows output only once it is attached on the current connection. A tab whose attach fails while
// the window reconnects must not stay typeable-but-silent.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SpaceTabInfo } from '../protocol/messages.ts'
import { DEFAULT_VALUES } from '../core/config/schema.ts'

const fake = vi.hoisted(() => ({
  channel: null as null | { onmessage: (line: string) => void },
  // The tabs attached on the current connection: the only ones the core sends output for.
  attached: new Set<string>(),
  // Attach calls that fail from now on, as an attach does when the old connection's reader drops its waiter.
  failAttaches: 0,
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
          tabs: TABS,
          refused: null,
        }
      case 'agents.list':
        return []
      case 'config.get':
        return { path: '', values: DEFAULT_VALUES, notes: {} }
      case 'integration.status':
        return { agents: [] }
      case 'tabs.attach':
        if (fake.failAttaches > 0) {
          fake.failAttaches--
          throw new Error('the core did not answer')
        }
        fake.attached.add(params.id!)
        return { screenB64: '', cols: 80, rows: 24 }
      default:
        return {}
    }
  }
  const invoke = async (command: string, args?: { request?: { id: number; method: string; params?: { id?: string } } }) => {
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
]

function notify(method: string, params: unknown): void {
  fake.channel!.onmessage(JSON.stringify({ jsonrpc: '2.0', method, params }))
}

describe('window after the core restarts', () => {
  beforeAll(async () => {
    const html = readFileSync(path.join(import.meta.dirname, 'index.html'), 'utf8')
    const body = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, '')
    document.body.innerHTML = body
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load: async () => [] } })
    const stored = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value) },
    })
    await import('./main.ts')
    await vi.waitFor(() => expect(fake.attached.has('tab-claude')).toBe(true))
  })

  afterAll(() => vi.unstubAllGlobals())

  it('attaches a tab again on the new connection even when the first attach after the reconnect fails', async () => {
    // The old connection is gone, and with it the core's holder attachment for this window.
    fake.attached.clear()
    fake.failAttaches = 1
    notify('bridge.closed', {})
    await vi.waitFor(() => expect(fake.failAttaches).toBe(0))
    // Without an attach on this connection the tab takes typed input but gets no output, so the window must try again.
    await vi.waitFor(() => expect(fake.attached.has('tab-claude')).toBe(true), { timeout: 4000 })
  })
})
