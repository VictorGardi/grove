import { describe, expect, it } from 'vitest'
import { FakeBackend } from './testing/fakeBackend'
import { newSession } from './sessions'
import { dictate } from './dictate'

const NOW = new Date('2026-11-02T10:00:00.000Z')
const live = newSession({ projectId: 'p', kind: 'terminal', now: NOW, id: 'a', agentSessionId: null })
const gone = { ...live, id: 'b', tmuxName: 'grove-b', lastStatus: 'gone' as const }

function setup() {
  const backend = new FakeBackend()
  const find = (id: string) => [live, gone].find((s) => s.id === id)
  return { backend, deps: { find, backend } }
}

describe('dictate', () => {
  it('refuses an unknown session', async () => {
    const { deps } = setup()
    expect(await dictate(deps, { id: 'zz', text: 'x' })).toEqual({ ok: false, error: 'not-found' })
  })

  it('refuses a gone session and pastes nothing', async () => {
    const { deps, backend } = setup()
    expect(await dictate(deps, { id: 'b', text: 'x' })).toEqual({ ok: false, error: 'gone' })
    expect(backend.pastes).toEqual([])
  })

  it('pastes into a live session without submitting', async () => {
    const { deps, backend } = setup()
    expect(await dictate(deps, { id: 'a', text: 'hello there' })).toEqual({ ok: true, data: { id: 'a' } })
    expect(backend.pastes).toEqual([{ name: 'grove-a', text: 'hello there ', submit: false }])
  })

  it('reports a backend failure', async () => {
    const { deps, backend } = setup()
    backend.paste = async () => { throw new Error('no server running') }
    expect(await dictate(deps, { id: 'a', text: 'x' })).toEqual({ ok: false, error: 'no server running' })
  })

  it('sanitizes text: control characters, whitespace and length', async () => {
    const { deps, backend } = setup()
    await dictate(deps, { id: 'a', text: 'ls\r\n\x1b[31m  -la\x7f\tnow' })
    expect(backend.pastes[0].text).toBe('ls [31m -la now ')
    await dictate(deps, { id: 'a', text: 'x'.repeat(5000) })
    expect(backend.pastes[1].text.length).toBe(4001)
  })

  it('strips C1 controls', async () => {
    const { deps, backend } = setup()
    await dictate(deps, { id: 'a', text: 'a\u009b31mb\u009dc\u0085d' })
    expect(backend.pastes[0].text).toBe('a 31mb c d ')
  })

  it('never splits a surrogate pair at the cap', async () => {
    const { deps, backend } = setup()
    await dictate(deps, { id: 'a', text: 'x'.repeat(3999) + '😀' + 'y' })
    const t = backend.pastes[0].text
    expect(t).toBe('x'.repeat(3999) + '😀 ')
    expect(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(t)).toBe(false)
  })

  it('ends the paste with a single trailing space', async () => {
    const { deps, backend } = setup()
    await dictate(deps, { id: 'a', text: '  one two  ' })
    expect(backend.pastes[0]).toEqual({ name: 'grove-a', text: 'one two ', submit: false })
  })

  it('rejects empty, control-only and non-string text without pasting', async () => {
    const { deps, backend } = setup()
    for (const text of ['', ' \r\n\x1b ', 42 as unknown as string]) {
      expect((await dictate(deps, { id: 'a', text })).ok).toBe(false)
    }
    expect(backend.pastes).toEqual([])
  })

  it('maps a paste failure to gone or not-found when the session vanished meanwhile', async () => {
    const backend = new FakeBackend()
    let session: typeof live | undefined = live
    backend.paste = async () => { session = { ...live, lastStatus: 'gone' }; throw new Error('can\'t find session') }
    const deps = { find: () => session, backend }
    expect(await dictate(deps, { id: 'a', text: 'x' })).toEqual({ ok: false, error: 'gone' })
    session = live
    backend.paste = async () => { session = undefined; throw new Error('boom') }
    expect(await dictate(deps, { id: 'a', text: 'x' })).toEqual({ ok: false, error: 'not-found' })
  })
})
