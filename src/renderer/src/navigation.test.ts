import { describe, expect, it } from 'vitest'
import { DEFAULT_UI, type Feature, type Project, type Session, type UiState } from '@shared/types'
import { DEFAULT_GRID_VIEW, type GridView } from './gridView'
import { content, crumbs, currentProjectId, focusTarget } from './navigation'

const project = (id: string): Project => ({ id, name: id.toUpperCase(), path: '/' + id })

function feature(slug: string, over: Partial<Feature> = {}): Feature {
  return {
    projectId: 'p', slug, path: '/p/' + slug, title: 'T' + slug, kind: 'feature', flow: null, stages: [], currentStage: 'questions', cardState: 'ready', flags: [], warnings: [], artifacts: [], ...over,
  }
}

function session(id: string, over: Partial<Session> = {}): Session {
  return {
    id, projectId: 'p', kind: 'terminal', label: 'L' + id, labelPinned: false, tmuxName: 'grove-' + id,
    cwd: null, agentSessionId: null, feature: null, linkPinned: false, action: null,
    startedAt: '2026-10-05T10:00:00.000Z', endedAt: null, lastStatus: 'running', seenAt: null, lastContext: null, workflowStatus: 'in-progress', ...over,
  }
}

const ui = (over: Partial<UiState> = {}): UiState => ({ ...DEFAULT_UI, ...over })
const projects = [project('p'), project('q')]
const features = [feature('e'), feature('a'), feature('z', { projectId: 'q' })]
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

  it('shows the focused artifact, found in its project repo, ahead of a stale feature focus', () => {
    const art = { name: 'x.md', stage: null, role: 'artifact' as const, mtimeMs: 1 }
    const fs = [feature('a', { artifacts: [art] })]
    const c = content(ui({ focusedArtifact: { projectId: 'p', slug: 'a', name: 'x.md' } }), projects, sessions, fs)
    expect(c).toMatchObject({ kind: 'artifact', project: projects[0], card: { name: 'x.md', path: 'a/x.md' }, cluster: { feature: { slug: 'a' } } })
    expect(crumbs(c, projects)).toEqual([
      { label: 'P', to: { focusedProject: 'p' } },
      { label: 'Ta', to: { focusedFeature: { projectId: 'p', slug: 'a' } } },
      { label: 'x.md' },
    ])
    expect(currentProjectId(c)).toBe('p')
    expect(content(ui({ focusedArtifact: { projectId: 'p', slug: 'a', name: 'gone.md' } }), projects, sessions, fs).kind).toBe('project')
  })

  it("falls back to a missing feature's project page", () => {
    expect(at({ focusedFeature: { projectId: 'q', slug: 'missing' } })).toEqual({ kind: 'project', project: projects[1] })
  })
})

describe('crumbs', () => {
  const of = (u: Partial<UiState>) => crumbs(content(ui(u), projects, sessions, features), projects)

  it('is the project alone on its page', () => {
    expect(of({ focusedProject: 'p' })).toEqual([{ label: 'P' }])
  })

  it('is empty on the grid', () => {
    expect(of({ grid: { open: true, members: ['s'] }, focusedSessionId: 's' })).toEqual([])
  })

  it('goes project › feature, the project up-link clickable', () => {
    expect(of({ focusedFeature: { projectId: 'p', slug: 'a' } })).toEqual([
      { label: 'P', to: { focusedProject: 'p' } },
      { label: 'Ta' },
    ])
  })

  it('goes repo › session, leaving out the linked feature', () => {
    expect(of({ focusedSessionId: 's' })).toEqual([{ label: 'P', to: { focusedProject: 'p' } }, { label: 'Ls' }])
    expect(of({ focusedSessionId: 't' })).toEqual([{ label: 'Q', to: { focusedProject: 'q' } }, { label: 'Lt' }])
  })

  it("names a worktree session's repo, not the worktree", () => {
    const wt = { id: 'w', name: 'P · feature-x', path: '/w', worktreeOf: 'p' }
    const x = session('x', { projectId: 'w' })
    expect(crumbs({ kind: 'session', session: x }, [...projects, wt]))
      .toEqual([{ label: 'P', to: { focusedProject: 'p' } }, { label: 'Lx' }])
  })

  it('is empty with nothing to show', () => {
    expect(crumbs({ kind: 'none' }, [])).toEqual([])
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

  it('counts only the visible panes while the grid shows', () => {
    const grid = { open: true, members: ['c', 'a'] }
    const ended = [session('a'), session('b'), session('c', { projectId: 'q', lastStatus: 'gone' })]
    const view = (v: Partial<GridView>) => ({ ...DEFAULT_GRID_VIEW, ...v })
    const hide = focusTarget(ui({ grid, focusedSessionId: 'a' }), projects, ended, features, 1, view({ hideEnded: true }))
    expect(hide?.id).toBe('a') // c is ended and hidden, so a is pane 1
    // outside the grid the view does not matter
    expect(focusTarget(ui(), projects, ended, features, 1, view({ hideEnded: true }))?.id).toBe(focusTarget(ui(), projects, ended, features, 1)?.id)
  })

  it('counts sidebar order when the grid is on but hidden', () => {
    expect(at({ grid: { open: true, members: ['c', 'a'] }, focusedSessionId: 'b' }, 1)?.id).toBe('b')
  })

  it('counts a worktree\'s sessions under its repo, and only what is on screen', () => {
    // p's own session, then its worktree's (collapsed by default), then q's.
    const withWorktrees: Project[] = [
      project('p'), { id: 'wt', name: 'P · a', path: '/wt', worktreeOf: 'p' }, project('q'),
    ]
    const list = [session('main'), session('inWt', { projectId: 'wt', startedAt: '2026-10-05T10:00:00.000Z' }), session('inQ', { projectId: 'q', startedAt: '2026-10-05T09:00:00.000Z' })]
    const nth = (n: number, collapsed: string[] = []) => focusTarget(ui({ collapsed }), withWorktrees, list, features, n)?.id
    expect(nth(1)).toBe('main')
    expect(nth(2)).toBe('inWt') // a collapsed worktree holds its slot, as any collapsed group does
    expect(nth(3)).toBe('inQ')
    expect(nth(4)).toBeUndefined()
    expect(nth(2, ['o:w:wt'])).toBe('inWt') // opening the worktree changes nothing about the order
  })
})
