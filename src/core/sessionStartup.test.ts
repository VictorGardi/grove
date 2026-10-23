import { afterEach, describe, expect, it } from 'vitest'
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
})
