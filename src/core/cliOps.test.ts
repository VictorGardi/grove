import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project, Session } from '@shared/types'
import { paneStable, resolveProject, resolveSessionRef, waitTurn } from './cliOps'
import { newSession } from './sessions'

const NOW = new Date('2026-10-07T10:00:00Z')
const sess = (id: string, label = id) => ({ ...newSession({ projectId: 'p', kind: 'terminal', now: NOW, id, agentSessionId: null }), label })

describe('resolveSessionRef', () => {
  const list = [sess('abcd1111', 'one'), sess('abcd2222', 'two'), sess('ffff3333', 'dup'), sess('eeee4444', 'dup')]

  it('matches a full id, a unique prefix and an exact label', () => {
    expect(resolveSessionRef(list, 'abcd1111')).toMatchObject({ ok: true, data: { id: 'abcd1111' } })
    expect(resolveSessionRef(list, 'abcd2')).toMatchObject({ ok: true, data: { id: 'abcd2222' } })
    expect(resolveSessionRef(list, 'one')).toMatchObject({ ok: true, data: { id: 'abcd1111' } })
  })

  it('does not match a prefix shorter than 4', () => {
    expect(resolveSessionRef(list, 'abc')).toEqual({ ok: false, error: 'not-found' })
  })

  it('reports ambiguous prefixes and labels, and unknown refs', () => {
    expect(resolveSessionRef(list, 'abcd')).toEqual({ ok: false, error: 'ambiguous' })
    expect(resolveSessionRef(list, 'dup')).toEqual({ ok: false, error: 'ambiguous' })
    expect(resolveSessionRef(list, 'nope')).toEqual({ ok: false, error: 'not-found' })
  })

  it('prefers an id match over a label', () => {
    const l = [sess('wxyz1111', 'x'), sess('other111', 'wxyz1111')]
    expect(resolveSessionRef(l, 'wxyz1111')).toMatchObject({ ok: true, data: { id: 'wxyz1111' } })
  })
})

describe('resolveProject', () => {
  const proj = (id: string, p: string): Project => ({ id, name: id, path: p })
  const projects = [proj('a', '/zz/repo'), proj('b', '/zz/repo/packages/x')]
  const noGit = async () => null

  it('picks the longest containing project, for a subfolder too', async () => {
    expect(await resolveProject(projects, '/zz/repo/packages/x/src', noGit)).toMatchObject({ project: { id: 'b' }, added: false })
    expect(await resolveProject(projects, '/zz/repo/docs', noGit)).toMatchObject({ project: { id: 'a' }, added: false })
  })

  it('does not treat a sibling with a shared name prefix as contained', async () => {
    const r = await resolveProject(projects, '/zz/repo2', noGit)
    expect(r.added).toBe(true)
  })

  it('registers the git top level when no project contains the folder', async () => {
    const r = await resolveProject(projects, '/yy/other/sub', async () => '/yy/other')
    expect(r).toMatchObject({ added: true, project: { name: 'other', path: '/yy/other' } })
  })

  it('registers the folder itself outside git', async () => {
    const r = await resolveProject([], '/yy/plain', noGit)
    expect(r).toMatchObject({ added: true, project: { name: 'plain', path: '/yy/plain' } })
  })
})

describe('paneStable', () => {
  const sleep = async () => {}

  it('is true once two captures match', async () => {
    const caps = ['a', 'ab', 'abc', 'abc']
    expect(await paneStable(async () => caps.shift() ?? 'abc', { intervalMs: 10, timeoutMs: 1000, sleep })).toBe(true)
  })

  it('gives up after the timeout', async () => {
    let n = 0
    expect(await paneStable(async () => String(n++), { intervalMs: 10, timeoutMs: 50, sleep })).toBe(false)
  })
})

describe('waitTurn', () => {
  const mk = (over: Partial<Session> = {}) => {
    let cur: Session | undefined = { ...newSession({ projectId: 'p', kind: 'opencode', now: NOW, id: 's', agentSessionId: 'a' }), status: 'idle', ...over }
    const cbs = new Set<() => void>()
    const deps = { find: () => cur, onSessions: (cb: () => void) => (cbs.add(cb), () => void cbs.delete(cb)) }
    const set = (o: Partial<Session> | undefined) => { cur = o && cur && { ...cur, ...o }; if (!o) cur = undefined; for (const cb of [...cbs]) cb() }
    return { deps, set, cbs }
  }
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('returns at once when idle, and for a finished-unseen turn', async () => {
    expect(await waitTurn(mk().deps, 's', { expectStart: false, timeoutMs: 1000 })).toEqual({ ok: true, data: { status: 'idle', waitingFor: null } })
    const done = mk({ status: 'waiting', waitingFor: 'done' })
    expect(await waitTurn(done.deps, 's', { expectStart: false, timeoutMs: 1000 })).toMatchObject({ ok: true, data: { status: 'idle' } })
  })

  it('waits for working to end', async () => {
    const m = mk({ status: 'working' })
    const p = waitTurn(m.deps, 's', { expectStart: false, timeoutMs: 1000 })
    m.set({ status: 'idle' })
    expect(await p).toMatchObject({ ok: true, data: { status: 'idle' } })
    expect(m.cbs.size).toBe(0)
  })

  it('expectStart: ignores idle until working was seen, then ends on idle', async () => {
    const m = mk()
    const p = waitTurn(m.deps, 's', { expectStart: true, timeoutMs: 100_000 })
    m.set({ status: 'idle' })
    m.set({ status: 'working' })
    m.set({ status: 'waiting', waitingFor: 'done' })
    expect(await p).toMatchObject({ ok: true, data: { status: 'idle' } })
  })

  it('expectStart: resolves with the current state after startWaitMs when no turn begins', async () => {
    const m = mk()
    const p = waitTurn(m.deps, 's', { expectStart: true, timeoutMs: 100_000, startWaitMs: 5000 })
    await vi.advanceTimersByTimeAsync(5000)
    expect(await p).toMatchObject({ ok: true, data: { status: 'idle' } })
  })

  it('reports permission and question as waiting, and a gone or removed session as gone', async () => {
    const perm = mk({ status: 'waiting', waitingFor: 'permission' })
    expect(await waitTurn(perm.deps, 's', { expectStart: false, timeoutMs: 1000 })).toEqual({ ok: true, data: { status: 'waiting', waitingFor: 'permission' } })
    const q = mk({ status: 'working' })
    const p = waitTurn(q.deps, 's', { expectStart: false, timeoutMs: 1000 })
    q.set({ status: 'waiting', waitingFor: 'question' })
    expect(await p).toMatchObject({ data: { status: 'waiting', waitingFor: 'question' } })
    const g = mk({ status: 'working' })
    const pg = waitTurn(g.deps, 's', { expectStart: true, timeoutMs: 1000 })
    g.set({ lastStatus: 'gone', status: undefined })
    expect(await pg).toMatchObject({ data: { status: 'gone' } })
    const r = mk({ status: 'working' })
    const pr = waitTurn(r.deps, 's', { expectStart: false, timeoutMs: 1000 })
    r.set(undefined)
    expect(await pr).toMatchObject({ data: { status: 'gone' } })
  })

  it('times out, also with no status (a disconnected source)', async () => {
    const m = mk({ status: undefined })
    const p = waitTurn(m.deps, 's', { expectStart: false, timeoutMs: 1000 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(await p).toEqual({ ok: false, error: 'timeout' })
    expect(m.cbs.size).toBe(0)
  })

  it('refuses a terminal and an unknown session', async () => {
    const t = mk({ kind: 'terminal' })
    expect(await waitTurn(t.deps, 's', { expectStart: false, timeoutMs: 1000 })).toEqual({ ok: false, error: 'no-status' })
    const none = mk()
    none.set(undefined)
    expect(await waitTurn(none.deps, 's', { expectStart: false, timeoutMs: 1000 })).toEqual({ ok: false, error: 'not-found' })
  })
})
