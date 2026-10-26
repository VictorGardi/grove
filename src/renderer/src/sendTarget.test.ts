import { describe, expect, it } from 'vitest'
import type { Project, Session } from '@shared/types'
import { defaultKind, resolveTarget } from './sendTarget'

const projects = [
  { id: 'p', name: 'grove', path: '/src/p' },
  { id: 'wt', name: 'grove · a', path: '/src/wt', worktreeOf: 'p' },
  { id: 'o', name: 'other', path: '/src/o' },
] as Project[]
const feature = { projectId: 'p', slug: 'f' }

const session = (id: string, over: Partial<Session> = {}): Session => ({
  id, projectId: 'p', kind: 'claude', label: id, feature: 'f', lastStatus: 'running', agentSessionId: null,
  startedAt: '2026-10-01T10:00:00.000Z', lastFocusedAt: null, ...over,
} as Session)

const ids = (ss: Session[]) => ss.map((s) => s.id)

describe('resolveTarget', () => {
  it('sends to the one linked session', () => {
    const t = resolveTarget(feature, [session('a')], projects)
    expect(t.kind).toBe('one')
    expect(t.default?.id).toBe('a')
  })

  it('defaults to the most recently focused of several, falling back to when each started', () => {
    const sessions = [
      session('old', { startedAt: '2026-10-01T10:00:00.000Z' }),
      session('new', { startedAt: '2026-10-03T10:00:00.000Z' }),
      session('focused', { startedAt: '2026-09-01T10:00:00.000Z', lastFocusedAt: '2026-10-04T10:00:00.000Z' }),
    ]
    const t = resolveTarget(feature, sessions, projects)
    expect(t.kind).toBe('many')
    expect(t.default?.id).toBe('focused')
    expect(ids(t.candidates)).toEqual(['focused', 'new', 'old'])
  })

  it('includes a gone session it can resume, never a terminal, an unresumable gone one or a failed start', () => {
    const sessions = [
      session('resumable', { lastStatus: 'gone', agentSessionId: 'x' }),
      session('lost', { lastStatus: 'gone' }),
      session('shell', { kind: 'terminal' }),
      session('failed', { startup: { phase: 'failed', reason: 'boom' } }),
      session('live'),
    ]
    expect(ids(resolveTarget(feature, sessions, projects).candidates).sort()).toEqual(['live', 'resumable'])
  })

  it('never offers a session still being made: it cannot take a paste yet', () => {
    const sessions = [
      session('starting', { startup: { phase: 'starting', since: '2026-10-26T10:00:00.000Z' } }),
      session('live'),
    ]
    expect(ids(resolveTarget(feature, sessions, projects).candidates)).toEqual(['live'])
    expect(resolveTarget(feature, [sessions[0]], projects).kind).toBe('none')
  })

  it('starts a session when none can take it', () => {
    expect(resolveTarget(feature, [], projects)).toEqual({ kind: 'none', default: null, candidates: [] })
    const t = resolveTarget(feature, [session('lost', { lastStatus: 'gone' }), session('shell', { kind: 'terminal' })], projects)
    expect(t.kind).toBe('none')
    expect(t.default).toBeNull()
  })

  it('takes sessions in any checkout of the repo, not another slug or another repo', () => {
    const sessions = [session('wt', { projectId: 'wt' }), session('slug', { feature: 'g' }), session('repo', { projectId: 'o' }), session('none', { feature: null })]
    expect(ids(resolveTarget(feature, sessions, projects).candidates)).toEqual(['wt'])
  })
})

describe('defaultKind', () => {
  it("is the kind of the repo's most recent agent session, never a terminal", () => {
    const sessions = [
      session('a', { kind: 'claude', startedAt: '2026-10-01T10:00:00.000Z' }),
      session('b', { kind: 'opencode', projectId: 'wt', startedAt: '2026-10-02T10:00:00.000Z' }),
      session('c', { kind: 'terminal', startedAt: '2026-10-03T10:00:00.000Z' }),
    ]
    expect(defaultKind(sessions, projects, 'p')).toBe('opencode')
    expect(defaultKind([], projects, 'p')).toBe('claude')
  })
})
