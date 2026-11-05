import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitForWorking, waitTurn, type WaitDeps, type WaitTab } from './wait.ts'

const mk = (over: Partial<WaitTab> = {}) => {
  let cur: WaitTab | undefined = { kind: 'claude', alive: true, state: 'idle', ...over }
  const cbs = new Set<() => void>()
  const deps: WaitDeps = { find: async () => cur, onChange: (cb) => void cbs.add(cb) }
  const set = (o: Partial<WaitTab> | undefined) => {
    cur = o && cur && { ...cur, ...o }
    if (!o) cur = undefined
    for (const cb of [...cbs]) cb()
  }
  return { deps, set, cbs }
}
// Lets the checks triggered so far run to their next await.
const tick = () => vi.advanceTimersByTimeAsync(0)

describe('waitTurn', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('returns at once when idle, and for a finished tab', async () => {
    expect(await waitTurn(mk().deps, 's', { expectStart: false, timeoutMs: 1000 })).toEqual({ ok: true, data: { status: 'idle' } })
    const done = mk({ state: 'finished' })
    expect(await waitTurn(done.deps, 's', { expectStart: false, timeoutMs: 1000 })).toEqual({ ok: true, data: { status: 'idle' } })
  })

  it('waits for working to end', async () => {
    const m = mk({ state: 'working' })
    const p = waitTurn(m.deps, 's', { expectStart: false, timeoutMs: 1000 })
    await tick()
    m.set({ state: 'idle' })
    expect(await p).toEqual({ ok: true, data: { status: 'idle' } })
    expect(m.cbs.size).toBe(1) // subscribed; the wait never removes a listener, the core client closes with the command
  })

  it('expectStart: ignores idle until working was seen, then ends on idle', async () => {
    const m = mk()
    const p = waitTurn(m.deps, 's', { expectStart: true, timeoutMs: 100_000 })
    await tick()
    m.set({ state: 'working' })
    await tick()
    m.set({ state: 'needs-you', reason: 'error' })
    expect(await p).toEqual({ ok: true, data: { status: 'idle' } })
  })

  it('expectStart: ends on idle after startWaitMs when no turn begins', async () => {
    const m = mk()
    const p = waitTurn(m.deps, 's', { expectStart: true, timeoutMs: 100_000, startWaitMs: 5000 })
    await vi.advanceTimersByTimeAsync(5000)
    expect(await p).toEqual({ ok: true, data: { status: 'idle' } })
  })

  it('still times out while the tab waits on a permission', async () => {
    const perm = mk({ state: 'needs-you', reason: 'permission' })
    const p = waitTurn(perm.deps, 's', { expectStart: false, timeoutMs: 20 })
    await vi.advanceTimersByTimeAsync(20)
    expect(await p).toEqual({ ok: false, error: 'timeout' })
  })

  it('keeps waiting through a permission or question, then ends idle', async () => {
    const perm = mk({ state: 'needs-you', reason: 'permission' })
    let ended = false
    const pp = waitTurn(perm.deps, 's', { expectStart: false, timeoutMs: 1000 }).then((r) => {
      ended = true
      return r
    })
    await tick()
    expect(ended).toBe(false)
    perm.set({ state: 'working', reason: undefined })
    await tick()
    perm.set({ state: 'needs-you', reason: 'question' })
    await tick()
    expect(ended).toBe(false)
    perm.set({ state: 'idle', reason: undefined })
    expect(await pp).toEqual({ ok: true, data: { status: 'idle' } })
  })

  it('reports gone when the tab stops being alive or disappears', async () => {
    const g = mk({ state: 'working' })
    const pg = waitTurn(g.deps, 's', { expectStart: true, timeoutMs: 1000 })
    await tick()
    g.set({ alive: false })
    expect(await pg).toEqual({ ok: true, data: { status: 'gone' } })
    const r = mk({ state: 'working' })
    const pr = waitTurn(r.deps, 's', { expectStart: false, timeoutMs: 1000 })
    await tick()
    r.set(undefined)
    expect(await pr).toEqual({ ok: true, data: { status: 'gone' } })
  })

  it('times out, also with no state (a disconnected source)', async () => {
    const m = mk({ state: null })
    const p = waitTurn(m.deps, 's', { expectStart: false, timeoutMs: 1000 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(await p).toEqual({ ok: false, error: 'timeout' })
  })

  it('keeps waiting on unknown', async () => {
    const m = mk({ state: 'unknown' })
    const p = waitTurn(m.deps, 's', { expectStart: false, timeoutMs: 1000 })
    await tick()
    m.set({ state: 'idle' })
    expect(await p).toEqual({ ok: true, data: { status: 'idle' } })
  })

  it('refuses a shell tab and an unknown tab', async () => {
    expect(await waitTurn(mk({ kind: 'terminal', state: null }).deps, 's', { expectStart: false, timeoutMs: 1000 })).toEqual({ ok: false, error: 'no-status' })
    const none = mk()
    none.set(undefined)
    expect(await waitTurn(none.deps, 's', { expectStart: false, timeoutMs: 1000 })).toEqual({ ok: false, error: 'not-found' })
  })

  it('sees a change that lands while a check is running', async () => {
    const m = mk({ state: 'working' })
    const p = waitTurn(m.deps, 's', { expectStart: false, timeoutMs: 1000 })
    m.set({ state: 'idle' }) // the first check may already have read working; this change must not be lost
    expect(await p).toEqual({ ok: true, data: { status: 'idle' } })
  })
})

describe('waitForWorking', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('is true once the tab is working', async () => {
    const m = mk({ state: 'idle' })
    const p = waitForWorking(m.deps.find, 's', 5000)
    await vi.advanceTimersByTimeAsync(500)
    m.set({ state: 'working' })
    await vi.advanceTimersByTimeAsync(500)
    expect(await p).toBe(true)
  })

  it('is false after the timeout, and when the tab is gone', async () => {
    const idle = mk({ state: 'idle' })
    const p = waitForWorking(idle.deps.find, 's', 1000)
    await vi.advanceTimersByTimeAsync(1500)
    expect(await p).toBe(false)
    const gone = mk({ alive: false, state: null })
    expect(await waitForWorking(gone.deps.find, 's', 1000)).toBe(false)
  })
})
