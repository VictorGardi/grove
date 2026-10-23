import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadState } from './store/stateStore'
import { setupCore } from './testing/setup'

describe('session startup placeholder', () => {
  let disposeAll = () => {}
  afterEach(() => disposeAll())

  function setup() {
    const s = setupCore()
    disposeAll = s.disposeAll
    const core = s.make()
    // hold backend.create open until release(); fail() makes it throw instead
    let release!: () => void
    let fail!: (e: Error) => void
    const gate = new Promise<void>((res, rej) => { release = res; fail = rej })
    const real = s.fake.create.bind(s.fake)
    s.fake.create = async (o) => {
      await gate
      return real(o)
    }
    const sessions = () => core.getSlices().sessions
    const start = (kind: 'terminal' | 'opencode' = 'terminal') => core.commands.sessionCreate({ projectId: 'p', kind, cols: 80, rows: 24 })
    return { ...s, core, release, fail, sessions, start }
  }

  it('shows the placeholder before the pane exists, and never saves it', async () => {
    const { core, release, sessions, start, statePath } = setup()
    await core.start()
    const created = start()
    await new Promise((r) => setTimeout(r, 0))
    expect(sessions()).toHaveLength(1)
    expect(sessions()[0].startup?.phase).toBe('starting')
    expect(loadState(statePath).sessions).toEqual([])
    release()
    const res = await created
    expect(res.ok).toBe(true)
    expect(sessions()[0].startup?.phase).toBe('starting')
    expect(loadState(statePath).sessions).toHaveLength(1)
    expect(loadState(statePath).sessions[0]).not.toHaveProperty('startup')
  })

  it('clears startup when the first status is applied (OpenCode connects, terminal polls)', async () => {
    const { core, release, sessions, start, oc } = setup()
    await core.start()
    release()
    const o = await start('opencode')
    const t = await start('terminal')
    if (!o.ok || !t.ok) throw new Error('create failed')
    expect(sessions().every((s) => s.startup)).toBe(true)
    oc.emit({ type: 'connected', version: '2.0.20' })
    expect(sessions().find((s) => s.id === o.data.id)?.startup).toBeUndefined()
    expect(sessions().find((s) => s.id === t.data.id)?.startup).toBeDefined()
  })

  it('does not mark a pending placeholder gone on a liveness tick', async () => {
    const { core, release, sessions, start } = setup()
    await core.start()
    const created = start()
    await new Promise((r) => setTimeout(r, 0))
    await core.checkLiveness()
    expect(sessions()[0]).toMatchObject({ lastStatus: 'running', startup: { phase: 'starting' } })
    release()
    await created
  })

  it('removes the placeholder and reports the failure when create throws', async () => {
    const { core, fail, sessions, start, statePath } = setup()
    await core.start()
    const created = start()
    await new Promise((r) => setTimeout(r, 0))
    expect(sessions()).toHaveLength(1)
    fail(new Error('tmux failed'))
    await expect(created).rejects.toThrow('tmux failed')
    expect(sessions()).toEqual([])
    expect(loadState(statePath).sessions).toEqual([])
  })

  it('refuses kill and remove while starting', async () => {
    const { core, release, sessions, start } = setup()
    await core.start()
    const created = start()
    await new Promise((r) => setTimeout(r, 0))
    const id = sessions()[0].id
    expect(await core.commands.sessionKill({ id })).toEqual({ ok: false, error: 'starting' })
    expect(await core.commands.sessionRemove({ id })).toEqual({ ok: false, error: 'starting' })
    expect(sessions()).toHaveLength(1)
    release()
    await created
  })

  describe('60 s timeout', () => {
    afterEach(() => vi.useRealTimers())

    async function started(kind: 'terminal' | 'opencode' = 'opencode') {
      vi.useFakeTimers()
      let clock = new Date('2026-10-05T10:00:00.000Z')
      const s = setupCore()
      disposeAll = s.disposeAll
      const core = s.make(undefined, { now: () => clock })
      await core.start()
      const res = await core.commands.sessionCreate({ projectId: 'p', kind, cols: 80, rows: 24 })
      if (!res.ok) throw new Error(res.error)
      const at = (ms: number) => {
        clock = new Date(new Date('2026-10-05T10:00:00.000Z').getTime() + ms)
        vi.advanceTimersByTime(1000)
      }
      return { ...s, core, id: res.data.id, at, session: () => core.getSlices().sessions.find((x) => x.id === res.data.id)! }
    }

    it('keeps startup at 59 s and clears it at 60 s, with no failed state', async () => {
      const { at, session } = await started()
      at(59_000)
      expect(session().startup?.phase).toBe('starting')
      at(60_000)
      expect(session().startup).toBeUndefined()
      expect(session().lastStatus).toBe('running')
      expect(session().status).toBeUndefined()
    })

    it('clears with no terminal sessions present, and leaves sessions without startup alone', async () => {
      const { at, core, session } = await started('opencode')
      const before = core.getSlices().sessions
      at(30_000)
      expect(core.getSlices().sessions).toBe(before)
      at(61_000)
      expect(session().startup).toBeUndefined()
      const after = core.getSlices().sessions
      at(120_000)
      expect(core.getSlices().sessions).toBe(after)
    })

    it('shows the dot when a status arrives after the timeout', async () => {
      const { at, oc, session } = await started()
      at(61_000)
      oc.emit({ type: 'connected', version: '2.0.20' })
      expect(session().startup).toBeUndefined()
      expect(session().lastStatus).toBeDefined()
    })
  })
})
