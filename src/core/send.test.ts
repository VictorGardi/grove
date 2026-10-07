import { describe, expect, it } from 'vitest'
import { FakeBackend } from './testing/fakeBackend'
import { newSession } from './sessions'
import { sendToSession } from './send'

const NOW = new Date('2026-10-07T10:00:00.000Z')
const live = newSession({ projectId: 'p', kind: 'terminal', now: NOW, id: 'a', agentSessionId: null })
const gone = { ...live, id: 'b', tmuxName: 'grove-b', lastStatus: 'gone' as const }

function setup() {
  const backend = new FakeBackend()
  const find = (id: string) => [live, gone].find((s) => s.id === id)
  return { backend, deps: { find, backend } }
}

describe('sendToSession', () => {
  it('refuses an unknown session', async () => {
    const { deps } = setup()
    expect(await sendToSession(deps, { id: 'zz', text: 'x' })).toEqual({ ok: false, error: 'not-found' })
  })

  it('refuses a gone session', async () => {
    const { deps, backend } = setup()
    expect(await sendToSession(deps, { id: 'b', text: 'x' })).toEqual({ ok: false, error: 'gone' })
    expect(backend.pastes).toEqual([])
  })

  it('pastes into a live session and submits', async () => {
    const { deps, backend } = setup()
    expect(await sendToSession(deps, { id: 'a', text: 'hello\nthere' })).toEqual({ ok: true, data: { id: 'a' } })
    expect(backend.pastes).toEqual([{ name: 'grove-a', text: 'hello\nthere', submit: true }])
  })

  it('reports a backend failure', async () => {
    const { deps, backend } = setup()
    backend.paste = async () => { throw new Error('no server running') }
    expect(await sendToSession(deps, { id: 'a', text: 'x' })).toEqual({ ok: false, error: 'no server running' })
  })
})
