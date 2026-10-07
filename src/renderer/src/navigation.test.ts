import { describe, expect, it } from 'vitest'
import { DEFAULT_UI, type Feature, type Project, type Session, type UiState } from '@shared/types'
import { boardKey, boardProject, childrenOf, content, crumbs, currentProjectId, focusTarget } from './navigation'

const project = (id: string): Project => ({ id, name: id.toUpperCase(), path: '/' + id })

function feature(slug: string, over: Partial<Feature> = {}): Feature {
  return {
    projectId: 'p', slug, path: '/p/' + slug, title: 'T' + slug, kind: 'feature', group: false,
    parent: null, flow: null, stages: [], currentStage: 'questions', cardState: 'ready', progress: null, flags: [], warnings: [], artifacts: [], ...over,
  }
}

function session(id: string, over: Partial<Session> = {}): Session {
  return {
    id, projectId: 'p', kind: 'terminal', label: 'L' + id, labelPinned: false, tmuxName: 'grove-' + id,
    cwd: null, agentSessionId: null, feature: null, linkPinned: false, action: null,
    startedAt: '2026-10-05T10:00:00.000Z', endedAt: null, lastStatus: 'running', seenAt: null, ...over,
  }
}

const ui = (over: Partial<UiState> = {}): UiState => ({ ...DEFAULT_UI, ...over })
const projects = [project('p'), project('q')]
const features = [feature('e', { group: true }), feature('a', { parent: 'e' }), feature('z', { projectId: 'q' })]
const sessions = [session('s', { feature: 'a' }), session('t', { projectId: 'q' })]

describe('content', () => {
  const at = (u: Partial<UiState>) => content(ui(u), projects, sessions, features)

  it('shows the focused session, feature or project', () => {
    expect(at({ focusedSessionId: 's' })).toEqual({ kind: 'session', session: sessions[0] })
    expect(at({ focusedFeature: { projectId: 'p', slug: 'a' } })).toEqual({ kind: 'feature', feature: features[1] })
    expect(at({ focusedProject: 'q' })).toEqual({ kind: 'project', project: projects[1] })
  })

  it('shows the grid while it is on and the focused session is a member', () => {
    const grid = { open: true, members: ['s', 'gone', 't'] }
    expect(at({ grid, focusedSessionId: 't' })).toEqual({ kind: 'grid', sessions: [sessions[0], sessions[1]], focused: sessions[1] })
    expect(at({ grid: { ...grid, open: false }, focusedSessionId: 't' }).kind).toBe('session')
    expect(at({ grid, focusedSessionId: null }).kind).toBe('project')
    expect(at({ grid: { open: true, members: ['s'] }, focusedSessionId: 't' }).kind).toBe('session')
  })

  it("falls back to the first project's page with nothing focused", () => {
    expect(at({})).toEqual({ kind: 'project', project: projects[0] })
    expect(at({ focusedSessionId: 'gone' })).toEqual({ kind: 'project', project: projects[0] })
    expect(content(ui(), [], [], [])).toEqual({ kind: 'none' })
  })

  it("falls back to a missing feature's project page", () => {
    expect(at({ focusedFeature: { projectId: 'q', slug: 'missing' } })).toEqual({ kind: 'project', project: projects[1] })
  })
})

describe('crumbs', () => {
  const of = (u: Partial<UiState>) => crumbs(content(ui(u), projects, sessions, features), projects, features)

  it('is the project alone on its page', () => {
    expect(of({ focusedProject: 'p' })).toEqual([{ label: 'P' }])
  })

  it('is just "Session grid" on the grid', () => {
    expect(of({ grid: { open: true, members: ['s'] }, focusedSessionId: 's' })).toEqual([{ label: 'Session grid' }])
  })

  it('goes project › parent › feature, each up-link clickable', () => {
    expect(of({ focusedFeature: { projectId: 'p', slug: 'a' } })).toEqual([
      { label: 'P', to: { focusedProject: 'p', board: 'sessions' } },
      { label: 'Te', to: { focusedFeature: { projectId: 'p', slug: 'e' } } },
      { label: 'Ta' },
    ])
  })

  it('goes project › linked feature › session, or project › session', () => {
    expect(of({ focusedSessionId: 's' })).toEqual([
      { label: 'P', to: { focusedProject: 'p', board: 'sessions' } },
      { label: 'Ta', to: { focusedFeature: { projectId: 'p', slug: 'a' } } },
      { label: 'Ls' },
    ])
    expect(of({ focusedSessionId: 't' })).toEqual([{ label: 'Q', to: { focusedProject: 'q', board: 'sessions' } }, { label: 'Lt' }])
  })

  it('is empty with nothing to show', () => {
    expect(crumbs({ kind: 'none' }, [], [])).toEqual([])
  })
})

describe('boardProject', () => {
  const of = (u: Partial<UiState>) => boardProject(ui(u), projects, sessions, features)

  it("opens the focused session's or feature's project, else the focused or first project", () => {
    expect(of({ focusedSessionId: 't' })).toBe('q')
    expect(of({ focusedFeature: { projectId: 'q', slug: 'z' } })).toBe('q')
    expect(of({ focusedProject: 'q' })).toBe('q')
    expect(of({})).toBe('p')
    expect(boardProject(ui(), [], [], [])).toBeNull()
  })
})

describe('childrenOf', () => {
  it('lists children in the same project by slug, done last', () => {
    const fs = [
      feature('e', { group: true }),
      feature('c', { parent: 'e', cardState: 'done' }),
      feature('b', { parent: 'e' }),
      feature('d', { parent: 'e' }),
      feature('x', { parent: 'e', projectId: 'q' }),
    ]
    expect(childrenOf(fs[0], fs).map((f) => f.slug)).toEqual(['b', 'd', 'c'])
  })
})

describe('boardKey', () => {
  const of = (u: Partial<UiState>) => boardKey(ui(u), projects, sessions, features)

  it('switches the board on a project page, else opens the context project', () => {
    expect(of({ focusedProject: 'q', board: 'features' })).toEqual({ board: 'sessions' })
    expect(of({ focusedProject: 'q', board: 'sessions' })).toEqual({ board: 'features' })
    expect(of({ board: 'features' })).toEqual({ board: 'sessions' })
    expect(of({ focusedSessionId: 't', board: 'features' })).toEqual({ focusedProject: 'q', board: 'sessions' })
    expect(boardKey(ui(), [], [], [])).toBeNull()
  })
})

describe('currentProjectId', () => {
  it('is the project of whatever is shown, or null', () => {
    expect(currentProjectId({ kind: 'none' })).toBeNull()
    expect(currentProjectId({ kind: 'project', project: { id: 'p1' } as never })).toBe('p1')
    expect(currentProjectId({ kind: 'feature', feature: { projectId: 'p2' } as never })).toBe('p2')
    expect(currentProjectId({ kind: 'session', session: { projectId: 'p3' } as never })).toBe('p3')
    expect(currentProjectId({ kind: 'grid', sessions: [], focused: { projectId: 'p4' } as never })).toBe('p4')
  })
})

describe('focusTarget', () => {
  const many = [session('a'), session('b', { startedAt: '2026-10-05T09:00:00.000Z' }), session('c', { projectId: 'q' })]
  const at = (u: Partial<UiState>, n: number) => focusTarget(ui(u), projects, many, features, n)

  it('is the nth session in sidebar order outside the grid', () => {
    expect(at({}, 1)?.id).toBe('b') // p's sessions by start time, then q's
    expect(at({}, 3)?.id).toBe('c')
    expect(at({}, 4)).toBeUndefined()
  })

  it('is the nth pane in grid order while the grid shows', () => {
    const grid = { open: true, members: ['c', 'a'] }
    expect(at({ grid, focusedSessionId: 'a' }, 1)?.id).toBe('c')
    expect(at({ grid, focusedSessionId: 'a' }, 2)?.id).toBe('a')
    expect(at({ grid, focusedSessionId: 'a' }, 3)).toBeUndefined()
  })

  it('counts sidebar order when the grid is on but hidden', () => {
    expect(at({ grid: { open: true, members: ['c', 'a'] }, focusedSessionId: 'b' }, 1)?.id).toBe('b')
  })
})
