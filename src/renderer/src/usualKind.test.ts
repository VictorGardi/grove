import { describe, expect, it } from 'vitest'
import type { Project, Session, SessionKind } from '@shared/types'
import { KIND_DEFAULT, usualKind } from './usualKind'

const project = (id: string, name = id, worktreeOf?: string): Project => ({ id, name, path: '/src/' + id, ...(worktreeOf && { worktreeOf }) })
const session = (projectId: string, kind: SessionKind, startedAt: string): Session => ({ id: projectId + kind + startedAt, projectId, kind, startedAt } as Session)

const grove = project('g', 'grove')
const worktree = project('wt', 'grove · a', 'g')
const other = project('o', 'other')
const projects = [grove, worktree, other]

describe('usualKind', () => {
  it('offers the agent the repo was last run with', () => {
    const sessions = [session('g', 'claude', '2026-01-01T10:00:00Z'), session('g', 'opencode', '2026-03-01T10:00:00Z')]
    expect(usualKind(sessions, projects, 'g')).toBe('opencode')
  })

  // The rule that separates this from a count: a repo that has moved on must not be offered the
  // agent it left behind, however many sessions of that agent its history still holds.
  it('follows the most recent session, not the majority', () => {
    const sessions = [
      session('g', 'opencode', '2026-01-01T10:00:00Z'),
      session('g', 'opencode', '2026-01-02T10:00:00Z'),
      session('g', 'opencode', '2026-01-03T10:00:00Z'),
      session('g', 'claude', '2026-02-01T10:00:00Z'),
    ]
    expect(usualKind(sessions, projects, 'g')).toBe('claude')
  })

  // A worktree is the same repo with another folder out (ADR 0037), so what was learned in one is
  // what this repo is run with.
  it('reads a worktree as its repo, from either end', () => {
    const sessions = [session('g', 'opencode', '2026-02-01T10:00:00Z'), session('o', 'claude', '2026-03-01T10:00:00Z')]
    expect(usualKind(sessions, projects, 'wt')).toBe('opencode')
    expect(usualKind(sessions, projects, 'g')).toBe('opencode')
  })

  it("falls back to the newest agent session anywhere when this repo has none", () => {
    const sessions = [session('o', 'opencode', '2026-03-01T10:00:00Z')]
    expect(usualKind(sessions, projects, 'g')).toBe('opencode')
    expect(usualKind(sessions, projects, 'nope')).toBe('opencode')
  })

  it('offers the default with no history at all', () => {
    expect(usualKind([], projects, 'g')).toBe(KIND_DEFAULT)
    expect(usualKind([], projects, undefined)).toBe(KIND_DEFAULT)
    expect(KIND_DEFAULT).toBe('claude')
  })

  // A repo worked in with shells has said nothing about its agent, so it keeps the default rather
  // than arriving on Terminal.
  it('never infers a terminal', () => {
    const sessions = [session('g', 'terminal', '2026-01-01T10:00:00Z'), session('g', 'terminal', '2026-02-01T10:00:00Z')]
    expect(usualKind(sessions, projects, 'g')).toBe(KIND_DEFAULT)
  })

  it('skips terminals when reading the newest agent session', () => {
    const sessions = [session('g', 'opencode', '2026-01-01T10:00:00Z'), session('g', 'terminal', '2026-02-01T10:00:00Z')]
    expect(usualKind(sessions, projects, 'g')).toBe('opencode')
  })
})