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
    expect(loadState(tmpFile())).toEqual({ schemaVersion: 8, sessions: [], ui: DEFAULT_UI })
  })

  it.each([['bad JSON', '{'], ['unknown schemaVersion', '{"schemaVersion":9}']])(
    'moves a file with %s aside',
    (_, content) => {
      const file = tmpFile()
      fs.writeFileSync(file, content)
      const onBad = vi.fn()
      expect(loadState(file, onBad)).toEqual({ schemaVersion: 8, sessions: [], ui: DEFAULT_UI })
      expect(onBad).toHaveBeenCalledTimes(1)
      expect(fs.readdirSync(path.dirname(file))).toEqual([expect.stringMatching(/^state\.json\.bad-\d+$/)])
    }
  )

  it('round-trips', () => {
    const file = tmpFile()
    const s: StateFile = {
      schemaVersion: 8,
      sessions: [newSession({ projectId: 'p', kind: 'terminal', now: new Date(), id: 'a', agentSessionId: null })],
      ui: { sidebarWidth: 300, sidebarCollapsed: true, focusedSessionId: null, focusedFeature: null, focusedProject: 'p', sidebarTab: 'projects', board: 'sessions', collapsed: ['p:x'],
        viewer: { kind: 'file', projectId: 'p', path: 'docs/work/f/03-design.html', hash: 'q1', fromDiff: 'a' }, viewerWidth: 600, viewerExpanded: true, grid: { open: true, members: ['a'] }, hiddenProjects: [], groupBy: 'project', sessionSort: 'none' },
    }
    saveState(file, s)
    expect(loadState(file)).toEqual(s)
  })

  it('drops grid members of unknown sessions, and closes an emptied grid', () => {
    const file = tmpFile()
    const known = newSession({ projectId: 'p', kind: 'terminal', now: new Date(), id: 'a', agentSessionId: null })
    saveState(file, { schemaVersion: 8, sessions: [known], ui: { ...DEFAULT_UI, grid: { open: true, members: ['a', 'gone'] } } })
    expect(loadState(file).ui.grid).toEqual({ open: true, members: ['a'] })
    saveState(file, { schemaVersion: 8, sessions: [], ui: { ...DEFAULT_UI, grid: { open: true, members: ['gone'] } } })
    expect(loadState(file).ui.grid).toEqual({ open: false, members: [] })
  })

  it('loads a file saved before the grid with the default grid', () => {
    const file = tmpFile()
    const { grid: _grid, ...old } = DEFAULT_UI
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 7, sessions: [], ui: old }))
    expect(loadState(file).ui.grid).toEqual({ open: false, members: [] })
  })

  it('migrates a v1 file: opencodeSessionId becomes agentSessionId, and it saves as v8', () => {
    const file = tmpFile()
    const v1 = (id: string, kind: string, opencodeSessionId: string | null) => {
      const { agentSessionId: _a, ...rest } = newSession({ projectId: 'p', kind: 'terminal', now: new Date(), id, agentSessionId: null })
      return { ...rest, kind, opencodeSessionId }
    }
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, sessions: [v1('a', 'opencode', 'ses_x'), v1('b', 'terminal', null)], ui: DEFAULT_UI }))
    const s = loadState(file)
    expect(s.schemaVersion).toBe(8)
    expect(s.sessions.map((x) => x.agentSessionId)).toEqual(['ses_x', null])
    expect(s.sessions.every((x) => !('opencodeSessionId' in x))).toBe(true)
    saveState(file, s)
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).schemaVersion).toBe(8)
  })

  it('migrates a v3 file: every session gets cwd null', () => {
    const file = tmpFile()
    const { cwd: _c, ...old } = newSession({ projectId: 'p', kind: 'terminal', now: new Date(), id: 'a', agentSessionId: null })
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 3, sessions: [old], ui: DEFAULT_UI }))
    const s = loadState(file)
    expect(s.schemaVersion).toBe(8)
    expect(s.sessions[0].cwd).toBeNull()
  })

  it('migrates a v4 file: every session gets lastContext null', () => {
    const file = tmpFile()
    const { lastContext: _l, ...old } = newSession({ projectId: 'p', kind: 'claude', now: new Date(), id: 'a', agentSessionId: 'u' })
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 4, sessions: [old], ui: DEFAULT_UI }))
    const s = loadState(file)
    expect(s.schemaVersion).toBe(8)
    expect(s.sessions[0].lastContext).toBeNull()
  })

  it('closes a saved slug-keyed viewer (v2 or v5): the artifact target is gone', () => {
    const file = tmpFile()
    const viewer = { projectId: 'p', slug: 'f', path: '03-design.html', hash: null }
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 2, sessions: [], ui: { ...DEFAULT_UI, viewer } }))
    const s = loadState(file)
    expect(s.schemaVersion).toBe(8)
    expect(s.ui.viewer).toBeNull()
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 5, sessions: [], ui: { ...DEFAULT_UI, viewer: { kind: 'artifact', ...viewer, fromDiff: null } } }))
    expect(loadState(file).ui.viewer).toBeNull()
  })

  it('keeps a saved file viewer through the v5 migration', () => {
    const file = tmpFile()
    const viewer = { kind: 'file', projectId: 'p', path: 'CONTEXT.md', hash: null, fromDiff: null }
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 5, sessions: [], ui: { ...DEFAULT_UI, viewer } }))
    expect(loadState(file).ui.viewer).toEqual(viewer)
  })

  it("drops a diff viewer, or a doc's fromDiff, whose session isn't saved", () => {
    const file = tmpFile()
    const sessions = [newSession({ projectId: 'p', kind: 'terminal', now: new Date(), id: 'a', agentSessionId: null })]
    const save = (viewer: unknown) => fs.writeFileSync(file, JSON.stringify({ schemaVersion: 7, sessions, ui: { ...DEFAULT_UI, viewer } }))
    save({ kind: 'diff', sessionId: 'gone' })
    expect(loadState(file).ui.viewer).toBeNull()
    save({ kind: 'diff', sessionId: 'a' })
    expect(loadState(file).ui.viewer).toEqual({ kind: 'diff', sessionId: 'a' })
    const doc = { kind: 'file', projectId: 'p', path: 'x.md', hash: null, fromDiff: 'gone' }
    save(doc)
    expect(loadState(file).ui.viewer).toEqual({ ...doc, fromDiff: null })
  })

  it('migrates a v2 file without a viewer', () => {
    const file = tmpFile()
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 2, sessions: [], ui: DEFAULT_UI }))
    expect(loadState(file).ui.viewer).toBeNull()
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
    expect(ui.board).toBe('sessions')
  })

  it('loads an old ui without viewer layout keys with the defaults', () => {
    const file = tmpFile()
    fs.writeFileSync(file, '{"schemaVersion":1,"sessions":[],"ui":{"sidebarWidth":230,"focusedSessionId":null,"viewer":null}}')
    const { ui } = loadState(file)
    expect(ui.viewerWidth).toBeNull()
    expect(ui.viewerExpanded).toBe(false)
  })

  it('migrates the old default viewer width to responsive sizing and keeps resized widths', () => {
    const file = tmpFile()
    const saveV6 = (viewerWidth: number) => fs.writeFileSync(file, JSON.stringify({ schemaVersion: 6, sessions: [], ui: { ...DEFAULT_UI, viewerWidth } }))
    saveV6(480)
    expect(loadState(file).ui.viewerWidth).toBeNull()
    saveV6(620)
    expect(loadState(file).ui.viewerWidth).toBe(620)
  })

  it('migrates a v7 file: every session gets workflowStatus in-progress', () => {
    const file = tmpFile()
    const { workflowStatus: _w, ...old } = newSession({ projectId: 'p', kind: 'claude', now: new Date(), id: 'a', agentSessionId: 'u' })
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 7, sessions: [old], ui: DEFAULT_UI }))
    const s = loadState(file)
    expect(s.schemaVersion).toBe(8)
    expect(s.sessions[0].workflowStatus).toBe('in-progress')
  })

  it('keeps a workflowStatus that is already saved', () => {
    const file = tmpFile()
    const s = newSession({ projectId: 'p', kind: 'terminal', now: new Date(), id: 'a', agentSessionId: null })
    saveState(file, { schemaVersion: 8, sessions: [{ ...s, workflowStatus: 'blocked' }], ui: DEFAULT_UI })
    expect(loadState(file).sessions[0].workflowStatus).toBe('blocked')
  })
})
