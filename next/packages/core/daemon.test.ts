import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { b64ToBytes, bytesToB64 } from '../protocol/framing.ts'
import { coreSocketPath } from '../protocol/paths.ts'
import { METHODS, type ConfigSnapshot, type StatusChange } from '../protocol/messages.ts'
import { connectRpc, connectWhenReady, type RpcClient } from '../protocol/client.ts'
import { holderSocketPath } from '../protocol/paths.ts'
import { ensureHolder } from './holder-client.ts'
import { startCoreDaemon, type CoreServer } from './daemon.ts'
import { createClaudeAdapter } from './agents/claude/adapter.ts'
import { SpacesService } from './spaces.ts'
import { StatusService } from './status/service.ts'
import type { AdapterWatchInput, AgentAdapter, AgentKind, AgentWatch } from './status/adapter.ts'
import type { StatusEvent } from './status/contract.ts'
import { killCore, startStack, stopHolder, waitFor } from './test-helpers.ts'
import { DEFAULT_VALUES } from './config/schema.ts'

const screenText = async (client: RpcClient, id: string): Promise<string> => {
  const { screenB64 } = await client.request(METHODS.tabsAttach, { id })
  return b64ToBytes(screenB64).toString('utf8')
}

// The size the holder has for a tab, read on a holder connection of its own so the core records no owner.
const holderSize = async (id: string): Promise<{ cols: number; rows: number }> => {
  const client = await connectRpc(holderSocketPath())
  try {
    const { cols, rows } = await client.request(METHODS.tabsAttach, { id })
    return { cols, rows }
  } finally {
    client.close()
  }
}

describe('core daemon', () => {
  let home: string
  let holder: ChildProcess | undefined
  let clients: RpcClient[] = []
  const savedHome = process.env.GROVE_NEXT_HOME

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-'))
    process.env.GROVE_NEXT_HOME = home
  })

  afterEach(async () => {
    for (const client of clients) client.close()
    clients = []
    await stopHolder(holder)
    holder = undefined
    if (savedHome === undefined) delete process.env.GROVE_NEXT_HOME
    else process.env.GROVE_NEXT_HOME = savedHome
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('keeps a tab alive when only the core is killed', async () => {
    const stack = await startStack()
    holder = stack.holder
    const first = stack.core
    clients.push(first)

    const { id } = await first.request(METHODS.tabsCreate, {
      command: '/bin/sh',
      cwd: home,
      cols: 80,
      rows: 24,
    })
    await first.request(METHODS.tabsWrite, { id, dataB64: bytesToB64(Buffer.from('echo mark-$((20+1))\n')) })
    await waitFor(
      () => screenText(first, id),
      (screen) => screen.includes('mark-21'),
    )

    first.close()
    clients = []
    await killCore(holder!)

    const next = await connectWhenReady(coreSocketPath())
    clients.push(next)
    const tabs = await next.request(METHODS.tabsList, {})
    expect(tabs).toContainEqual(expect.objectContaining({ id, alive: true }))
    expect(await screenText(next, id)).toContain('mark-21')
  })

  it('relays tab output and exit to an attached client', async () => {
    const stack = await startStack()
    holder = stack.holder
    const core = stack.core
    clients.push(core)

    const outputs: string[] = []
    const exits: Array<{ id: string; exitCode: number | null }> = []
    core.onNotification(METHODS.tabsOutput, (params) => outputs.push(b64ToBytes(params.dataB64).toString('utf8')))
    core.onNotification(METHODS.tabsExit, (params) => exits.push(params))

    const { id } = await core.request(METHODS.tabsCreate, { command: '/bin/sh', cwd: home, cols: 80, rows: 24 })
    await core.request(METHODS.tabsAttach, { id })
    await core.request(METHODS.tabsWrite, { id, dataB64: bytesToB64(Buffer.from('echo relay-$((6*7))\n')) })
    await waitFor(
      async () => outputs.join(''),
      (text) => text.includes('relay-42'),
    )

    await core.request(METHODS.tabsWrite, { id, dataB64: bytesToB64(Buffer.from('exit 3\n')) })
    await waitFor(
      async () => exits.length,
      (count) => count > 0,
    )
    expect(exits).toEqual([{ id, exitCode: 3 }])
  })

  it('applies every resize to the holder, the last one wins, whichever client owns the tab', async () => {
    const stack = await startStack()
    holder = stack.holder
    const first = stack.core
    clients.push(first)
    const second = await connectWhenReady(coreSocketPath())
    clients.push(second)

    const { id } = await first.request(METHODS.tabsCreate, { command: '/bin/sh', cwd: home, cols: 80, rows: 24 })
    await first.request(METHODS.tabsAttach, { id })
    await second.request(METHODS.tabsResize, { id, cols: 100, rows: 30 })
    expect(await holderSize(id)).toEqual({ cols: 100, rows: 30 })

    await first.request(METHODS.tabsResize, { id, cols: 120, rows: 40 })
    expect(await holderSize(id)).toEqual({ cols: 120, rows: 40 })
  })

  it('keeps applying resizes from another client after the owning client closes', async () => {
    const stack = await startStack()
    holder = stack.holder
    const first = stack.core
    clients.push(first)
    const second = await connectWhenReady(coreSocketPath())

    const { id } = await first.request(METHODS.tabsCreate, { command: '/bin/sh', cwd: home, cols: 80, rows: 24 })
    await second.request(METHODS.tabsAttach, { id })
    second.close()
    clients = clients.filter((client) => client !== second)

    await first.request(METHODS.tabsResize, { id, cols: 90, rows: 26 })
    expect(await holderSize(id)).toEqual({ cols: 90, rows: 26 })
  })
  it('closes a shell tab: it is gone from the holder and from spaces.list, and does not come back after a restart', async () => {
    const stack = await startStack()
    holder = stack.holder
    const core = stack.core
    clients.push(core)
    const space = fs.realpathSync(fs.mkdtempSync(path.join(home, 'space-')))
    const { id: spaceId } = await core.request(METHODS.spacesAdd, { path: space })
    const { id } = await core.request(METHODS.tabsOpen, { spaceId, cols: 80, rows: 24, label: 'scratch' })
    expect((await core.request(METHODS.spacesList, {})).tabs).toContainEqual(
      expect.objectContaining({ id, kind: 'terminal', label: 'scratch', alive: true }),
    )

    expect(await core.request(METHODS.tabsClose, { id })).toEqual({})
    expect((await core.request(METHODS.tabsList, {})).some((tab) => tab.id === id)).toBe(false)
    expect((await core.request(METHODS.spacesList, {})).tabs.some((tab) => tab.id === id)).toBe(false)

    core.close()
    clients = []
    await killCore(holder!)
    const next = await connectWhenReady(coreSocketPath())
    clients.push(next)
    expect((await next.request(METHODS.tabsList, {})).some((tab) => tab.id === id)).toBe(false)
    expect((await next.request(METHODS.spacesList, {})).tabs.some((tab) => tab.id === id)).toBe(false)
  })

  it('refuses to close a tab that is neither saved nor in the holder', async () => {
    const stack = await startStack()
    holder = stack.holder
    const core = stack.core
    clients.push(core)
    await expect(core.request(METHODS.tabsClose, { id: 'nope0001' })).rejects.toThrow('no such tab: nope0001')
  })

  it('renames a saved tab through tabs.rename, and refuses an unknown tab', async () => {
    const stack = await startStack()
    holder = stack.holder
    const core = stack.core
    clients.push(core)
    const space = fs.realpathSync(fs.mkdtempSync(path.join(home, 'rename-')))
    const { id: spaceId } = await core.request(METHODS.spacesAdd, { path: space })
    const { id } = await core.request(METHODS.tabsOpen, { spaceId, cols: 80, rows: 24 })

    expect(await core.request(METHODS.tabsRename, { id, label: '  api fix  ' })).toEqual({})
    expect((await core.request(METHODS.spacesList, {})).tabs).toContainEqual(expect.objectContaining({ id, label: 'api fix' }))
    expect(await core.request(METHODS.tabsRename, { id, label: '   ' })).toEqual({})
    expect((await core.request(METHODS.spacesList, {})).tabs).toContainEqual(expect.objectContaining({ id, label: null }))
    await expect(core.request(METHODS.tabsRename, { id: 'nope0001', label: 'x' })).rejects.toThrow('no such tab: nope0001')
  })

  it('sends tabs.focus to every connected client and refuses an unknown tab', async () => {
    const stack = await startStack()
    holder = stack.holder
    const first = stack.core
    clients.push(first)
    const second = await connectWhenReady(coreSocketPath())
    clients.push(second)

    const focused: Array<{ id: string }> = []
    const focusedOnSecond: Array<{ id: string }> = []
    first.onNotification(METHODS.tabsFocus, (params) => focused.push(params))
    second.onNotification(METHODS.tabsFocus, (params) => focusedOnSecond.push(params))

    const { id } = await first.request(METHODS.tabsCreate, { command: '/bin/sh', cwd: home, cols: 80, rows: 24 })
    expect(await first.request(METHODS.tabsFocus, { id })).toEqual({})
    await waitFor(
      async () => focused.length + focusedOnSecond.length,
      (count) => count === 2,
    )
    expect(focused).toEqual([{ id }])
    expect(focusedOnSecond).toEqual([{ id }])

    await expect(first.request(METHODS.tabsFocus, { id: 'nope0001' })).rejects.toThrow('no such tab: nope0001')
    await expect(first.request(METHODS.tabsFocus, { id: 'bad id!' })).rejects.toThrow('tab id is not valid')
  })

  it('tells every connected client when a tab is closed', async () => {
    const stack = await startStack()
    holder = stack.holder
    const first = stack.core
    clients.push(first)
    const second = await connectWhenReady(coreSocketPath())
    clients.push(second)

    const closed: Array<{ id: string }> = []
    const closedOnSecond: Array<{ id: string }> = []
    first.onNotification('tabs.closed', (params) => closed.push(params))
    second.onNotification('tabs.closed', (params) => closedOnSecond.push(params))

    const { id } = await first.request(METHODS.tabsCreate, { command: '/bin/sh', cwd: home, cols: 80, rows: 24 })
    await first.request(METHODS.tabsClose, { id })
    await waitFor(
      async () => closed.length + closedOnSecond.length,
      (count) => count === 2,
    )
    expect(closed).toEqual([{ id }])
    expect(closedOnSecond).toEqual([{ id }])
  })

  it('writes the config folder and AGENTS.md at start, and serves config.get with the defaults', async () => {
    const stack = await startStack()
    holder = stack.holder
    const core = stack.core
    clients.push(core)
    const configDir = path.join(home, 'config')
    expect(fs.existsSync(path.join(configDir, 'AGENTS.md'))).toBe(true)
    expect(fs.existsSync(path.join(configDir, 'theme.json'))).toBe(true)
    expect(await core.request(METHODS.configGet, {})).toEqual({
      path: configDir,
      values: DEFAULT_VALUES,
      notes: {},
    })
  })

  it('tells every connected client when a config file changes', async () => {
    const stack = await startStack()
    holder = stack.holder
    const first = stack.core
    clients.push(first)
    const second = await connectWhenReady(coreSocketPath())
    clients.push(second)

    const changed: ConfigSnapshot[] = []
    const changedOnSecond: ConfigSnapshot[] = []
    first.onNotification('config.changed', (snapshot) => changed.push(snapshot))
    second.onNotification('config.changed', (snapshot) => changedOnSecond.push(snapshot))

    fs.writeFileSync(path.join(home, 'config', 'settings.json'), JSON.stringify({ version: 1, sidebarWidth: 300 }))
    await waitFor(
      async () => changed.length + changedOnSecond.length,
      (count) => count === 2,
    )
    expect(changed[0].values.settings).toEqual({ sidebarWidth: 300 })
    expect(changedOnSecond[0].values.settings).toEqual({ sidebarWidth: 300 })
    expect(await first.request(METHODS.configGet, {})).toMatchObject({ values: { settings: { sidebarWidth: 300 } } })
  })

  it('sets GROVE_NEXT_CONFIG in a shell tab', async () => {
    const stack = await startStack()
    holder = stack.holder
    const core = stack.core
    clients.push(core)
    const space = fs.realpathSync(fs.mkdtempSync(path.join(home, 'space-')))
    const { id: spaceId } = await core.request(METHODS.spacesAdd, { path: space })
    const { id } = await core.request(METHODS.tabsOpen, { spaceId, cols: 200, rows: 24 })
    const expected = `cfg=${path.join(home, 'config')}=end`
    await core.request(METHODS.tabsWrite, { id, dataB64: bytesToB64(Buffer.from('echo "cfg=$GROVE_NEXT_CONFIG=end"\n')) })
    const screen = await waitFor(
      () => screenText(core, id),
      (text) => text.includes(expected),
    )
    expect(screen).toContain(expected)
  })
})

// Claude tabs run a fake launch (a shell that prints a line and sleeps) and a fake source, which replays
// a JSONL spool from the saved offset the way the real source does. No real `claude` is started.
describe('core daemon agents', () => {
  const fakeCore = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'holder', 'testdata', 'fake-core.mjs')
  const savedHome = process.env.GROVE_NEXT_HOME
  let home: string
  let space: string
  let stateFile: string
  let holder: ChildProcess | undefined
  let daemons: CoreServer[] = []
  let clients: RpcClient[] = []
  let launches: Array<{ tabId: string; resumeId?: string }>
  let delivered: Array<{ tab: string; kind: string }>
  // The shell a fake Claude tab runs. Most tests keep it quiet; some make it print or exit.
  const quietScreen = "printf 'screen-line\\n'; sleep 30"
  let launchScript: string

  const spoolOf = (tabId: string) => path.join(home, 'agents', 'claude', `${tabId}.jsonl`)
  const appendEvent = (tabId: string, event: Record<string, unknown>) => {
    fs.mkdirSync(path.dirname(spoolOf(tabId)), { recursive: true })
    fs.appendFileSync(spoolOf(tabId), `${JSON.stringify(event)}\n`)
  }

  // A session id in the shape Claude uses (a UUID), derived from the tab id, which is hex in these tests.
  const sessionFor = (tabId: string) => `${tabId.padEnd(8, '0').slice(0, 8)}-0000-4000-8000-000000000000`

  const fakeWatch = ({ tabId, onEvent }: AdapterWatchInput): AgentWatch => {
    const spoolFile = spoolOf(tabId)
    const offsetFile = path.join(home, 'agents', 'claude', `${tabId}.offset`)
    let offset = fs.existsSync(offsetFile) ? (JSON.parse(fs.readFileSync(offsetFile, 'utf8')) as { offset: number }).offset : 0
    const drain = () => {
      if (!fs.existsSync(spoolFile)) return
      const text = fs.readFileSync(spoolFile, 'utf8').slice(offset)
      const complete = text.slice(0, text.lastIndexOf('\n') + 1)
      if (complete === '') return
      for (const line of complete.split('\n').filter(Boolean)) {
        const event = JSON.parse(line) as { kind: string }
        delivered.push({ tab: tabId, kind: event.kind })
        onEvent(event as StatusEvent, Date.now())
      }
      offset += Buffer.byteLength(complete)
      fs.writeFileSync(offsetFile, JSON.stringify({ offset }))
    }
    // As the real source does: a heartbeat after each drain that worked, so the reader is seen to run.
    const beat = () => {
      drain()
      onEvent({ kind: 'heartbeat' }, Date.now())
    }
    beat()
    const timer = setInterval(beat, 20)
    return { close: () => clearInterval(timer) }
  }

  // The fake Claude adapter: a launch that runs the shell script, and a watch over the fake spool.
  const fakeAdapter: AgentAdapter = {
    kind: 'claude',
    launch: ({ tabId, resumeId }) => {
      launches.push({ tabId, resumeId })
      return {
        command: '/bin/sh',
        args: ['-c', launchScript],
        env: {},
        sessionId: resumeId ?? sessionFor(tabId),
      }
    },
    watch: fakeWatch,
  }

  const screenFromHolder = async (tabId: string): Promise<string> => {
    const client = await connectRpc(holderSocketPath())
    try {
      return (await client.request(METHODS.tabsScreen, { id: tabId })).text
    } finally {
      client.close()
    }
  }

  const aliveFromHolder = async (): Promise<Set<string>> => {
    const client = await connectRpc(holderSocketPath())
    try {
      return new Set((await client.request(METHODS.tabsList, {})).filter((tab) => tab.alive).map((tab) => tab.id))
    } finally {
      client.close()
    }
  }

  // Kills a holder tab directly, as if Claude had died while the core was not looking.
  const killOnHolder = async (tabId: string): Promise<void> => {
    const client = await connectRpc(holderSocketPath())
    try {
      await client.request(METHODS.tabsKill, { id: tabId })
    } finally {
      client.close()
    }
  }

  const startDaemon = async (
    overrides: { silenceMs?: number; adapters?: Partial<Record<AgentKind, AgentAdapter>> } = {},
  ): Promise<{ core: RpcClient; status: StatusService }> => {
    const adapters = overrides.adapters ?? { claude: fakeAdapter }
    const status = new StatusService({
      home,
      adapters,
      screen: screenFromHolder,
      alive: aliveFromHolder,
      onSession: (tabId, sessionId) => spaces.setAgentSession(tabId, sessionId),
      tickMs: 20,
      graceMs: 0,
      silenceMs: overrides.silenceMs ?? 60000,
    })
    const spaces = new SpacesService(stateFile)
    daemons.push(await startCoreDaemon({ spaces, status, home, adapters }))
    const core = await connectWhenReady(coreSocketPath())
    clients.push(core)
    return { core, status }
  }

  const stopDaemons = async () => {
    for (const client of clients) client.close()
    clients = []
    for (const daemon of daemons) await daemon.close()
    daemons = []
  }

  beforeEach(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-agents-'))
    space = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gn-space-')))
    stateFile = path.join(home, 'state.json')
    fs.writeFileSync(stateFile, JSON.stringify({ version: 1, spaces: [{ path: space }], tabs: [] }))
    process.env.GROVE_NEXT_HOME = home
    launches = []
    delivered = []
    launchScript = quietScreen
    holder = await ensureHolder({
      env: { ...process.env, GROVE_NEXT_HOME: home, GROVE_NEXT_CORE_CMD: `${process.execPath} ${fakeCore}` },
    })
  })

  afterEach(async () => {
    await stopDaemons()
    await stopHolder(holder)
    holder = undefined
    if (savedHome === undefined) delete process.env.GROVE_NEXT_HOME
    else process.env.GROVE_NEXT_HOME = savedHome
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(space, { recursive: true, force: true })
  })

  const agentState = async (core: RpcClient, tabId: string) =>
    (await core.request(METHODS.agentsList, {})).find((agent) => agent.tabId === tabId)

  it('sets GROVE_NEXT_CONFIG in a Claude tab', async () => {
    launchScript = "printf 'cfg=%s\\n' \"$GROVE_NEXT_CONFIG\"; sleep 30"
    const { core } = await startDaemon()
    const { id } = await core.request(METHODS.tabsCreate, {
      command: 'claude',
      cwd: space,
      cols: 200,
      rows: 24,
      agent: { kind: 'claude' },
    })
    const expected = `cfg=${path.join(home, 'config')}`
    const screen = await waitFor(
      () => screenFromHolder(id),
      (text) => text.includes(expected),
    )
    expect(screen).toContain(expected)
  })

  it('starts a Claude tab, lists its state, reads its screen and reports changes', async () => {
    const { core } = await startDaemon()
    const changes: StatusChange[] = []
    core.onNotification('status.changed', (change) => changes.push(change))

    const { id } = await core.request(METHODS.tabsCreate, {
      command: 'claude',
      cwd: space,
      cols: 80,
      rows: 24,
      agent: { kind: 'claude' },
    })
    expect(await agentState(core, id)).toMatchObject({ tabId: id, agent: 'claude', state: 'idle', resumable: false })

    appendEvent(id, { kind: 'working' })
    await waitFor(
      () => agentState(core, id),
      (agent) => agent?.state === 'working',
    )
    expect(changes).toContainEqual(expect.objectContaining({ tabId: id, state: 'working' }))

    await waitFor(
      () => screenFromHolder(id),
      (text) => text.includes('screen-line'),
    )
    expect(await core.request(METHODS.tabsScreen, { id })).toEqual({ text: expect.stringContaining('screen-line') })

    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as { tabs: unknown[] }
    expect(saved.tabs).toEqual([{ id, spaceId: space, spacePath: space, agent: 'claude', agentSessionId: sessionFor(id) }])
  })

  it('resumes a gone Claude tab under the same id with its saved session', async () => {
    const { core } = await startDaemon()
    const { id } = await core.request(METHODS.tabsCreate, {
      command: 'claude',
      cwd: space,
      cols: 80,
      rows: 24,
      agent: { kind: 'claude' },
    })
    await core.request(METHODS.tabsKill, { id })
    expect(await agentState(core, id)).toMatchObject({ tabId: id, resumable: true })

    const resumed = await core.request(METHODS.tabsCreate, {
      id,
      command: 'claude',
      cwd: space,
      cols: 80,
      rows: 24,
      agent: { kind: 'claude' },
    })
    expect(resumed).toEqual({ id })
    expect(launches.at(-1)).toEqual({ tabId: id, resumeId: sessionFor(id) })
    expect(await agentState(core, id)).toMatchObject({ tabId: id, resumable: false })
  })

  it('rebuilds Claude tab state after a core restart from the saved offset, without replaying old events', async () => {
    const first = await startDaemon()
    const { id } = await first.core.request(METHODS.tabsCreate, {
      command: 'claude',
      cwd: space,
      cols: 80,
      rows: 24,
      agent: { kind: 'claude' },
    })
    appendEvent(id, { kind: 'needs-you', reason: 'permission' })
    const before = await waitFor(
      () => agentState(first.core, id),
      (agent) => agent?.state === 'needs-you',
    )
    expect(before).toMatchObject({ state: 'needs-you', reason: 'permission' })
    await stopDaemons()

    delivered = []
    const second = await startDaemon()
    expect(await agentState(second.core, id)).toEqual(before)
    expect(delivered).toEqual([])

    appendEvent(id, { kind: 'finished' })
    await waitFor(
      () => agentState(second.core, id),
      (agent) => agent?.state === 'finished',
    )
    expect(delivered).toEqual([{ tab: id, kind: 'finished' }])
  })

  it('falls to unknown when the Claude tab is killed while it waits for you', async () => {
    const { core } = await startDaemon()
    const { id } = await core.request(METHODS.tabsCreate, {
      command: 'claude',
      cwd: space,
      cols: 80,
      rows: 24,
      agent: { kind: 'claude' },
    })
    appendEvent(id, { kind: 'needs-you', reason: 'permission' })
    await waitFor(
      () => agentState(core, id),
      (agent) => agent?.state === 'needs-you',
    )

    await killOnHolder(id)
    const after = await waitFor(
      () => agentState(core, id),
      (agent) => agent?.state === 'unknown',
    )
    expect(after).toMatchObject({ tabId: id, state: 'unknown', resumable: true })
  })

  it('falls a working tab to unknown when its screen and spool stay quiet, with the reader still running', async () => {
    const { core } = await startDaemon({ silenceMs: 400 })
    const changes: StatusChange[] = []
    core.onNotification('status.changed', (change) => changes.push(change))
    const { id } = await core.request(METHODS.tabsCreate, {
      command: 'claude',
      cwd: space,
      cols: 80,
      rows: 24,
      agent: { kind: 'claude' },
    })
    appendEvent(id, { kind: 'working' })

    await waitFor(
      () => agentState(core, id),
      (agent) => agent?.state === 'unknown',
    )
    const states = changes.filter((change) => change.tabId === id).map((change) => change.state)
    expect(states.slice(-2)).toEqual(['working', 'unknown'])
  })

  it('keeps a working tab working while its real screen keeps changing', async () => {
    launchScript = 'i=0; while true; do echo tick-$i; i=$((i+1)); sleep 0.1; done'
    const { core } = await startDaemon({ silenceMs: 400 })
    const { id } = await core.request(METHODS.tabsCreate, {
      command: 'claude',
      cwd: space,
      cols: 80,
      rows: 24,
      agent: { kind: 'claude' },
    })
    appendEvent(id, { kind: 'working' })
    await waitFor(
      () => agentState(core, id),
      (agent) => agent?.state === 'working',
    )

    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(await agentState(core, id)).toMatchObject({ tabId: id, state: 'working' })
  })

  it('resumes a Claude tab whose process exited on its own, under the same id, and is no longer unknown', async () => {
    launchScript = "printf 'screen-line\\n'; exit 0"
    const { core } = await startDaemon()
    const { id } = await core.request(METHODS.tabsCreate, {
      command: 'claude',
      cwd: space,
      cols: 80,
      rows: 24,
      agent: { kind: 'claude' },
    })
    // The holder keeps the exited entry, so the tab is gone and shows unknown with a Resume.
    await waitFor(
      () => agentState(core, id),
      (agent) => agent?.state === 'unknown',
    )
    expect(await agentState(core, id)).toMatchObject({ tabId: id, resumable: true })

    launchScript = quietScreen
    const resumed = await core.request(METHODS.tabsCreate, {
      id,
      command: 'claude',
      cwd: space,
      cols: 80,
      rows: 24,
      agent: { kind: 'claude' },
    })
    expect(resumed).toEqual({ id })
    expect(launches.at(-1)).toEqual({ tabId: id, resumeId: sessionFor(id) })
    const after = await agentState(core, id)
    expect(after).toMatchObject({ tabId: id, state: 'idle', resumable: false })
  })

  it('restores a Claude tab whose holder tab died while the core was down as unknown, not needs-you', async () => {
    const first = await startDaemon()
    const { id } = await first.core.request(METHODS.tabsCreate, {
      command: 'claude',
      cwd: space,
      cols: 80,
      rows: 24,
      agent: { kind: 'claude' },
    })
    appendEvent(id, { kind: 'needs-you', reason: 'permission' })
    await waitFor(
      () => agentState(first.core, id),
      (agent) => agent?.state === 'needs-you',
    )
    await stopDaemons()
    await killOnHolder(id)

    const second = await startDaemon()
    expect(await agentState(second.core, id)).toMatchObject({ tabId: id, state: 'unknown', resumable: true })
  })

  it('refuses a Claude tab in a refused state before any holder tab is made', async () => {
    fs.writeFileSync(stateFile, JSON.stringify({ version: 2, spaces: [{ path: space }], tabs: [] }))
    const { core } = await startDaemon()
    await expect(
      core.request(METHODS.tabsCreate, { command: 'claude', cwd: space, cols: 80, rows: 24, agent: { kind: 'claude' } }),
    ).rejects.toThrow('version 2')
    expect(await aliveFromHolder()).toEqual(new Set())
  })

  it('saves the Claude tab record even when the holder refuses the create', async () => {
    const { core } = await startDaemon()
    // A live shell tab under the id makes the holder refuse the Claude create with tabExists.
    await core.request(METHODS.tabsCreate, { id: 'beef0001', command: '/bin/sh', cwd: space, cols: 80, rows: 24 })
    await expect(
      core.request(METHODS.tabsCreate, {
        id: 'beef0001',
        command: 'claude',
        cwd: space,
        cols: 80,
        rows: 24,
        agent: { kind: 'claude' },
      }),
    ).rejects.toThrow()
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as { tabs: unknown[] }
    expect(saved.tabs).toContainEqual({
      id: 'beef0001',
      spaceId: space,
      spacePath: space,
      agent: 'claude',
      agentSessionId: sessionFor('beef0001'),
    })
  })

  it('refuses a resume id that is not a session id', async () => {
    // The real Claude adapter validates the resume id, so this case runs against it, not the fake.
    const { core } = await startDaemon({ adapters: { claude: createClaudeAdapter() } })
    await expect(
      core.request(METHODS.tabsCreate, {
        command: 'claude',
        cwd: space,
        cols: 80,
        rows: 24,
        agent: { kind: 'claude', resumeId: '--dangerously-skip-permissions' },
      }),
    ).rejects.toThrow('resume id is not a session id')
  })

  it('refuses an agent kind that has no adapter', async () => {
    const { core } = await startDaemon()
    await expect(
      core.request(METHODS.tabsCreate, { command: 'opencode', cwd: space, cols: 80, rows: 24, agent: { kind: 'opencode' } }),
    ).rejects.toThrow('agent.kind must be one of claude')
    expect(await aliveFromHolder()).toEqual(new Set())
  })

  it('refuses an agent whose command is not on the PATH, before any record or holder tab is made', async () => {
    const missing: AgentAdapter = {
      kind: 'copilot',
      launch: () => {
        throw new Error('not used: the command is missing')
      },
      watch: () => ({ close: () => undefined }),
      available: async () => false,
    }
    const { core } = await startDaemon({ adapters: { claude: fakeAdapter, copilot: missing } })
    await expect(
      core.request(METHODS.tabsCreate, { command: 'copilot', cwd: space, cols: 80, rows: 24, agent: { kind: 'copilot' } }),
    ).rejects.toThrow('copilot is not on the PATH of your login shell')
    expect(await aliveFromHolder()).toEqual(new Set())
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as { tabs: unknown[] }
    expect(saved.tabs).toEqual([])
  })

  it('saves the label of a new Claude tab, keeps it on a resume, and closing the tab removes it and its status', async () => {
    const { core } = await startDaemon()
    const { id } = await core.request(METHODS.tabsCreate, {
      command: 'claude',
      cwd: space,
      cols: 80,
      rows: 24,
      label: 'api fix',
      agent: { kind: 'claude' },
    })
    expect((await core.request(METHODS.spacesList, {})).tabs).toContainEqual(
      expect.objectContaining({ id, kind: 'claude', label: 'api fix' }),
    )

    await core.request(METHODS.tabsKill, { id })
    await core.request(METHODS.tabsCreate, { id, command: 'claude', cwd: space, cols: 80, rows: 24, agent: { kind: 'claude' } })
    expect((await core.request(METHODS.spacesList, {})).tabs).toContainEqual(expect.objectContaining({ id, label: 'api fix' }))

    expect(await core.request(METHODS.tabsClose, { id })).toEqual({})
    expect(await agentState(core, id)).toBeUndefined()
    expect((await core.request(METHODS.spacesList, {})).tabs.some((tab) => tab.id === id)).toBe(false)
    expect(await aliveFromHolder()).not.toContain(id)
  })
})
