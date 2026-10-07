import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_UI, type Session } from '@shared/types'
import { terminalTheme } from '@shared/theme'
import { makeLabel, newSession, reconcile } from './sessions'
import { loadState } from './store/stateStore'
import type { AgentEvent } from './agents/types'
import { createOpenCode, createTerminal as create, LATER, NOW, setupCore } from './testing/setup'

function session(id: string, over: Partial<Session> = {}): Session {
  return { ...newSession({ projectId: 'p', kind: 'terminal', now: NOW, id, agentSessionId: null }), ...over }
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
    expect(makeLabel('claude', new Date(2026, 9, 5, 9, 7))).toBe('Claude · 09:07')
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
    expect(res.data.agentSessionId).toMatch(/^ses_/)
    expect(res.data.label).toMatch(/^OpenCode · /)
    const call = fake.calls.find((c) => c.method === 'create')!
    const { argv } = call.args[0] as { argv: string[] }
    expect(argv[4]).toBe(`exec opencode -s ${res.data.agentSessionId}`)
  })

  it('starts claude sessions with a uuid, per-launch hooks and a private spool dir', async () => {
    const { fake, make, claudeDir } = setup()
    const a = make()
    await a.start()
    const res = await a.commands.sessionCreate({ projectId: 'p', kind: 'claude', cols: 80, rows: 24 })
    if (!res.ok) throw new Error(res.error)
    const id = res.data.agentSessionId!
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(res.data.label).toMatch(/^Claude · /)
    const call = fake.calls.find((c) => c.method === 'create')!
    const { argv } = call.args[0] as { argv: string[] }
    expect(argv[4].startsWith(`exec claude --session-id ${id} --settings `)).toBe(true)
    expect(argv[4]).toContain(path.join(claudeDir, `${id}.jsonl`))
    expect(fs.statSync(claudeDir).mode & 0o777).toBe(0o700)
  })

  it('refuses claude sessions without a spool dir', async () => {
    const { fake, make } = setup()
    const a = make(NOW, { claudeSpoolDir: undefined })
    await a.start()
    expect(await a.commands.sessionCreate({ projectId: 'p', kind: 'claude', cols: 80, rows: 24 })).toEqual({ ok: false, error: 'no-source' })
    expect(fake.calls.some((c) => c.method === 'create')).toBe(false)
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

  it('moves focus to the project page when the focused session is removed', async () => {
    const { make } = setup()
    const a = make()
    await a.start()
    const s = await create(a)
    await a.commands.uiSet({ focusedSessionId: s.id })
    await a.commands.sessionKill({ id: s.id })
    await a.commands.sessionRemove({ id: s.id })
    expect(a.getSlices().ui).toMatchObject({ focusedSessionId: null, focusedProject: s.projectId })
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

  it('follows a turn: working, then waiting until seen (off screen), never saving status', async () => {
    const { core, oc, statePath } = await connected()
    const o = await createOpenCode(core)
    const sessionId = o.agentSessionId!
    oc.emit({ type: 'exec-started', sessionId })
    expect(find(core, o.id)?.status).toBe('working')
    const saved = JSON.parse(fs.readFileSync(statePath, 'utf8')) as { sessions: Session[] }
    expect(saved.sessions[0]).not.toHaveProperty('status')
    oc.emit({ type: 'exec-ended', sessionId, at: LATER.toISOString() })
    expect(find(core, o.id)).toMatchObject({ status: 'waiting', waitingFor: 'done' })
  })

  it('waits on a subagent permission, never saving it', async () => {
    const { core, oc, statePath } = await connected()
    const o = await createOpenCode(core)
    oc.emit({ type: 'child', sessionId: 'ses_child', parentId: o.agentSessionId! })
    oc.emit({ type: 'pending', sessionId: 'ses_child', id: 'per_1', kind: 'permission', open: true })
    expect(find(core, o.id)).toMatchObject({ status: 'waiting', waitingFor: 'permission' })
    const saved = JSON.parse(fs.readFileSync(statePath, 'utf8')) as { sessions: Session[] }
    expect(saved.sessions[0]).not.toHaveProperty('waitingFor')
    oc.emit({ type: 'pending', sessionId: 'ses_child', id: 'per_1', kind: 'permission', open: false })
    expect(find(core, o.id)?.status).toBe('idle')
  })

  const flush = () => new Promise((r) => setImmediate(r))
  const snap = (over = {}) => ({ running: false, idleAt: null, pending: [], children: [], ...over })

  async function started() {
    const s = setupCore()
    disposeAll = s.disposeAll
    const core = s.make()
    await core.start()
    return { ...s, core }
  }

  it('reports the connection and snapshots live OpenCode sessions on connect', async () => {
    const { core, oc, fake } = await started()
    expect(core.getSlices().opencode).toEqual({ state: 'connecting', version: null })
    const o = await createOpenCode(core)
    const ended = await createOpenCode(core)
    await create(core)
    fake.live.delete(ended.tmuxName)
    await core.checkLiveness()
    oc.emit({ type: 'connected', version: '2.0.20' })
    expect(core.getSlices().opencode).toEqual({ state: 'connected', version: '2.0.20' })
    expect(oc.snapshotCalls).toEqual([[o.agentSessionId]])
  })

  it('restores a pending permission from the snapshot', async () => {
    const { core, oc } = await started()
    const o = await createOpenCode(core)
    oc.snapshots.set(o.agentSessionId!, snap({ running: true, pending: [{ id: 'per_1', kind: 'permission' }] }))
    oc.emit({ type: 'connected', version: '2.0.20' })
    await flush()
    expect(find(core, o.id)).toMatchObject({ status: 'waiting', waitingFor: 'permission' })
  })

  it('folds a snapshot child\'s form into its root, and its later reply', async () => {
    const { core, oc } = await started()
    const o = await createOpenCode(core)
    oc.snapshots.set(o.agentSessionId!, snap({ children: ['ses_child'] }))
    oc.snapshots.set('ses_child', snap({ pending: [{ id: 'frm_1', kind: 'question' }] }))
    oc.emit({ type: 'connected', version: '2.0.20' })
    await flush()
    expect(find(core, o.id)).toMatchObject({ status: 'waiting', waitingFor: 'question' })
    oc.emit({ type: 'pending', sessionId: 'ses_child', id: 'frm_1', kind: 'question', open: false })
    expect(find(core, o.id)?.status).toBe('idle')
  })

  it('replays events that arrive while the snapshot is in flight', async () => {
    const { core, oc } = await started()
    const o = await createOpenCode(core)
    oc.snapshots.set(o.agentSessionId!, snap())
    oc.emit({ type: 'connected', version: '2.0.20' })
    oc.emit({ type: 'exec-started', sessionId: o.agentSessionId! })
    await flush()
    expect(find(core, o.id)?.status).toBe('working')
  })

  it('falls back on disconnect and is unreachable after 5 s', async () => {
    const { core, oc, statePath } = await started()
    const o = await createOpenCode(core)
    oc.emit({ type: 'connected', version: '2.0.20' })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      oc.emit({ type: 'disconnected' })
      expect(find(core, o.id)).not.toHaveProperty('status')
      expect(core.getSlices().opencode.state).toBe('connecting')
      vi.advanceTimersByTime(4000)
      oc.emit({ type: 'connected', version: '2.0.20' })
      vi.advanceTimersByTime(2000)
      expect(core.getSlices().opencode.state).toBe('connected')
      oc.emit({ type: 'disconnected' })
      vi.advanceTimersByTime(5000)
      expect(core.getSlices().opencode).toEqual({ state: 'unreachable', version: null })
    } finally {
      vi.useRealTimers()
    }
    expect(JSON.parse(fs.readFileSync(statePath, 'utf8'))).not.toHaveProperty('opencode')
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

describe('core seen and notify', () => {
  let disposeAll = () => {}
  afterEach(() => disposeAll())

  const flush = () => new Promise((r) => setImmediate(r))
  const snap = (over = {}) => ({ running: false, idleAt: null, pending: [], children: [], ...over })
  const ENDED = '2026-10-05T09:59:00.000Z' // before NOW, the cores' clock
  const find = (core: { getSlices(): { sessions: Session[] } }, id: string) => core.getSlices().sessions.find((x) => x.id === id)

  async function setup() {
    const s = setupCore()
    disposeAll = s.disposeAll
    const core = s.make()
    await core.start()
    const notified: Session[] = []
    core.on('notify', (x) => notified.push(x))
    return { ...s, core, notified }
  }

  async function connect(oc: { emit(e: AgentEvent): void }) {
    oc.emit({ type: 'connected', version: '2.0.20' })
    await flush()
  }

  it('keeps a turn finished off screen waiting, notifies once, and clears it once seen, across restarts', async () => {
    const { core, oc, notified, make } = await setup()
    const o = await createOpenCode(core)
    await connect(oc)
    const sessionId = o.agentSessionId!
    oc.emit({ type: 'exec-started', sessionId })
    oc.emit({ type: 'exec-ended', sessionId, at: ENDED })
    expect(find(core, o.id)).toMatchObject({ status: 'waiting', waitingFor: 'done' })
    expect(notified.map((x) => [x.id, x.waitingFor])).toEqual([[o.id, 'done']])

    core.setWindowFocused(true)
    await core.commands.uiSet({ focusedSessionId: o.id })
    expect(find(core, o.id)?.status).toBe('idle')
    expect(find(core, o.id)?.seenAt).toBe(NOW.toISOString())
    expect(notified).toHaveLength(1)

    core.dispose()
    oc.snapshots.set(sessionId, snap({ idleAt: ENDED }))
    const next = make()
    await next.start()
    await connect(oc)
    expect(find(next, o.id)?.status).toBe('idle')
  })

  it('marks a turn finished on screen as seen, without notifying', async () => {
    const { core, oc, notified } = await setup()
    const o = await createOpenCode(core)
    await connect(oc)
    core.setWindowFocused(true)
    await core.commands.uiSet({ focusedSessionId: o.id })
    oc.emit({ type: 'exec-started', sessionId: o.agentSessionId! })
    oc.emit({ type: 'exec-ended', sessionId: o.agentSessionId!, at: ENDED })
    expect(find(core, o.id)?.status).toBe('idle')
    expect(notified).toEqual([])
  })

  it('does not notify for the first snapshot, but does for later changes', async () => {
    const { core, oc, notified } = await setup()
    const a = await createOpenCode(core)
    const b = await createOpenCode(core)
    oc.snapshots.set(a.agentSessionId!, snap({ pending: [{ id: 'per_1', kind: 'permission' }] }))
    await connect(oc)
    expect(find(core, a.id)).toMatchObject({ status: 'waiting', waitingFor: 'permission' })
    expect(notified).toEqual([])
    oc.emit({ type: 'pending', sessionId: b.agentSessionId!, id: 'frm_1', kind: 'question', open: true })
    expect(notified.map((x) => [x.id, x.waitingFor])).toEqual([[b.id, 'question']])
  })

  it('notifies on reconnect only for real changes', async () => {
    const { core, oc, notified } = await setup()
    const a = await createOpenCode(core)
    const b = await createOpenCode(core)
    oc.snapshots.set(a.agentSessionId!, snap({ pending: [{ id: 'per_1', kind: 'permission' }] }))
    await connect(oc)
    oc.emit({ type: 'disconnected' })
    await connect(oc)
    expect(notified).toEqual([])
    oc.emit({ type: 'disconnected' })
    oc.snapshots.set(b.agentSessionId!, snap({ pending: [{ id: 'frm_1', kind: 'question' }] }))
    await connect(oc)
    expect(notified.map((x) => [x.id, x.waitingFor])).toEqual([[b.id, 'question']])
  })
})

describe('resume', () => {
  let disposeAll = () => {}
  afterEach(() => disposeAll())

  async function setup() {
    const s = setupCore()
    disposeAll = s.disposeAll
    const work = path.join(s.dir, 'docs', 'work', 'a')
    fs.mkdirSync(work, { recursive: true })
    fs.writeFileSync(path.join(work, 'feature.md'), '---\nkind: feature\n---\n# a\n')
    const core = s.make()
    await core.start()
    return { ...s, core }
  }

  it('reopens a gone OpenCode session in a new tmux session, keeping id, label and link', async () => {
    const { core, fake, dir, statePath } = await setup()
    const o = await createOpenCode(core)
    await core.commands.sessionLink({ id: o.id, feature: 'a' })
    await core.commands.sessionRename({ id: o.id, label: 'mine' })
    await core.commands.sessionKill({ id: o.id })
    fake.calls = []
    const res = await core.commands.sessionResume({ id: o.id })
    expect(res).toMatchObject({ ok: true, data: { id: o.id, label: 'mine', feature: 'a', linkPinned: true, lastStatus: 'running', endedAt: null } })
    expect(fake.calls.map((c) => c.method).slice(0, 2)).toEqual(['kill', 'create'])
    expect(fake.calls[0].args[0]).toBe(o.tmuxName)
    const created = fake.calls[1].args[0] as { name: string; cwd: string; argv: string[] }
    expect(created).toMatchObject({ name: o.tmuxName, cwd: dir })
    expect(created.argv[4]).toBe(`exec opencode -s ${o.agentSessionId}`)
    expect(loadState(statePath).sessions[0]).toMatchObject({ lastStatus: 'running', endedAt: null })
  })

  it('refuses unknown, running and terminal sessions', async () => {
    const { core } = await setup()
    const o = await createOpenCode(core)
    const t = await create(core)
    await core.commands.sessionKill({ id: t.id })
    expect(await core.commands.sessionResume({ id: 'x' })).toEqual({ ok: false, error: 'not-found' })
    expect(await core.commands.sessionResume({ id: o.id })).toEqual({ ok: false, error: 'not-gone' })
    expect(await core.commands.sessionResume({ id: t.id })).toEqual({ ok: false, error: 'not-opencode' })
  })

  it('re-syncs status when the service is connected', async () => {
    const { core, oc } = await setup()
    const o = await createOpenCode(core)
    oc.emit({ type: 'connected', version: '2.0.20' })
    await core.commands.sessionKill({ id: o.id })
    oc.snapshotCalls = []
    await core.commands.sessionResume({ id: o.id })
    expect(oc.snapshotCalls).toEqual([[o.agentSessionId]])
  })
})
