import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { StatusEvent } from './contract.ts'
import { StatusService } from './service.ts'
import type { AgentAdapter } from './adapter.ts'

describe('StatusService', () => {
  let home: string
  let now: number
  let live: Set<string>
  let holderDown: boolean
  let sources: Map<string, (event: StatusEvent, at: number) => void>
  let changes: Array<{ tabId: string; state: string }>
  let sessions: Array<{ tabId: string; sessionId: string }>

  const fakeAdapter = (): AgentAdapter => ({
    kind: 'claude',
    launch: () => {
      throw new Error('not used: tabs are tracked directly')
    },
    watch: (input) => {
      sources.set(input.tabId, input.onEvent)
      return { close: () => sources.delete(input.tabId) }
    },
  })

  const make = (tickMs?: number) =>
    new StatusService({
      home,
      adapters: { claude: fakeAdapter() },
      alive: async () => {
        if (holderDown) throw new Error('the holder did not answer in time')
        return live
      },
      onSession: (tabId, sessionId) => sessions.push({ tabId, sessionId }),
      clock: () => now,
      tickMs,
    })

  const emit = (tabId: string, event: StatusEvent) => sources.get(tabId)!(event, now)
  const track = (service: StatusService, tabId = 't1') =>
    service.track({ tabId, spaceId: home, spacePath: home, kind: 'claude', sessionId: 's1' })
  const stateOf = (service: StatusService, tabId = 't1') =>
    service.list(live).find((agent) => agent.tabId === tabId)

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-service-'))
    now = 1000
    live = new Set(['t1'])
    holderDown = false
    sources = new Map()
    changes = []
    sessions = []
  })

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('starts a launched tab unknown and reports changes from holder reports', () => {
    const service = make()
    service.subscribe((change) => changes.push({ tabId: change.tabId, state: change.state }))
    track(service)
    expect(stateOf(service)).toMatchObject({ state: 'unknown', since: 1000 })

    now = 2000
    service.report('t1', { state: 'working' })
    service.report('t1', { state: 'working' })
    expect(stateOf(service)).toMatchObject({ state: 'working', since: 2000 })
    expect(changes).toEqual([{ tabId: 't1', state: 'working' }])
    service.close()
  })

  it('derives finished on working to idle, and leaves repeated idle unchanged', () => {
    const service = make()
    service.subscribe((change) => changes.push({ tabId: change.tabId, state: change.state }))
    track(service)
    service.report('t1', { state: 'working' })
    now = 2000
    service.report('t1', { state: 'idle' })
    service.report('t1', { state: 'idle' })
    expect(stateOf(service)).toMatchObject({ state: 'finished', since: 2000 })
    expect(changes.map(({ state }) => state)).toEqual(['working', 'finished'])
    service.close()
  })

  it('keeps a tab idle when idle is its first and repeated report', () => {
    const service = make()
    service.subscribe((change) => changes.push({ tabId: change.tabId, state: change.state }))
    track(service)
    service.report('t1', { state: 'idle' })
    now = 2000
    service.report('t1', { state: 'idle' })
    expect(stateOf(service)).toMatchObject({ state: 'idle', since: 1000 })
    expect(changes).toEqual([{ tabId: 't1', state: 'idle' }])
    service.close()
  })

  it('ignores adapter status events but still saves adapter session ids', () => {
    const service = make()
    track(service)
    for (const event of [
      { kind: 'working' },
      { kind: 'needs-you', reason: 'permission' },
      { kind: 'finished' },
      { kind: 'idle' },
    ] as const) {
      emit('t1', event)
    }
    expect(stateOf(service)).toMatchObject({ state: 'unknown' })
    emit('t1', { kind: 'session', resumeId: 's2' })
    expect(sessions).toEqual([{ tabId: 't1', sessionId: 's2' }])
    expect(JSON.parse(fs.readFileSync(path.join(home, 'agents', 'claude', 't1.status.json'), 'utf8'))).toEqual({
      resumeId: 's2',
    })
    live = new Set()
    expect(stateOf(service)).toMatchObject({ state: 'unknown', resumable: true })
    service.close()
  })

  it('restores status from the holder only while the matching agent is in the foreground', () => {
    const service = make()
    const snapshotDir = path.join(home, 'agents', 'claude')
    fs.mkdirSync(snapshotDir, { recursive: true })
    fs.writeFileSync(
      path.join(snapshotDir, 't1.status.json'),
      JSON.stringify({ status: { state: 'working', since: 500 }, resumeId: 's1' }),
    )
    service.restore(
      [{ id: 't1', spaceId: home, spacePath: home, agent: 'claude', agentSessionId: 's1' }],
      [{ id: 't1', command: '/bin/zsh', cwd: home, alive: true, exitCode: null, foreground: 'claude', argv0: 'claude', status: { state: 'working' } }],
    )
    expect(stateOf(service)).toMatchObject({ state: 'working', since: 1000 })
    expect(JSON.parse(fs.readFileSync(path.join(snapshotDir, 't1.status.json'), 'utf8'))).toEqual({ resumeId: 's1' })
    service.close()
  })

  it.each(['done', 'idle'] as const)('restores a last %s report as idle', (report) => {
    const service = make()
    service.restore(
      [{ id: 't1', spaceId: home, spacePath: home, agent: 'claude', agentSessionId: 's1' }],
      [{ id: 't1', command: '/bin/zsh', cwd: home, alive: true, exitCode: null, foreground: 'claude', argv0: 'claude', status: { state: report } }],
    )
    expect(stateOf(service)).toMatchObject({ state: 'idle' })
    service.close()
  })

  it('restores idle after a working-to-idle turn without replaying finished', () => {
    const first = make()
    track(first)
    first.report('t1', { state: 'working' })
    first.report('t1', { state: 'idle' })
    expect(stateOf(first)).toMatchObject({ state: 'finished' })
    first.close()

    const restarted = make()
    restarted.restore(
      [{ id: 't1', spaceId: home, spacePath: home, agent: 'claude', agentSessionId: 's1' }],
      [{ id: 't1', command: '/bin/zsh', cwd: home, alive: true, exitCode: null, foreground: 'claude', argv0: 'claude', status: { state: 'idle' } }],
    )
    expect(stateOf(restarted)).toMatchObject({ state: 'idle' })
    restarted.close()
  })

  it('does not restore a stale working report when a shell is in the foreground', () => {
    const service = make()
    service.restore(
      [{ id: 't1', spaceId: home, spacePath: home, agent: 'claude', agentSessionId: 's1' }],
      [{ id: 't1', command: '/bin/zsh', cwd: home, alive: true, exitCode: null, foreground: 'zsh', argv0: 'zsh', status: { state: 'working' } }],
    )
    expect(stateOf(service)).toMatchObject({ state: 'unknown', since: 1000 })
    service.close()
  })

  it('keeps a working tab working after 30 seconds without a report', async () => {
    const service = make()
    track(service)
    service.report('t1', { state: 'working' })
    now += 30001
    await service.tick()
    expect(stateOf(service)).toMatchObject({ state: 'working', since: 1000 })
    service.close()
  })

  it('resets a silent working tab only when the holder reports it gone', async () => {
    const service = make()
    track(service)
    service.report('t1', { state: 'working' })
    now += 30001
    await service.tick()
    expect(stateOf(service)).toMatchObject({ state: 'working' })

    live = new Set()
    await service.tick()
    expect(stateOf(service)).toMatchObject({ state: 'unknown', since: now, resumable: true })
    service.close()
  })

  it('falls to unknown when the holder tab is gone', async () => {
    const service = make()
    track(service)
    service.report('t1', { state: 'working' })
    live = new Set()
    now = 2500
    await service.tick()
    expect(stateOf(service)).toMatchObject({ state: 'unknown', since: 2500, resumable: true })
    service.close()
  })

  it('falls to unknown after two failed holder calls in a row', async () => {
    const service = make()
    track(service)
    service.report('t1', { state: 'working' })
    holderDown = true
    now = 2000
    await service.tick()
    expect(stateOf(service)).toMatchObject({ state: 'working' })
    now = 3000
    await service.tick()
    expect(stateOf(service)).toMatchObject({ state: 'unknown', since: 3000 })
    service.close()
  })

  it('stores only the resume id in a private status sidecar', () => {
    const service = make()
    track(service)
    const file = path.join(home, 'agents', 'claude', 't1.status.json')
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ resumeId: 's1' })
    service.close()
  })

  it('keeps working unchanged when markSeen is called', () => {
    const service = make()
    service.subscribe((change) => changes.push({ tabId: change.tabId, state: change.state }))
    track(service)
    service.report('t1', { state: 'working' })
    service.markSeen('t1')
    expect(stateOf(service)).toMatchObject({ state: 'working' })
    expect(changes).toEqual([{ tabId: 't1', state: 'working' }])
    service.close()
  })

  it('keeps the service usable when saving a session id fails', () => {
    const service = new StatusService({
      home,
      adapters: { claude: fakeAdapter() },
      alive: async () => live,
      onSession: () => {
        throw new Error('disk full')
      },
      clock: () => now,
    })
    track(service)
    expect(() => emit('t1', { kind: 'session', resumeId: 's2' })).not.toThrow()
    service.report('t1', { state: 'working' })
    expect(stateOf(service)).toMatchObject({ state: 'working' })
    service.close()
  })

  it('restarts an adopted source when its session id is identified', () => {
    const started: string[] = []
    const copilot: AgentAdapter = {
      kind: 'copilot',
      launch: () => {
        throw new Error('not used: tabs are tracked directly')
      },
      watch: (input) => {
        started.push(input.sessionId)
        sources.set(input.tabId, input.onEvent)
        return { close: () => sources.delete(input.tabId) }
      },
    }
    const service = new StatusService({
      home,
      adapters: { copilot },
      alive: async () => live,
      onSession: (tabId, sessionId) => sessions.push({ tabId, sessionId }),
      clock: () => now,
    })
    service.adopt({ tabId: 't1', kind: 'copilot', sessionId: '' })
    service.identify('t1', 'S1')
    service.identify('t1', 'S1')
    expect(started).toEqual(['', 'S1'])
    expect(sessions).toEqual([{ tabId: 't1', sessionId: 'S1' }])
    expect(stateOf(service)).toMatchObject({ state: 'unknown' })
    service.close()
  })

  it('adopts the holder status only for an agent foreground and keeps discovered session ids', () => {
    const copilot: AgentAdapter = {
      kind: 'copilot',
      launch: () => {
        throw new Error('not used: tabs are tracked directly')
      },
      discover: async () => 'copilot-session',
      watch: (input) => {
        sources.set(input.tabId, input.onEvent)
        return { close: () => sources.delete(input.tabId) }
      },
    }
    const service = new StatusService({
      home,
      adapters: { copilot },
      alive: async () => live,
      onSession: (tabId, sessionId) => sessions.push({ tabId, sessionId }),
      clock: () => now,
    })
    service.adopt({
      tabId: 't1',
      kind: 'copilot',
      sessionId: '',
      status: { state: 'working' },
      foreground: 'copilot',
    })
    expect(stateOf(service)).toMatchObject({ state: 'working' })
    service.identify('t1', 'copilot-session')
    expect(sessions).toEqual([{ tabId: 't1', sessionId: 'copilot-session' }])
    expect(stateOf(service)).toMatchObject({ state: 'working', resumable: false })
    service.close()
  })

  it('does not adopt a stale report when a shell is in the foreground', () => {
    const service = make()
    service.adopt({
      tabId: 't1',
      kind: 'claude',
      sessionId: '',
      status: { state: 'working' },
      foreground: 'zsh',
      argv0: 'zsh',
    })
    expect(stateOf(service)).toMatchObject({ state: 'unknown', since: 1000 })
    service.close()
  })

  it('marks a finished tab seen as idle and broadcasts the change', () => {
    const service = make()
    service.subscribe((change) => changes.push({ tabId: change.tabId, state: change.state }))
    track(service)
    service.report('t1', { state: 'working' })
    now = 2500
    service.report('t1', { state: 'idle' })
    now = 3000
    service.markSeen('t1')
    expect(stateOf(service)).toMatchObject({ state: 'idle', since: 3000 })
    expect(changes.map(({ state }) => state)).toEqual(['working', 'finished', 'idle'])
    service.close()
  })
})
