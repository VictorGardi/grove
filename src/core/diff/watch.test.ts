import { describe, expect, it, vi } from 'vitest'
import type { SessionDiff } from '@shared/types'
import { createDiffWatch } from './watch'

const diff = (sessionId: string, n = 0): SessionDiff =>
  ({ sessionId, projectId: 'p', state: 'ok', error: null, root: '/r', files: [], truncated: n > 0 })

// A fake `run` whose calls resolve when the test says so.
function fakeRun() {
  const calls: { id: string; resolve: (r: { key: string; diff: SessionDiff }) => void; reject: (e: Error) => void }[] = []
  const run = vi.fn((id: string) => new Promise<{ key: string; diff: SessionDiff }>((resolve, reject) => { calls.push({ id, resolve, reject }) }))
  return { run, calls }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('createDiffWatch', () => {
  it('emits null on target, then the diff', async () => {
    const { run, calls } = fakeRun()
    const onChange = vi.fn()
    const w = createDiffWatch(run, onChange)
    w.target('a')
    expect(onChange.mock.calls).toEqual([[null]])
    calls[0].resolve({ key: 'k1', diff: diff('a') })
    await flush()
    expect(onChange.mock.calls).toEqual([[null], [diff('a')]])
  })

  it('reruns exactly once for pokes during a run', async () => {
    const { run, calls } = fakeRun()
    const w = createDiffWatch(run, () => {})
    w.target('a')
    w.poke()
    w.poke()
    expect(run).toHaveBeenCalledTimes(1)
    calls[0].resolve({ key: 'k1', diff: diff('a') })
    await flush()
    expect(run).toHaveBeenCalledTimes(2)
    calls[1].resolve({ key: 'k1', diff: diff('a') })
    await flush()
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('drops a stale result after a target switch and runs the new target', async () => {
    const { run, calls } = fakeRun()
    const onChange = vi.fn()
    const w = createDiffWatch(run, onChange)
    w.target('a')
    w.target('b')
    calls[0].resolve({ key: 'ka', diff: diff('a') })
    await flush()
    expect(calls.map((c) => c.id)).toEqual(['a', 'b'])
    calls[1].resolve({ key: 'kb', diff: diff('b') })
    await flush()
    expect(onChange.mock.calls).toEqual([[null], [null], [diff('b')]])
  })

  it('emits once for the same key twice', async () => {
    const { run, calls } = fakeRun()
    const onChange = vi.fn()
    const w = createDiffWatch(run, onChange)
    w.target('a')
    calls[0].resolve({ key: 'k', diff: diff('a') })
    await flush()
    w.poke()
    calls[1].resolve({ key: 'k', diff: diff('a') })
    await flush()
    w.poke()
    calls[2].resolve({ key: 'k2', diff: diff('a', 1) })
    await flush()
    expect(onChange.mock.calls).toEqual([[null], [diff('a')], [diff('a', 1)]])
  })

  it('target(null) emits null and stops; a rejected run keeps the loop alive', async () => {
    const { run, calls } = fakeRun()
    const onChange = vi.fn()
    const w = createDiffWatch(run, onChange)
    w.target('a')
    calls[0].reject(new Error('boom'))
    await flush()
    w.poke()
    expect(run).toHaveBeenCalledTimes(2)
    calls[1].resolve({ key: 'k', diff: diff('a') })
    await flush()
    w.target(null)
    w.poke()
    expect(run).toHaveBeenCalledTimes(2)
    expect(onChange.mock.calls).toEqual([[null], [diff('a')], [null]])
  })

  it('emits nothing after dispose', async () => {
    const { run, calls } = fakeRun()
    const onChange = vi.fn()
    const w = createDiffWatch(run, onChange)
    w.target('a')
    w.dispose()
    calls[0].resolve({ key: 'k', diff: diff('a') })
    await flush()
    expect(onChange.mock.calls).toEqual([[null]])
  })
})
