import { describe, expect, it } from 'vitest'
import type { Project, Session } from '@shared/types'
import { repoGroups, repoProjectIds, repoRows, repoHead } from './repoGroups'

const project = (id: string, name = id, worktreeOf?: string): Project => ({ id, name, path: '/src/' + id, ...(worktreeOf && { worktreeOf }) })

const session = (id: string, projectId: string): Session => ({ id, projectId } as Session)

const shape = (projects: Project[]) =>
  repoGroups(projects).map((g) => [g.key, g.project.id, g.worktrees.map((w) => w.id)])

describe('repoGroups', () => {
  it('puts each checkout first, then its worktrees in config order', () => {
    const projects = [
      project('p', 'P'),
      project('wt1', 'P · a', 'p'),
      project('q', 'Q'),
      project('wt2', 'P · b', 'p'),
      project('wt3', 'Q · c', 'q'),
    ]
    expect(shape(projects)).toEqual([
      ['g:p', 'p', ['wt1', 'wt2']],
      ['g:q', 'q', ['wt3']],
    ])
  })

  it('gives a checkout with no worktrees a group of its own', () => {
    expect(shape([project('p'), project('q')])).toEqual([['g:p', 'p', []], ['g:q', 'q', []]])
  })

  it('keeps a worktree whose parent is not registered as its own group, rather than losing it', () => {
    expect(shape([project('p'), project('orphan', 'X · a', 'gone')])).toEqual([
      ['g:p', 'p', []],
      ['g:orphan', 'orphan', []],
    ])
  })

  it('nests under the project it names, however that project is spelled', () => {
    const projects = [project('p', 'P'), project('w', 'W', 'P')] // worktreeOf is an id, not a name
    expect(shape(projects)).toEqual([['g:p', 'p', []], ['g:w', 'w', []]])
  })

  it('is empty with no projects', () => {
    expect(repoGroups([])).toEqual([])
  })
})

describe('repoRows', () => {
  it('lists one row per repo, counting the sessions of every one of its checkouts', () => {
    const projects = [project('p', 'grove'), project('wt1', 'grove · a', 'p'), project('wt2', 'grove · b', 'p'), project('q', 'other')]
    const sessions = [session('a', 'p'), session('b', 'wt1'), session('c', 'wt2'), session('d', 'wt1'), session('e', 'q')]
    expect(repoRows(projects, sessions).map((r) => [r.project.id, r.sessions])).toEqual([['p', 4], ['q', 1]]) // a, b, c, d
  })

  it('counts nothing for a repo with no sessions, and is empty with no projects', () => {
    expect(repoRows([project('p'), project('wt', 'p · a', 'p')], []).map((r) => [r.project.id, r.sessions])).toEqual([['p', 0]])
    expect(repoRows([], [])).toEqual([])
  })
})

describe('repoHead', () => {
  const projects = [project('p', 'grove'), project('wt', 'grove · a', 'p'), project('q', 'other'), project('orphan', 'X · a', 'gone')]

  it('is the checkout a worktree hangs under, and the project itself when it is one', () => {
    expect(projects.map((p) => repoHead(projects, p.id))).toEqual(['p', 'p', 'q', 'orphan'])
  })

  it('is the id itself for a project that is not registered', () => {
    expect(repoHead(projects, 'nope')).toBe('nope')
    expect(repoHead([], 'p')).toBe('p')
  })
})

describe('repoProjectIds', () => {
  const projects = [project('p', 'grove'), project('wt1', 'grove · a', 'p'), project('wt2', 'grove · b', 'p'), project('q', 'other')]

  it('is the checkout and every one of its worktrees, from either end', () => {
    const ids = (id: string) => [...repoProjectIds(projects, id)].sort()
    expect(ids('p')).toEqual(['p', 'wt1', 'wt2'])
    expect(ids('wt2')).toEqual(['p', 'wt1', 'wt2'])
    expect(ids('q')).toEqual(['q'])
  })

  it('is the id alone when no such project is registered', () => {
    expect([...repoProjectIds(projects, 'nope')]).toEqual(['nope'])
    expect([...repoProjectIds([], 'p')]).toEqual(['p'])
  })
})