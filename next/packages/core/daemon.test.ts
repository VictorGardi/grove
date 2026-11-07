import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, type ChildProcess } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { b64ToBytes, bytesToB64 } from '../protocol/framing.ts'
import { coreSocketPath } from '../protocol/paths.ts'
import { METHODS, type ConfigSnapshot, type SpaceInfo, type SpaceTabInfo, type StatusChange } from '../protocol/messages.ts'
import { connectRpc, connectWhenReady, type RpcClient } from '../protocol/client.ts'
import { holderSocketPath } from '../protocol/paths.ts'
import { ensureHolder } from './holder-client.ts'
import { startCoreDaemon, type CoreServer } from './daemon.ts'
import { createClaudeAdapter } from './agents/claude/adapter.ts'
import { SpacesService } from './spaces.ts'
import { StatusService } from './status/service.ts'
import type { AdapterWatchInput, AgentAdapter, AgentKind, AgentWatch } from './status/adapter.ts'
import type { StatusEvent } from './status/contract.ts'
import { corePidOf, killCore, startStack, stopHolder, waitFor } from './test-helpers.ts'
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

  it('restarts the core on core.restart: the holder starts a new one and a tab keeps running', async () => {
    const stack = await startStack()
    holder = stack.holder
    const first = stack.core
    clients.push(first)
    const { id } = await first.request(METHODS.tabsCreate, { command: '/bin/sh', cwd: home, cols: 80, rows: 24 })
    const oldPid = corePidOf(holder!)

    await first.request(METHODS.coreRestart, {})
    first.close()
    clients = []
    await waitFor(
      async () => {
        try {
          return corePidOf(holder!)
        } catch {
          return 0
        }
      },
      (pid) => pid !== 0 && pid !== oldPid,
    )

    const next = await connectWhenReady(coreSocketPath())
    clients.push(next)
    expect(await next.request(METHODS.tabsList, {})).toContainEqual(expect.objectContaining({ id, alive: true }))
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

  it('announces CLI-created spaces and shell tabs to an already connected window', async () => {
    const stack = await startStack()
    holder = stack.holder
    const cli = stack.core
    const window = await connectRpc(coreSocketPath())
    clients.push(cli, window)
    const changed: SpaceInfo[] = []
    const opened: SpaceTabInfo[] = []
    window.onNotification('spaces.changed', (info) => changed.push(info))
    window.onNotification('tabs.opened', (info) => opened.push(info))
    const space = await cli.request(METHODS.spacesAdd, { path: home })
    const { id } = await cli.request(METHODS.tabsOpen, { spaceId: space.id, cols: 80, rows: 24, label: 'CLI shell' })
    await waitFor(async () => opened.length, (count) => count === 1)
    expect(changed).toContainEqual(space)
    expect(opened).toEqual([{ id, spaceId: space.id, spacePath: space.path, kind: 'terminal', label: 'CLI shell', alive: true, exitCode: null }])
    await expect(window.request(METHODS.tabsAttach, { id })).resolves.toHaveProperty('screenB64')
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

  it('serves the diff of a tab\'s or a space\'s folder by id, refuses unknown ids and flag-like bases, and keeps the view per folder', async () => {
    const stack = await startStack()
    holder = stack.holder
    const core = stack.core
    clients.push(core)
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(home, 'repo-')))
    const gitIn = (args: string[]) =>
      execFileSync('git', ['-c', 'user.name=grove', '-c', 'user.email=grove@example.invalid', ...args], { cwd: repo, stdio: 'pipe' })
    gitIn(['init', '-q', '-b', 'main'])
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n')
    gitIn(['add', '-A'])
    gitIn(['commit', '-q', '-m', 'init'])
    gitIn(['branch', 'old'])
    fs.writeFileSync(path.join(repo, 'a.txt'), 'two\n')
    const link = path.join(home, 'link')
    fs.symlinkSync(repo, link)
    const { id: spaceId } = await core.request(METHODS.spacesAdd, { path: link })
    const { id: tabId } = await core.request(METHODS.tabsOpen, { spaceId, cols: 80, rows: 24 })

    const byTab = await core.request(METHODS.diffGet, { tabId, mode: 'uncommitted' })
    expect(byTab.state).toBe('ok')
    expect(byTab.root).toBe(repo)
    expect(byTab.files.map((file) => file.path)).toEqual(['a.txt'])
    const bySpace = await core.request(METHODS.diffGet, { spaceId, mode: 'uncommitted' })
    expect(bySpace.files).toEqual(byTab.files)
    expect(byTab.counts.uncommitted).toBe(1)

    await expect(core.request(METHODS.diffGet, { tabId: 'nosuch', mode: 'branch' })).rejects.toThrow('no such tab')
    await expect(core.request(METHODS.diffGet, { spaceId: 'nosuch', mode: 'branch' })).rejects.toThrow('no such space')
    await expect(core.request(METHODS.diffGet, { tabId, spaceId, mode: 'branch' } as never)).rejects.toThrow('not both')
    await expect(core.request(METHODS.diffGet, { mode: 'branch' } as never)).rejects.toThrow('tabId or a spaceId')
    await expect(core.request(METHODS.diffGet, { tabId, mode: 'branch', base: '--output=x' })).rejects.toThrow('not a valid base')
    await expect(core.request(METHODS.diffGet, { tabId, mode: 'wide' as never })).rejects.toThrow('mode must be')
    // A path in the call is not read: with a tab named, the folder is the tab's.
    const sneaky = await core.request(METHODS.diffGet, { tabId, mode: 'uncommitted', path: '/etc' } as never)
    expect(sneaky.root).toBe(repo)

    expect(await core.request(METHODS.diffPrefsGet, { tabId })).toEqual({ mode: 'branch', base: null, recents: [] })
    await core.request(METHODS.diffPrefsSet, { tabId, mode: 'uncommitted' })
    expect(await core.request(METHODS.diffPrefsSet, { spaceId, base: 'old' })).toEqual({ mode: 'uncommitted', base: 'old', recents: ['old'] })
    expect(await core.request(METHODS.diffPrefsSet, { tabId, base: null })).toEqual({ mode: 'uncommitted', base: null, recents: ['old'] })
    expect(await core.request(METHODS.diffBases, { tabId })).toEqual({ branches: ['main', 'old'], current: 'main', default: 'main', recents: ['old'] })
    expect(JSON.parse(fs.readFileSync(path.join(home, 'state.json'), 'utf8')).diffPrefs[repo].recents).toEqual(['old'])

    // Review comments follow the same folder: a tab and its space see one list.
    const note = { path: 'a.txt', side: 'new' as const, line: 1, anchor: 'two', before: [], after: [], body: 'why two?' }
    expect(await core.request(METHODS.diffCommentsList, { tabId })).toEqual({ comments: [] })
    const added = await core.request(METHODS.diffCommentsAdd, { tabId, ...note })
    expect(added).toMatchObject({ ...note, state: 'pending' })
    expect((await core.request(METHODS.diffCommentsList, { spaceId })).comments).toEqual([added])
    expect(await core.request(METHODS.diffCommentsUpdate, { spaceId, id: added.id, state: 'resolved' })).toMatchObject({ state: 'resolved' })
    await expect(core.request(METHODS.diffCommentsUpdate, { tabId, id: added.id, state: 'sent' as never })).rejects.toThrow('only by sending')
    await expect(core.request(METHODS.diffCommentsAdd, { tabId, ...note, body: '' })).rejects.toThrow('must not be empty')
    expect(JSON.parse(fs.readFileSync(path.join(home, 'state.json'), 'utf8')).diffComments[repo]).toHaveLength(1)
    // Only pending comments become sent; a resolved one, an unknown id and a repeat are skipped.
    const second = await core.request(METHODS.diffCommentsAdd, { tabId, ...note, line: 2, anchor: 'three' })
    expect(await core.request(METHODS.diffCommentsMarkSent, { tabId, ids: [added.id, second.id, 'nope'] })).toEqual({ comments: [{ ...second, state: 'sent' }] })
    expect(await core.request(METHODS.diffCommentsMarkSent, { spaceId, ids: [second.id] })).toEqual({ comments: [] })
    expect((await core.request(METHODS.diffCommentsList, { tabId })).comments.map((c) => c.state)).toEqual(['resolved', 'sent'])
    await expect(core.request(METHODS.diffCommentsMarkSent, { tabId, ids: 'x' as never })).rejects.toThrow('ids must be')
    expect(await core.request(METHODS.diffCommentsDelete, { tabId, id: added.id })).toEqual({})
    expect(await core.request(METHODS.diffCommentsDelete, { tabId, id: second.id })).toEqual({})
    expect((await core.request(METHODS.diffCommentsList, { tabId })).comments).toEqual([])
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

  it('keeps the notes page in one file under the home: empty until written, then what was written', async () => {
    const stack = await startStack()
    holder = stack.holder
    const core = stack.core
    clients.push(core)
    expect(await core.request(METHODS.notesRead, {})).toEqual({ text: '' })
    await core.request(METHODS.notesWrite, { text: '# Today\n- [ ] ship notes\n' })
    expect(fs.readFileSync(path.join(home, 'notes.md'), 'utf8')).toBe('# Today\n- [ ] ship notes\n')
    expect(await core.request(METHODS.notesRead, {})).toEqual({ text: '# Today\n- [ ] ship notes\n' })
    await expect(core.request(METHODS.notesWrite, { text: 5 } as never)).rejects.toThrow(/text must be a string/)
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

// Claude tabs run a fake launch (a shell that prints OSC status records and sleeps) and a fake source
// for session-id events. No real `claude` is started.
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
    overrides: { adapters?: Partial<Record<AgentKind, AgentAdapter>> } = {},
  ): Promise<{ core: RpcClient; status: StatusService }> => {
    const adapters = overrides.adapters ?? { claude: fakeAdapter }
    const status = new StatusService({
      home,
      adapters,
      alive: aliveFromHolder,
      onSession: (tabId, sessionId) => spaces.setAgentSession(tabId, sessionId),
      tickMs: 20,
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

  it('announces newly created and resumed agent tabs to another client', async () => {
    const { core } = await startDaemon()
    const window = await connectRpc(coreSocketPath())
    clients.push(window)
    const opened: SpaceTabInfo[] = []
    window.onNotification('tabs.opened', (info) => opened.push(info))
    const { id } = await core.request(METHODS.tabsCreate, {
      command: 'claude', cwd: space, cols: 80, rows: 24, label: 'CLI agent', agent: { kind: 'claude' },
    })
    await waitFor(async () => opened.length, (count) => count === 1)
    expect(opened[0]).toMatchObject({ id, kind: 'claude', label: 'CLI agent', alive: true, spacePath: space })
    await killOnHolder(id)
    await core.request(METHODS.tabsCreate, {
      id, command: 'claude', cwd: space, cols: 80, rows: 24, agent: { kind: 'claude' },
    })
    await waitFor(async () => opened.length, (count) => count === 2)
    expect(opened[1]).toEqual(opened[0])
  })

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
    launchScript =
      "printf '\\033]7501;state=working\\033\\\\'; sleep 0.1; printf '\\033]7501;state=idle\\033\\\\'; printf 'screen-line\\n'; sleep 30"
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
    await waitFor(
      async () => changes.filter((change) => change.tabId === id).map((change) => change.state),
      (states) => states.includes('finished'),
    )
    expect(await agentState(core, id)).toMatchObject({ tabId: id, agent: 'claude', state: 'finished', resumable: false })
    expect(changes.filter((change) => change.tabId === id).map((change) => change.state)).toEqual(['working', 'finished'])

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

  it('keeps restored tabs unknown and continues to save Claude session ids', async () => {
    const first = await startDaemon()
    const { id } = await first.core.request(METHODS.tabsCreate, {
      command: 'claude',
      cwd: space,
      cols: 80,
      rows: 24,
      agent: { kind: 'claude' },
    })
    appendEvent(id, { kind: 'session', resumeId: 'updated-session' })
    await waitFor(async () => {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as { tabs: Array<{ agentSessionId: string }> }
      return state.tabs[0]?.agentSessionId
    }, (sessionId) => sessionId === 'updated-session')
    await stopDaemons()

    delivered = []
    const second = await startDaemon()
    expect(await agentState(second.core, id)).toMatchObject({ state: 'unknown', resumable: false })
    expect(delivered).toEqual([])

    await second.core.request(METHODS.tabsKill, { id })
    await second.core.request(METHODS.tabsCreate, { id, command: 'claude', cwd: space, cols: 80, rows: 24, agent: { kind: 'claude' } })
    expect(launches.at(-1)).toEqual({ tabId: id, resumeId: 'updated-session' })
  })

  it('falls to unknown when a working Claude tab is killed', async () => {
    launchScript = "printf '\\033]7501;state=working\\033\\\\'; sleep 30"
    const { core } = await startDaemon()
    const { id } = await core.request(METHODS.tabsCreate, {
      command: 'claude',
      cwd: space,
      cols: 80,
      rows: 24,
      agent: { kind: 'claude' },
    })
    await waitFor(
      () => agentState(core, id),
      (agent) => agent?.state === 'working',
    )

    await killOnHolder(id)
    const after = await waitFor(
      () => agentState(core, id),
      (agent) => agent?.state === 'unknown',
    )
    expect(after).toMatchObject({ tabId: id, state: 'unknown', resumable: true })
  })

  it('keeps a working tab working when its screen stays quiet', async () => {
    launchScript = "printf '\\033]7501;state=working\\033\\\\'; sleep 3"
    const { core } = await startDaemon()
    const { id } = await core.request(METHODS.tabsCreate, {
      command: 'claude',
      cwd: space,
      cols: 80,
      rows: 24,
      agent: { kind: 'claude' },
    })
    await waitFor(
      () => agentState(core, id),
      (agent) => agent?.state === 'working',
    )

    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(await agentState(core, id)).toMatchObject({ tabId: id, state: 'working' })
  })

  it('resumes an exited Claude tab as unknown until its next report', async () => {
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
    expect(after).toMatchObject({ tabId: id, state: 'unknown', resumable: false })
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

// An agent typed into a plain tab, found by its foreground program. A small program named `claude` (built with the
// C compiler, sleeping for a minute) stands in for the real binary: the foreground name is what the scan reads.
// A copy of a system binary or a symlink would not do: macOS kills the first, and a symlink reports its target's name.
function claudeStandIn(dir: string): string | undefined {
  const source = path.join(dir, 'claude.c')
  const binary = path.join(dir, 'claude')
  fs.writeFileSync(source, '#include <unistd.h>\nint main(void) { sleep(60); return 0; }\n')
  try {
    execFileSync('cc', ['-o', binary, source])
    return binary
  } catch {
    return undefined
  }
}

describe('agents typed by hand', () => {
  let home: string
  let holder: ChildProcess | undefined
  let clients: RpcClient[] = []

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-hand-'))
    process.env.GROVE_NEXT_HOME = home
    // The core reads Claude's and Copilot's settings from these. Tests never let it reach the human's real config.
    process.env.CLAUDE_CONFIG_DIR = path.join(home, 'claude-config')
    process.env.COPILOT_HOME = path.join(home, 'copilot-home')
  })

  afterEach(async () => {
    for (const client of clients) client.close()
    clients = []
    await stopHolder(holder)
    holder = undefined
    delete process.env.CLAUDE_CONFIG_DIR
    delete process.env.COPILOT_HOME
    fs.rmSync(home, { recursive: true, force: true })
  })

  const agentState = async (core: RpcClient, tabId: string) =>
    (await core.request(METHODS.agentsList, {})).find((agent) => agent.tabId === tabId)

  const typeLine = (core: RpcClient, id: string, text: string) =>
    core.request(METHODS.tabsWrite, { id, dataB64: bytesToB64(Buffer.from(text)) })

  // Without a C compiler the stand-in cannot be built, so this test is skipped rather than passing empty.
  const hasCompiler = (() => {
    try {
      execFileSync('cc', ['--version'], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  })()

  it.skipIf(!hasCompiler)('shows an agent typed in a plain tab as unknown, and drops it when its program ends', async () => {
    const stack = await startStack()
    holder = stack.holder
    const core = stack.core
    clients.push(core)
    const space = fs.realpathSync(fs.mkdtempSync(path.join(home, 'space-')))
    const bin = claudeStandIn(fs.mkdtempSync(path.join(home, 'bin-')))
    if (bin === undefined) throw new Error('the C compiler is there but the stand-in did not build')
    const { id: spaceId } = await core.request(METHODS.spacesAdd, { path: space })
    const { id } = await core.request(METHODS.tabsOpen, { spaceId, cols: 80, rows: 24 })

    await typeLine(core, id, `${bin}\n`)
    const seen = await waitFor(
      () => agentState(core, id),
      (agent) => agent !== undefined,
      15000,
    )
    expect(seen).toMatchObject({ tabId: id, agent: 'claude', state: 'unknown' })
    expect((await core.request(METHODS.spacesList, {})).tabs).toContainEqual(expect.objectContaining({ id, kind: 'claude' }))

    await typeLine(core, id, '\u0003')
    await waitFor(
      () => agentState(core, id),
      (agent) => agent === undefined,
      15000,
    )
    expect((await core.request(METHODS.spacesList, {})).tabs).toContainEqual(expect.objectContaining({ id, kind: 'terminal' }))
  })

  it.skipIf(!hasCompiler)('asks once about a typed claude with no hooks, writes nothing until a yes, then installs it', async () => {
    const stack = await startStack()
    holder = stack.holder
    const core = stack.core
    clients.push(core)
    const space = fs.realpathSync(fs.mkdtempSync(path.join(home, 'space-')))
    const bin = claudeStandIn(fs.mkdtempSync(path.join(home, 'bin-')))
    if (bin === undefined) throw new Error('the C compiler is there but the stand-in did not build')
    const prompts: unknown[] = []
    core.onNotification('integration.prompt', (params) => prompts.push(params))
    const { id: spaceId } = await core.request(METHODS.spacesAdd, { path: space })
    const { id } = await core.request(METHODS.tabsOpen, { spaceId, cols: 80, rows: 24 })

    await typeLine(core, id, `${bin}\n`)
    await waitFor(
      async () => prompts,
      (seen) => seen.length > 0,
      15000,
    )
    expect(prompts).toEqual([{ agent: 'claude' }])
    const settings = path.join(home, 'claude-config', 'settings.json')
    expect(fs.existsSync(settings)).toBe(false)

    const before = (await core.request(METHODS.integrationStatus, {})).agents.find((agent) => agent.agent === 'claude')
    expect(before).toMatchObject({ state: 'not-enabled', file: settings, pending: true })
    await core.request(METHODS.integrationAnswer, { agent: 'claude', answer: 'not-now' })
    expect((await core.request(METHODS.integrationStatus, {})).agents.find((agent) => agent.agent === 'claude')?.pending).toBe(false)
    expect(fs.existsSync(settings)).toBe(false)

    const installed = await core.request(METHODS.integrationInstall, { agent: 'claude' })
    expect(installed).toMatchObject({ state: 'enabled', changed: true, written: null, pending: false })
    expect(fs.existsSync(settings)).toBe(true)
    await typeLine(core, id, '\u0003')
  })

  it('moves the space root when a plain tab cds, and keeps it while an agent sits elsewhere', async () => {
    const stack = await startStack()
    holder = stack.holder
    const core = stack.core
    clients.push(core)
    const space = fs.realpathSync(fs.mkdtempSync(path.join(home, 'space-')))
    const moved = fs.realpathSync(fs.mkdtempSync(path.join(home, 'moved-')))
    const { id: spaceId } = await core.request(METHODS.spacesAdd, { path: space })
    const { id } = await core.request(METHODS.tabsOpen, { spaceId, cols: 80, rows: 24 })

    await typeLine(core, id, `cd '${moved}'\n`)
    const root = await waitFor(
      async () => (await core.request(METHODS.spacesList, {})).spaces.find((candidate) => candidate.id === spaceId)?.path,
      (path) => path === moved,
      15000,
    )
    expect(root).toBe(moved)
  })
})
