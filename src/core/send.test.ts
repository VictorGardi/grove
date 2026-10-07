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

  describe('gone agent sessions', () => {
    const agent = { ...live, id: 'c', tmuxName: 'grove-c', kind: 'claude' as const, agentSessionId: 'x', lastStatus: 'gone' as const }

    // A fake clock: sleeping advances it; the pane text is a function of the time.
    function clocked(paneAt: (t: number) => string, resume: () => Promise<{ ok: true; data: null } | { ok: false; error: string }> = async () => ({ ok: true, data: null })) {
      const backend = new FakeBackend()
      let t = 0
      const log: string[] = []
      backend.capture = async () => paneAt(t)
      const paste = backend.paste.bind(backend)
      backend.paste = async (name, text, submit) => { log.push(`paste@${t}`); await paste(name, text, submit) }
      const deps = {
        find: (id: string) => [live, gone, agent].find((x) => x.id === id), backend,
        resume: async () => { log.push('resume'); return resume() },
        sleep: async (ms: number) => { t += ms },
        now: () => t,
      }
      return { deps, backend, log, time: () => t }
    }

    it('resumes, waits for 1 s of stable capture, then pastes', async () => {
      const { deps, backend, log } = clocked((t) => (t < 1500 ? 'loading' : t < 2250 ? 'booting' : 'ready'))
      expect(await sendToSession(deps, { id: 'c', text: 'hi' })).toEqual({ ok: true, data: { id: 'c' } })
      expect(log[0]).toBe('resume')
      const at = Number(log[1].split('@')[1])
      expect(at).toBeGreaterThanOrEqual(3250)
      expect(at).toBeLessThan(4000)
      expect(backend.pastes).toEqual([{ name: 'grove-c', text: 'hi', submit: true }])
    })

    it('says not-ready when the pane never settles', async () => {
      const { deps, backend, time } = clocked((t) => String(t))
      expect(await sendToSession(deps, { id: 'c', text: 'hi' })).toEqual({ ok: false, error: 'not-ready' })
      expect(backend.pastes).toEqual([])
      expect(time()).toBeGreaterThanOrEqual(20_000)
      expect(time()).toBeLessThan(21_500)
    })

    it('an empty pane never counts as stable', async () => {
      const { deps } = clocked(() => '')
      expect(await sendToSession(deps, { id: 'c', text: 'hi' })).toEqual({ ok: false, error: 'not-ready' })
    })

    it('returns a resume failure and pastes nothing', async () => {
      const { deps, backend } = clocked(() => 'ready', async () => ({ ok: false, error: 'no-source' }))
      expect(await sendToSession(deps, { id: 'c', text: 'hi' })).toEqual({ ok: false, error: 'no-source' })
      expect(backend.pastes).toEqual([])
    })

    it('a gone terminal stays gone', async () => {
      const { deps, log } = clocked(() => 'ready')
      expect(await sendToSession(deps, { id: 'b', text: 'hi' })).toEqual({ ok: false, error: 'gone' })
      expect(log).toEqual([])
    })
  })
})
