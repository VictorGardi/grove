import { describe, expect, it } from 'vitest'
import type { AgentKind } from './status/adapter.ts'
import { agentOfProgram, nextRoot, Presence, type PresenceTab, type PresencePorts } from './presence.ts'

// A small world: tabs, their spaces and the agent kinds the core has recorded or adopted.
function world(initial: PresenceTab[], spaceRoot = '/work') {
  const tabs = new Map(initial.map((tab) => [tab.id, { ...tab }]))
  const recorded = new Map<string, AgentKind>()
  const adopted = new Map<string, AgentKind>()
  const identified = new Map<string, string>()
  const roots: string[] = []
  let root = spaceRoot
  const log: string[] = []
  const ports: PresencePorts = {
    clock: () => 10_000,
    tabs: async () => [...tabs.values()],
    spaceOf: (tabId) => (tabs.has(tabId) ? { key: 'space-1', root, members: [...tabs.keys()] } : undefined),
    agentRecorded: (id) => recorded.get(id),
    setAgent: (id, kind) => {
      if (kind === undefined) recorded.delete(id)
      else recorded.set(id, kind)
    },
    setRoot: (_key, next) => {
      root = next
      roots.push(next)
    },
    adopt: (id, kind) => {
      adopted.set(id, kind)
      log.push(`adopt ${id} ${kind}`)
    },
    identify: (id, session) => {
      identified.set(id, session)
      log.push(`identify ${id}`)
    },
    release: (id) => {
      adopted.delete(id)
      log.push(`release ${id}`)
    },
    adoptedKind: (id) => adopted.get(id),
    discover: async () => undefined,
    claimedSessions: () => [],
  }
  return { tabs, recorded, adopted, identified, roots, log, ports, root: () => root }
}

describe('agentOfProgram', () => {
  it('knows the three agents by their command names, and nothing else', () => {
    expect(agentOfProgram('claude')).toBe('claude')
    expect(agentOfProgram('opencode')).toBe('opencode')
    expect(agentOfProgram('copilot')).toBe('copilot')
    expect(agentOfProgram('zsh')).toBeUndefined()
    expect(agentOfProgram(null)).toBeUndefined()
  })
})

describe('nextRoot', () => {
  it('moves the root when no agent sits in a different folder', () => {
    expect(nextRoot('/a', '/b', [])).toBe('/b')
    expect(nextRoot('/a', '/b', ['/b', '/b'])).toBe('/b')
  })

  it('keeps the root when an agent lives in another folder', () => {
    expect(nextRoot('/a', '/b', ['/a'])).toBe('/a')
    expect(nextRoot('/a', '/b', ['/b', '/c'])).toBe('/a')
  })
})

describe('Presence', () => {
  it('adopts a typed agent at once as unknown, and releases it when its program ends', async () => {
    const w = world([{ id: 't1', alive: true, foreground: 'zsh', cwd: '/work' }])
    const presence = new Presence(w.ports)
    await presence.tick()
    expect(w.log).toEqual([])

    w.tabs.get('t1')!.foreground = 'claude'
    await presence.tick()
    expect(w.log).toContain('adopt t1 claude')
    expect(w.recorded.get('t1')).toBe('claude')

    w.tabs.get('t1')!.foreground = 'zsh'
    await presence.tick()
    await presence.tick()
    expect(w.log).not.toContain('release t1')
    await presence.tick()
    expect(w.log).toContain('release t1')
    expect(w.recorded.has('t1')).toBe(false)
  })

  it('keeps a found agent through a single tick in which another program has the foreground', async () => {
    const w = world([{ id: 't1', alive: true, foreground: 'claude', cwd: '/work' }])
    const presence = new Presence(w.ports)
    await presence.tick()
    w.tabs.get('t1')!.foreground = 'git'
    await presence.tick()
    w.tabs.get('t1')!.foreground = 'claude'
    await presence.tick()
    w.tabs.get('t1')!.foreground = 'git'
    await presence.tick()
    expect(w.log).not.toContain('release t1')
  })

  it('does not adopt a tab the app already launched', async () => {
    const w = world([{ id: 't1', alive: true, foreground: 'claude', cwd: '/work' }])
    w.recorded.set('t1', 'claude')
    const presence = new Presence(w.ports)
    await presence.tick()
    expect(w.log).toEqual([])
  })

  it('identifies an OpenCode tab once discovery finds its session', async () => {
    const w = world([{ id: 't1', alive: true, foreground: 'opencode', cwd: '/work' }])
    let found: string | undefined
    w.ports.discover = async () => found
    const presence = new Presence(w.ports)
    await presence.tick()
    expect(w.log).toEqual(['adopt t1 opencode'])

    found = 'ses_abc'
    await presence.tick()
    expect(w.identified.get('t1')).toBe('ses_abc')
  })

  it('asks discovery to skip the sessions other tabs already have', async () => {
    const w = world([{ id: 't1', alive: true, foreground: 'opencode', cwd: '/work' }])
    const asked: string[][] = []
    w.ports.claimedSessions = () => ['ses_other']
    w.ports.discover = async (_kind, _cwd, _since, exclude) => {
      asked.push([...exclude])
      return undefined
    }
    await new Presence(w.ports).tick()
    expect(asked).toEqual([['ses_other']])
  })

  it('moves the space root on a cd in a plain tab when no agent is in another folder', async () => {
    const w = world([
      { id: 't1', alive: true, foreground: 'zsh', cwd: '/work' },
      { id: 't2', alive: true, foreground: 'zsh', cwd: '/work' },
    ])
    const presence = new Presence(w.ports)
    await presence.tick()
    w.tabs.get('t2')!.cwd = '/work/app'
    await presence.tick()
    expect(w.roots).toEqual(['/work/app'])
  })

  it('keeps the root when an agent tab sits in another folder', async () => {
    const w = world([
      { id: 't1', alive: true, foreground: 'zsh', cwd: '/work' },
      { id: 't2', alive: true, foreground: 'claude', cwd: '/work' },
    ])
    w.recorded.set('t2', 'claude')
    const presence = new Presence(w.ports)
    await presence.tick()
    w.tabs.get('t1')!.cwd = '/work/app'
    await presence.tick()
    expect(w.roots).toEqual([])
    expect(w.root()).toBe('/work')
  })

  it('does not treat the first sight of a folder as a cd', async () => {
    const w = world([{ id: 't1', alive: true, foreground: 'zsh', cwd: '/work/app' }])
    const presence = new Presence(w.ports)
    await presence.tick()
    expect(w.roots).toEqual([])
  })

  it('adopts a Claude whose native binary is named by its version, by the name it was run under', async () => {
    // Claude's native install runs as versions/2.1.309, reached through a link named claude: the foreground name is the version.
    const w = world([{ id: 't1', alive: true, foreground: '2.1.309', argv0: 'claude', cwd: '/work' }])
    await new Presence(w.ports).tick()
    expect(w.log).toContain('adopt t1 claude')
  })
})
