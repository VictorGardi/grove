import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Session } from '@shared/types'
import { createCore, type Core } from './core'
import { makeLabel, newSession, reconcile } from './sessions'
import { loadState } from './store/stateStore'
import { saveConfig } from './store/configStore'
import { FakeBackend } from './testing/fakeBackend'

const NOW = new Date('2026-10-05T10:00:00.000Z')
const LATER = new Date('2026-10-05T11:00:00.000Z')

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
  const cores: Core[] = []
  afterEach(() => { for (const c of cores.splice(0)) c.dispose() })

  function setup() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-'))
    const configPath = path.join(dir, 'config.json')
    const statePath = path.join(dir, 'state.json')
    saveConfig(configPath, { schemaVersion: 1, projects: [{ id: 'p', name: 'proj', path: dir }] })
    const fake = new FakeBackend()
    const make = (now = NOW) => {
      const core = createCore({ configPath, statePath, backend: fake, now: () => now })
      cores.push(core)
      return core
    }
    return { fake, make, statePath }
  }

  async function create(core: Core) {
    const res = await core.commands.sessionCreate({ projectId: 'p', kind: 'terminal', cols: 80, rows: 24 })
    if (!res.ok) throw new Error(res.error)
    return res.data
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

  it('persists ui changes', async () => {
    const { make, statePath } = setup()
    const a = make()
    await a.start()
    const res = await a.commands.uiSet({ focusedSessionId: 'x' })
    expect(res).toEqual({ ok: true, data: { sidebarWidth: 260, focusedSessionId: 'x' } })
    expect(loadState(statePath).ui.focusedSessionId).toBe('x')
  })
})
