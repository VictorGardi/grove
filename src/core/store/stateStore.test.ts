import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_UI, type StateFile } from '@shared/types'
import { newSession } from '../sessions'
import { loadState, saveState } from './stateStore'

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-')), 'state.json')

describe('stateStore', () => {
  it('returns an empty state for a missing file', () => {
    expect(loadState(tmpFile())).toEqual({ schemaVersion: 2, sessions: [], ui: DEFAULT_UI })
  })

  it.each([['bad JSON', '{'], ['unknown schemaVersion', '{"schemaVersion":9}']])(
    'moves a file with %s aside',
    (_, content) => {
      const file = tmpFile()
      fs.writeFileSync(file, content)
      const onBad = vi.fn()
      expect(loadState(file, onBad)).toEqual({ schemaVersion: 2, sessions: [], ui: DEFAULT_UI })
      expect(onBad).toHaveBeenCalledTimes(1)
      expect(fs.readdirSync(path.dirname(file))).toEqual([expect.stringMatching(/^state\.json\.bad-\d+$/)])
    }
  )

  it('round-trips', () => {
    const file = tmpFile()
    const s: StateFile = {
      schemaVersion: 2,
      sessions: [newSession({ projectId: 'p', kind: 'terminal', now: new Date(), id: 'a', agentSessionId: null })],
      ui: { sidebarWidth: 300, focusedSessionId: null, focusedFeature: null, focusedProject: 'p', sidebarTab: 'projects', board: 'sessions', collapsed: ['p:x'],
        viewer: { projectId: 'p', slug: 'f', path: '03-design.html', hash: 'q1' }, viewerWidth: 600, viewerExpanded: true },
    }
    saveState(file, s)
    expect(loadState(file)).toEqual(s)
  })

  it('migrates a v1 file: opencodeSessionId becomes agentSessionId, and it saves as v2', () => {
    const file = tmpFile()
    const v1 = (id: string, kind: string, opencodeSessionId: string | null) => {
      const { agentSessionId: _a, ...rest } = newSession({ projectId: 'p', kind: 'terminal', now: new Date(), id, agentSessionId: null })
      return { ...rest, kind, opencodeSessionId }
    }
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, sessions: [v1('a', 'opencode', 'ses_x'), v1('b', 'terminal', null)], ui: DEFAULT_UI }))
    const s = loadState(file)
    expect(s.schemaVersion).toBe(2)
    expect(s.sessions.map((x) => x.agentSessionId)).toEqual(['ses_x', null])
    expect(s.sessions.every((x) => !('opencodeSessionId' in x))).toBe(true)
    saveState(file, s)
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).schemaVersion).toBe(2)
  })

  it('loads a session saved before seenAt with seenAt null, and keeps a set one', () => {
    const file = tmpFile()
    const { seenAt: _seenAt, ...old } = newSession({ projectId: 'p', kind: 'opencode', now: new Date(), id: 'a', agentSessionId: 'ses_a' })
    const seen = { ...newSession({ projectId: 'p', kind: 'opencode', now: new Date(), id: 'b', agentSessionId: 'ses_b' }), seenAt: '2026-10-05T10:00:00.000Z' }
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, sessions: [old, seen], ui: DEFAULT_UI }))
    expect(loadState(file).sessions.map((s) => s.seenAt)).toEqual([null, '2026-10-05T10:00:00.000Z'])
  })

  it('fills in a missing ui field', () => {
    const file = tmpFile()
    fs.writeFileSync(file, '{"schemaVersion":1,"sessions":[]}')
    expect(loadState(file).ui).toEqual(DEFAULT_UI)
  })

  it('loads an old ui without view and collapsed with defaults', () => {
    const file = tmpFile()
    fs.writeFileSync(file, '{"schemaVersion":1,"sessions":[],"ui":{"sidebarWidth":300,"focusedSessionId":null}}')
    expect(loadState(file).ui).toEqual({ ...DEFAULT_UI, sidebarWidth: 300 })
  })

  it('loads an old ui without sidebarTab on the sessions tab', () => {
    const file = tmpFile()
    fs.writeFileSync(file, '{"schemaVersion":1,"sessions":[],"ui":{"sidebarWidth":230,"focusedSessionId":null,"view":"board","collapsed":[]}}')
    expect(loadState(file).ui.sidebarTab).toBe('sessions')
  })

  it('drops a saved view and reads the old features tab as projects', () => {
    const file = tmpFile()
    fs.writeFileSync(file, '{"schemaVersion":1,"sessions":[],"ui":{"sidebarWidth":230,"focusedSessionId":null,"view":"board","sidebarTab":"features","collapsed":[]}}')
    const { ui } = loadState(file)
    expect(ui).not.toHaveProperty('view')
    expect(ui.sidebarTab).toBe('projects')
    expect(ui.board).toBe('features')
  })

  it('loads an old ui without viewer layout keys with the defaults', () => {
    const file = tmpFile()
    fs.writeFileSync(file, '{"schemaVersion":1,"sessions":[],"ui":{"sidebarWidth":230,"focusedSessionId":null,"viewer":null}}')
    const { ui } = loadState(file)
    expect(ui.viewerWidth).toBe(480)
    expect(ui.viewerExpanded).toBe(false)
  })
})
