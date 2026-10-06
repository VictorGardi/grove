import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_UI, type Session } from '@shared/types'
import { terminalTheme } from '@shared/theme'
import { makeLabel, newSession, reconcile } from './sessions'
import { loadState } from './store/stateStore'
import { createOpenCode, createTerminal as create, LATER, NOW, setupCore } from './testing/setup'

function session(id: string, over: Partial<Session> = {}): Session {
  return { ...newSession({ projectId: 'p', kind: 'terminal', now: NOW, id }), ...over }
}

describe('reconcile', () => {
  it('marks missing sessions gone and keeps the rest', () => {
    const gone = session('c', { lastStatus: 'gone', endedAt: NOW.toISOString() })
    const out = reconcile([session('a'), session('b'), gone], new Set(['grove-a', 'grove-orphan']), LATER.toISOString())
    expect(out.map((s) => [s.id, s.lastStatus, s.endedAt])).toEqual([
      ['a', 'running', null],
      ['b', 'gone', LATER.toISOString()],
      ['c', 'gone', NOW.toISOString()],
    ])
  })

  it('returns the same array when nothing changed', () => {
    const list = [session('a')]
    expect(reconcile(list, new Set(['grove-a']), LATER.toISOString())).toBe(list)
  })
})

describe('makeLabel', () => {
  it('uses local HH:MM', () => {
    expect(makeLabel('terminal', new Date(2026, 9, 5, 9, 7))).toBe('Terminal · 09:07')
  })
})

describe('core sessions', () => {
  let disposeAll = () => {}
  afterEach(() => disposeAll())

  function setup() {
    const s = setupCore()
    disposeAll = s.disposeAll
    return s
  }

  it('persists sessions and marks them gone on a liveness check', async () => {
    const { fake, make, statePath } = setup()
    const a = make()
    await a.start()
    const s1 = await create(a)
    const s2 = await create(a)

    const b = make(LATER)
    await b.start()
    expect(b.getSlices().sessions.map((s) => s.id)).toEqual([s1.id, s2.id])

    const emitted: string[] = []
    b.on('slice', (k) => emitted.push(k))
    fake.live.delete(s1.tmuxName)
    await b.checkLiveness()
    expect(b.getSlices().sessions[0]).toMatchObject({ lastStatus: 'gone', endedAt: LATER.toISOString() })
    expect(emitted).toContain('sessions')
    expect(loadState(statePath).sessions[0].lastStatus).toBe('gone')
  })

  it('reads each live session branch from its current directory, without saving it', async () => {
    const { dir, fake, make, statePath } = setup()
    fs.mkdirSync(path.join(dir, '.git'))
    fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n')
    const a = make()
    await a.start()
    const s = await create(a)
    await a.checkLiveness()
    expect(a.getSlices().sessions[0].branch).toBe('main')

    fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/other\n')
    await a.checkLiveness()
    expect(a.getSlices().sessions[0].branch).toBe('other')

    fake.paths.set(s.tmuxName, path.join(dir, '..'))
    await a.checkLiveness()
    expect(a.getSlices().sessions[0].branch).toBeNull()
    expect(fs.readFileSync(statePath, 'utf8')).not.toContain('branch')
  })

  it('saves sessions missing from tmux as gone on start', async () => {
    const { fake, make, statePath } = setup()
    const a = make()
    await a.start()
    const s = await create(a)
    fake.live.delete(s.tmuxName)

    await make(LATER).start()
    expect(loadState(statePath).sessions[0]).toMatchObject({ lastStatus: 'gone', endedAt: LATER.toISOString() })
  })

  it('checks liveness when an attach exits', async () => {
    const { fake, make } = setup()
    const a = make()
    await a.start()
    const s = await create(a)
    a.attach(s.id, 80, 24)
    fake.live.delete(s.tmuxName)
    fake.handles[0].emitExit()
    await new Promise((r) => setImmediate(r))
    expect(a.getSlices().sessions[0].lastStatus).toBe('gone')
  })

  it('starts opencode sessions through a login shell with a minted id', async () => {
    const { fake, make } = setup()
    const a = make()
    await a.start()
    const res = await a.commands.sessionCreate({ projectId: 'p', kind: 'opencode', cols: 80, rows: 24 })
    if (!res.ok) throw new Error(res.error)
    expect(res.data.opencodeSessionId).toMatch(/^ses_/)
    expect(res.data.label).toMatch(/^OpenCode · /)
    const call = fake.calls.find((c) => c.method === 'create')!
    const { argv } = call.args[0] as { argv: string[] }
    expect(argv[4]).toBe(`exec opencode -s ${res.data.opencodeSessionId}`)
  })

  it('sets the terminal colours on create', async () => {
    const { fake, make } = setup()
    const a = make()
    await a.start()
    const s = await create(a)
    expect(fake.calls).toContainEqual({ method: 'setColors', args: [s.tmuxName, terminalTheme.foreground, terminalTheme.background] })
  })

  it('starts terminal sessions with no argv', async () => {
    const { fake, make } = setup()
    const a = make()
    await a.start()
    await create(a)
    const call = fake.calls.find((c) => c.method === 'create')!
    expect((call.args[0] as { argv?: string[] }).argv).toBeUndefined()
  })

  it('persists ui changes', async () => {
    const { make, statePath } = setup()
    const a = make()
    await a.start()
    const res = await a.commands.uiSet({ focusedSessionId: 'x' })
    expect(res).toEqual({ ok: true, data: { ...DEFAULT_UI, focusedSessionId: 'x' } })
    expect(loadState(statePath).ui.focusedSessionId).toBe('x')
  })

  it('kills a session, marks it gone and saves', async () => {
    const { fake, make, statePath } = setup()
    const a = make(LATER)
    await a.start()
    const s = await create(a)
    expect(await a.commands.sessionKill({ id: s.id })).toEqual({ ok: true, data: { id: s.id } })
    expect(fake.calls.some((c) => c.method === 'kill' && c.args[0] === s.tmuxName)).toBe(true)
    expect(loadState(statePath).sessions[0]).toMatchObject({ lastStatus: 'gone', endedAt: LATER.toISOString() })
  })

  it('kills a session that tmux already lost', async () => {
    const { fake, make } = setup()
    const a = make()
    await a.start()
    const s = await create(a)
    fake.live.delete(s.tmuxName)
    expect((await a.commands.sessionKill({ id: s.id })).ok).toBe(true)
    expect(a.getSlices().sessions[0].lastStatus).toBe('gone')
  })

  it('removes only gone sessions', async () => {
    const { make } = setup()
    const a = make()
    await a.start()
    const s = await create(a)
    expect(await a.commands.sessionRemove({ id: s.id })).toEqual({ ok: false, error: 'not-gone' })
    await a.commands.sessionKill({ id: s.id })
    expect(await a.commands.sessionRemove({ id: s.id })).toEqual({ ok: true, data: { id: s.id } })
    expect(a.getSlices().sessions).toEqual([])
  })

  it('clears focus when the focused session is removed', async () => {
    const { make } = setup()
    const a = make()
    await a.start()
    const s = await create(a)
    await a.commands.uiSet({ focusedSessionId: s.id })
    await a.commands.sessionKill({ id: s.id })
    await a.commands.sessionRemove({ id: s.id })
    expect(a.getSlices().ui.focusedSessionId).toBeNull()
  })

  it('renames and pins the label across restarts', async () => {
    const { make } = setup()
    const a = make()
    await a.start()
    const s = await create(a)
    const res = await a.commands.sessionRename({ id: s.id, label: 'build' })
    expect(res.ok && res.data).toMatchObject({ label: 'build', labelPinned: true })
    const b = make()
    await b.start()
    expect(b.getSlices().sessions[0]).toMatchObject({ label: 'build', labelPinned: true })
  })

  it('returns not-found for unknown ids', async () => {
    const { make } = setup()
    const a = make()
    await a.start()
    const nf = { ok: false, error: 'not-found' }
    expect(await a.commands.sessionKill({ id: 'x' })).toEqual(nf)
    expect(await a.commands.sessionRemove({ id: 'x' })).toEqual(nf)
    expect(await a.commands.sessionRename({ id: 'x', label: 'y' })).toEqual(nf)
  })
})

describe('core opencode status', () => {
  let disposeAll = () => {}
  afterEach(() => disposeAll())

  async function connected() {
    const s = setupCore()
    disposeAll = s.disposeAll
    const core = s.make()
    await core.start()
    s.oc.emit({ type: 'connected', version: '2.0.20' })
    return { ...s, core }
  }
  const find = (core: { getSlices(): { sessions: Session[] } }, id: string) => core.getSlices().sessions.find((x) => x.id === id)

  it('shows a new OpenCode session idle while connected, and terminals without status', async () => {
    const { core } = await connected()
    const o = await createOpenCode(core)
    const t = await create(core)
    expect(find(core, o.id)?.status).toBe('idle')
    expect(find(core, t.id)).not.toHaveProperty('status')
  })

  it('follows a turn: working, then idle, never saving status', async () => {
    const { core, oc, statePath } = await connected()
    const o = await createOpenCode(core)
    const sessionId = o.opencodeSessionId!
    oc.emit({ type: 'exec-started', sessionId })
    expect(find(core, o.id)?.status).toBe('working')
    const saved = JSON.parse(fs.readFileSync(statePath, 'utf8')) as { sessions: Session[] }
    expect(saved.sessions[0]).not.toHaveProperty('status')
    oc.emit({ type: 'exec-ended', sessionId, at: LATER.toISOString() })
    expect(find(core, o.id)?.status).toBe('idle')
  })

  it('drops status on disconnect and stops the source on dispose', async () => {
    const { core, oc } = await connected()
    const o = await createOpenCode(core)
    oc.emit({ type: 'disconnected' })
    expect(find(core, o.id)).not.toHaveProperty('status')
    core.dispose()
    expect(oc.stopped).toBe(true)
  })
})
