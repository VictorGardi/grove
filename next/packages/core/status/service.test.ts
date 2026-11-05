import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SILENCE_MS, type StatusEvent } from './contract.ts'
import { StatusService } from './service.ts'
import type { AgentAdapter } from './adapter.ts'

describe('StatusService', () => {
  let home: string
  let now: number
  let screen: string
  let live: Set<string>
  let holderDown: boolean
  let sources: Map<string, (event: StatusEvent, at: number) => void>
  let changes: Array<{ tabId: string; state: string }>
  let sessions: Array<{ tabId: string; sessionId: string }>

  // A fake Claude adapter: its watch hands the service's onEvent to the test, keyed by tab.
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

  const make = (
    overrides: { silenceMs?: number; tickMs?: number; onSession?: (tabId: string, sessionId: string) => void } = {},
  ) =>
    new StatusService({
      home,
      adapters: { claude: fakeAdapter() },
      screen: async () => screen,
      alive: async () => {
        if (holderDown) throw new Error('the holder did not answer in time')
        return live
      },
      onSession: overrides.onSession ?? ((tabId, sessionId) => sessions.push({ tabId, sessionId })),
      clock: () => now,
      graceMs: 3000,
      silenceMs: overrides.silenceMs ?? 30000,
      tickMs: overrides.tickMs,
    })

  const emit = (tabId: string, event: StatusEvent, at: number = now) => sources.get(tabId)!(event, at)
  const heartbeat = (tabId: string) => emit(tabId, { kind: 'heartbeat' })
  // Production heartbeats every second, then the service ticks. `beat` is one such second without moving the clock.
  const beat = async (service: StatusService) => {
    for (const tab of sources.keys()) heartbeat(tab)
    await service.tick()
  }
  // Runs `seconds` such seconds, moving the clock one second each.
  const run = async (service: StatusService, seconds: number) => {
    for (let i = 0; i < seconds; i++) {
      now += 1000
      await beat(service)
    }
  }
  const track = (service: StatusService, tabId = 't1') => service.track({ tabId, spaceId: home, spacePath: home, kind: 'claude', sessionId: 's1' })
  const stateOf = (service: StatusService, tabId = 't1') => service.list(live).find((agent) => agent.tabId === tabId)

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-service-'))
    now = 1000
    screen = 'Do you want to run this?\n1. Yes\n2. No'
    live = new Set(['t1'])
    holderDown = false
    sources = new Map()
    changes = []
    sessions = []
  })

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('starts a tracked tab idle and folds events into its state, reporting each change', () => {
    const service = make()
    service.subscribe((change) => changes.push({ tabId: change.tabId, state: change.state }))
    track(service)
    expect(service.list(new Set(['t1']))).toEqual([
      { tabId: 't1', agent: 'claude', state: 'idle', since: 1000, source: 'claude', resumable: false },
    ])

    now = 2000
    emit('t1', { kind: 'working' })
    emit('t1', { kind: 'working' })
    expect(changes).toEqual([{ tabId: 't1', state: 'working' }])
    expect(service.list(new Set())[0]).toMatchObject({ state: 'working', since: 2000, resumable: true })
    service.close()
  })

  it('writes the status file with private permissions', () => {
    const service = make()
    track(service)
    const file = path.join(home, 'agents', 'claude', 't1.status.json')
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    service.close()
  })

  it('takes the time of an event from the event, and the clock when it has none', () => {
    const service = make()
    track(service)
    emit('t1', { kind: 'working' }, 1500)
    expect(stateOf(service)).toMatchObject({ state: 'working', since: 1500 })
    emit('t1', { kind: 'finished' }, Number.NaN)
    expect(stateOf(service)).toMatchObject({ state: 'finished', since: now })
    service.close()
  })

  it('falls to unknown when the screen changes in real text after a needs-you, and holds on a repeated screen', async () => {
    const service = make()
    service.subscribe((change) => changes.push({ tabId: change.tabId, state: change.state }))
    track(service)
    now = 2000
    emit('t1', { kind: 'needs-you', reason: 'permission' })

    now = 5000
    await beat(service)
    expect(stateOf(service)).toMatchObject({ state: 'needs-you', reason: 'permission' })

    now = 6000
    await beat(service)
    expect(stateOf(service)).toMatchObject({ state: 'needs-you' })

    screen = 'Done. Here is the result.'
    now = 7000
    await beat(service)
    expect(stateOf(service)).toMatchObject({ state: 'unknown', since: 7000 })
    expect(changes.at(-1)).toEqual({ tabId: 't1', state: 'unknown' })
    service.close()
  })

  it('compares a screen change that happens inside the grace, falling to unknown once the grace has passed', async () => {
    const service = make()
    track(service)
    now = 2000
    emit('t1', { kind: 'needs-you', reason: 'permission' })

    // The first tick after the needs-you reads the dialog and keeps it as the baseline.
    now = 3000
    await beat(service)
    expect(stateOf(service)).toMatchObject({ state: 'needs-you' })

    // The dialog goes at about one second, inside the grace. That is not lost.
    screen = 'Done. Here is the result.'
    now = 4000
    await beat(service)
    expect(stateOf(service)).toMatchObject({ state: 'needs-you' })

    // Four seconds after the needs-you the comparison runs and the state falls to unknown.
    now = 6000
    await beat(service)
    expect(stateOf(service)).toMatchObject({ state: 'unknown', since: 6000 })
    service.close()
  })

  it('falls to unknown when a working tab has no real activity for the silence threshold, with the reader running', async () => {
    const service = make({ silenceMs: 30000 })
    track(service)
    now = 2000
    emit('t1', { kind: 'working' })

    await run(service, 29)
    expect(stateOf(service)).toMatchObject({ state: 'working', since: 2000 })
    await run(service, 1)
    expect(stateOf(service)).toMatchObject({ state: 'unknown', since: 32000 })
    service.close()
  })

  it('keeps a working tab working while its screen changes in real text', async () => {
    const service = make({ silenceMs: 30000 })
    track(service)
    now = 2000
    emit('t1', { kind: 'working' })

    for (let step = 0; step < 90; step++) {
      screen = `Running step ${step}`
      await run(service, 1)
    }
    expect(stateOf(service)).toMatchObject({ state: 'working', since: 2000 })
    service.close()
  })

  it('does not count a moving spinner or a ticking timer as activity', async () => {
    const service = make({ silenceMs: 30000 })
    track(service)
    now = 2000
    emit('t1', { kind: 'working' })

    const frames = ['⠋', '⠙', '⠹', '⠸']
    for (let step = 0; step < 40; step++) {
      screen = `${frames[step % frames.length]} Thinking… (${step}s · esc to interrupt)`
      await run(service, 1)
    }
    expect(stateOf(service)).toMatchObject({ state: 'unknown' })
    service.close()
  })

  it('keeps a working tab working while spool records arrive, even with a quiet screen', async () => {
    const service = make({ silenceMs: 30000 })
    track(service)
    now = 2000
    emit('t1', { kind: 'working' })

    for (let round = 0; round < 9; round++) {
      await run(service, 10)
      emit('t1', { kind: 'working' })
    }
    expect(stateOf(service)).toMatchObject({ state: 'working', since: 2000 })
    service.close()
  })

  it('falls to unknown in every state once the reader stops heartbeating and nothing real happens', async () => {
    const cases: Array<{ name: string; event: StatusEvent }> = [
      { name: 'needs-you', event: { kind: 'needs-you', reason: 'question' } },
      { name: 'working', event: { kind: 'working' } },
      { name: 'finished', event: { kind: 'finished' } },
      { name: 'idle', event: { kind: 'idle' } },
    ]
    for (const { name, event } of cases) {
      const service = make({ silenceMs: SILENCE_MS })
      track(service)
      now = 2000
      emit('t1', event)
      heartbeat('t1')
      now = 2000 + SILENCE_MS - 1
      await service.tick()
      expect(stateOf(service)?.state, name).toBe(name)
      now = 2000 + SILENCE_MS
      await service.tick()
      expect(stateOf(service), name).toMatchObject({ state: 'unknown', since: now })
      service.close()
    }
  })

  it('keeps a needs-you with no hook events while the reader keeps heartbeating', async () => {
    const service = make({ silenceMs: SILENCE_MS })
    track(service)
    now = 2000
    emit('t1', { kind: 'needs-you', reason: 'permission' })
    for (now = 2000; now <= 2000 + SILENCE_MS * 3; now += 1000) {
      await beat(service)
    }
    expect(stateOf(service)).toMatchObject({ state: 'needs-you', reason: 'permission', since: 2000 })
    service.close()
  })

  it('falls to unknown when the holder tab is gone, and keeps it unknown until a real event', async () => {
    const service = make()
    track(service)
    now = 2000
    emit('t1', { kind: 'needs-you', reason: 'permission' })
    live = new Set()
    now = 2500
    await beat(service)
    expect(stateOf(service)).toMatchObject({ state: 'unknown', since: 2500 })
    expect(stateOf(service)?.resumable).toBe(true)

    now = 3000
    emit('t1', { kind: 'working' })
    expect(stateOf(service)).toMatchObject({ state: 'working', since: 3000 })
    service.close()
  })

  it('falls to unknown when the source reports it lost, from any state', () => {
    const service = make()
    track(service)
    now = 2000
    emit('t1', { kind: 'working' })
    now = 2500
    emit('t1', { kind: 'lost' })
    expect(stateOf(service)).toMatchObject({ state: 'unknown', since: 2500 })
    service.close()
  })

  it('keeps a finished or idle tab after one failed holder call', async () => {
    const service = make()
    track(service, 't1')
    track(service, 't2')
    live = new Set(['t1', 't2'])
    now = 2000
    emit('t1', { kind: 'finished' })
    emit('t2', { kind: 'idle' })
    holderDown = true
    now = 2500
    await beat(service)
    expect(stateOf(service, 't1')).toMatchObject({ state: 'finished', since: 2000 })
    expect(stateOf(service, 't2')).toMatchObject({ state: 'idle', since: 1000 })
    service.close()
  })

  it('falls a finished or idle tab to unknown after two failed holder calls in a row', async () => {
    const service = make()
    track(service, 't1')
    track(service, 't2')
    live = new Set(['t1', 't2'])
    now = 2000
    emit('t1', { kind: 'finished' })
    emit('t2', { kind: 'idle' })
    holderDown = true
    now = 2500
    await beat(service)
    now = 3000
    await beat(service)
    expect(stateOf(service, 't1')).toMatchObject({ state: 'unknown', since: 3000 })
    expect(stateOf(service, 't2')).toMatchObject({ state: 'unknown', since: 3000 })
    service.close()
  })

  it('resets the failure count on a successful holder call, so one failure, a success, then one failure keeps the tab', async () => {
    const service = make()
    track(service)
    now = 2000
    emit('t1', { kind: 'finished' })
    holderDown = true
    now = 2500
    await beat(service)
    holderDown = false
    now = 3000
    await beat(service)
    holderDown = true
    now = 3500
    await beat(service)
    expect(stateOf(service)).toMatchObject({ state: 'finished', since: 2000 })
    service.close()
  })

  it('keeps a tab unknown after the holder answers', async () => {
    const service = make()
    track(service)
    now = 2000
    emit('t1', { kind: 'finished' })
    holderDown = true
    now = 2500
    await beat(service)
    now = 2600
    await beat(service)
    expect(stateOf(service)).toMatchObject({ state: 'unknown', since: 2600 })

    holderDown = false
    now = 3000
    await beat(service)
    expect(stateOf(service)).toMatchObject({ state: 'unknown', since: 2600 })
    service.close()
  })

  it('falls a working tab to unknown through the watchdog when its screen changes only in spinner glyphs and token counters', async () => {
    const service = make({ silenceMs: 30000 })
    track(service)
    now = 2000
    emit('t1', { kind: 'working' })

    const frames = [
      '✻ Thinking… (12s · ↑ 1.2k tokens)',
      '✽ Thinking… (13s · ↑ 1.3k tokens)',
      '✶ Thinking… (14s · ↓ 1.4k tokens)',
      '✳ Thinking… (15s · ↑ 1.5k tokens)',
      '✢ Thinking… (16s · ↑ 2m tokens)',
    ]
    for (let step = 0; step < 29; step++) {
      screen = frames[step % frames.length]
      await run(service, 1)
    }
    expect(stateOf(service)).toMatchObject({ state: 'working', since: 2000 })
    screen = frames[0]
    await run(service, 1)
    expect(stateOf(service)).toMatchObject({ state: 'unknown', since: 32000 })
    service.close()
  })

  it('keeps a working tab working while its screen changes in real text under a spinner and token counter', async () => {
    const service = make({ silenceMs: 30000 })
    track(service)
    now = 2000
    emit('t1', { kind: 'working' })

    for (let step = 0; step < 40; step++) {
      screen = `✻ Running step ${Math.floor(step / 10)} (${step}s)\n↑ ${step}.2k tokens`
      await run(service, 1)
    }
    expect(stateOf(service)).toMatchObject({ state: 'working', since: 2000 })
    service.close()
  })

  it('restores a tab whose holder tab is gone as unknown, even when its spool replays a needs-you', () => {
    const resumeId = '00000000-0000-4000-8000-00000000000e'
    const restored = new StatusService({
      home,
      adapters: {
        claude: {
          kind: 'claude',
          launch: () => {
            throw new Error('not used: a restore does not launch')
          },
          watch: (input) => {
            input.onEvent({ kind: 'needs-you', reason: 'permission' }, now)
            return { close: () => undefined }
          },
        },
      },
      screen: async () => screen,
      alive: async () => new Set(),
      clock: () => now,
    })
    restored.restore([{ id: 't9', spaceId: home, spacePath: home, agent: 'claude', agentSessionId: resumeId }], new Set())
    expect(restored.list(new Set())).toEqual([
      { tabId: 't9', agent: 'claude', state: 'unknown', since: now, source: 'claude', resumable: true },
    ])
    restored.close()
  })

  it('logs a failed status check from the timer instead of leaving it unhandled', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const service = make({ silenceMs: 0, tickMs: 1 })
    service.subscribe(() => {
      throw new Error('listener failed')
    })
    track(service)
    service.start()
    await new Promise((resolve) => setTimeout(resolve, 30))
    service.close()
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('status check failed'))
    errors.mockRestore()
  })

  it('falls to unknown when the holder cannot be reached, and when a screen read fails', async () => {
    const service = make()
    track(service)
    now = 2000
    emit('t1', { kind: 'needs-you', reason: 'permission' })
    const unreachable = new StatusService({
      home,
      adapters: { claude: fakeAdapter() },
      screen: async () => {
        throw new Error('no such tab')
      },
      alive: async () => {
        throw new Error('holder down')
      },
      clock: () => now,
      graceMs: 0,
    })
    track(unreachable, 't2')
    now = 2100
    emit('t2', { kind: 'needs-you', reason: 'permission' }, now)
    await unreachable.tick()
    expect(stateOf(unreachable, 't2')).toMatchObject({ state: 'unknown' })
    service.close()
    unreachable.close()
  })

  it('passes a session id to the caller without changing the state', () => {
    const service = make()
    track(service)
    emit('t1', { kind: 'session', resumeId: 's2' })
    expect(sessions).toEqual([{ tabId: 't1', sessionId: 's2' }])
    expect(service.list(new Set())[0]).toMatchObject({ state: 'idle', resumable: true })
    service.close()
  })

  it('keeps the core running when saving a session id fails', () => {
    const service = make({
      onSession: () => {
        throw new Error('disk full')
      },
    })
    track(service)
    expect(() => emit('t1', { kind: 'session', resumeId: 's2' })).not.toThrow()
    emit('t1', { kind: 'working' })
    expect(stateOf(service)).toMatchObject({ state: 'working' })
    service.close()
  })

  it('marks a finished tab seen: it becomes idle from now, is saved, and is broadcast', () => {
    const service = make()
    service.subscribe((change) => changes.push({ tabId: change.tabId, state: change.state }))
    track(service)
    now = 2000
    emit('t1', { kind: 'finished' })
    now = 2500
    service.markSeen('t1')
    expect(stateOf(service)).toMatchObject({ state: 'idle', since: 2500 })
    expect(changes.at(-1)).toEqual({ tabId: 't1', state: 'idle' })
    const saved = JSON.parse(fs.readFileSync(path.join(home, 'agents', 'claude', 't1.status.json'), 'utf8'))
    expect(saved.status).toEqual({ state: 'idle', since: 2500 })
    service.close()
  })

  it('leaves a working tab untouched by markSeen', () => {
    const service = make()
    const seenChanges: string[] = []
    service.subscribe((change) => seenChanges.push(change.state))
    track(service)
    now = 2000
    emit('t1', { kind: 'working' })
    service.markSeen('t1')
    expect(stateOf(service)).toMatchObject({ state: 'working', since: 2000 })
    expect(seenChanges).toEqual(['working'])
    service.close()
  })

  it('ignores markSeen for a needs-you, idle, or unknown tab and for an unknown tab id', () => {
    const service = make()
    track(service)
    emit('t1', { kind: 'needs-you', reason: 'permission' })
    service.markSeen('t1')
    expect(stateOf(service)).toMatchObject({ state: 'needs-you', reason: 'permission' })
    service.markSeen('nope')
    service.close()
  })
})
