import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadState } from './store/stateStore'
import { setupCore } from './testing/setup'

describe('resumed session startup', () => {
  let disposeAll = () => {}
  afterEach(() => {
    vi.useRealTimers()
    disposeAll()
  })

  // a Claude session made, then killed: gone and resumable (Claude has no event stream here, so no status arrives)
  async function goneSession(clock: { now: Date } = { now: new Date('2026-10-05T10:00:00.000Z') }) {
    const s = setupCore()
    disposeAll = s.disposeAll
    const core = s.make(undefined, { now: () => clock.now })
    await core.start()
    const res = await core.commands.sessionCreate({ projectId: 'p', kind: 'claude', cols: 80, rows: 24 })
    if (!res.ok) throw new Error('create failed')
    const id = res.data.id
    await core.commands.sessionKill({ id })
    const sessions = () => core.getSlices().sessions
    const find = () => sessions().find((x) => x.id === id)!
    return { ...s, core, id, sessions, find, clock }
  }

  it('sets startup starting with its own since, and saves the session as running without it', async () => {
    const { core, id, find, clock, statePath } = await goneSession()
    const startedAt = find().startedAt
    clock.now = new Date('2026-10-05T11:00:00.000Z')
    expect((await core.commands.sessionResume({ id })).ok).toBe(true)
    expect(find().lastStatus).toBe('running')
    expect(find().startup).toEqual({ phase: 'starting', since: '2026-10-05T11:00:00.000Z' })
    expect(find().startup).not.toEqual({ phase: 'starting', since: startedAt })
    expect(loadState(statePath).sessions[0]).not.toHaveProperty('startup')
  })

  it('clears a prior run\'s status on resume, so a stale dot never ends the spinner', async () => {
    const { core, id, find } = await goneSession()
    core.getSlices().sessions.forEach((x) => { x.status = 'idle' }) // a stale status left on the gone session
    await core.commands.sessionResume({ id })
    expect(find().status).toBeUndefined()
    expect(find().startup?.phase).toBe('starting')
  })

  it('clears startup after 60 s without a status', async () => {
    vi.useFakeTimers()
    const { core, id, find, clock } = await goneSession()
    await core.commands.sessionResume({ id })
    clock.now = new Date(clock.now.getTime() + 59_000)
    vi.advanceTimersByTime(1000)
    expect(find().startup?.phase).toBe('starting')
    clock.now = new Date(clock.now.getTime() + 1_000)
    vi.advanceTimersByTime(1000)
    expect(find().startup).toBeUndefined()
    expect(find().lastStatus).toBe('running')
  })

  it('is not marked gone or cleared by sweeps while its pane is being made', async () => {
    const { core, id, find, fake } = await goneSession()
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const real = fake.create.bind(fake)
    fake.create = async (o) => {
      await gate
      return real(o)
    }
    const resumed = core.commands.sessionResume({ id })
    await new Promise((r) => setTimeout(r, 0))
    expect(find().startup?.phase).toBe('starting')
    await core.checkLiveness()
    expect(find()).toMatchObject({ lastStatus: 'gone', startup: { phase: 'starting' } }) // not cleared by the gone clause
    expect(await core.commands.sessionKill({ id })).toEqual({ ok: false, error: 'starting' })
    expect(await core.commands.sessionResume({ id })).toEqual({ ok: false, error: 'starting' })
    release()
    await resumed
    expect(find()).toMatchObject({ lastStatus: 'running', startup: { phase: 'starting' } })
  })

  it('leaves a failed card on a throwing backend.create, keeps the saved copy gone, and dismiss clears only startup', async () => {
    const { core, id, find, sessions, fake, statePath } = await goneSession()
    fake.create = async () => { throw new Error('tmux failed') }
    await expect(core.commands.sessionResume({ id })).rejects.toThrow('tmux failed')
    expect(find()).toMatchObject({ lastStatus: 'gone', startup: { phase: 'failed', reason: 'tmux failed' } })
    expect(loadState(statePath).sessions[0]).toMatchObject({ lastStatus: 'gone' })
    expect(await core.commands.sessionDismissStartup({ id })).toEqual({ ok: true, data: { id } })
    expect(sessions()).toHaveLength(1)
    expect(find()).toMatchObject({ lastStatus: 'gone' })
    expect(find().startup).toBeUndefined()
    expect(loadState(statePath).sessions[0]).toMatchObject({ lastStatus: 'gone' })
  })

  it('restart-restored sessions load without startup', async () => {
    const { core, id, find, statePath } = await goneSession()
    await core.commands.sessionResume({ id })
    expect(find().startup).toBeDefined()
    const saved = loadState(statePath)
    expect(saved.sessions.every((x) => !('startup' in x))).toBe(true)
  })
})
