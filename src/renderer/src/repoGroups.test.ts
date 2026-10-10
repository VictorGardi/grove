import { describe, expect, it } from 'vitest'
import type { Project } from '@shared/types'
import { repoGroups } from './repoGroups'

const project = (id: string, name = id, worktreeOf?: string): Project => ({ id, name, path: '/src/' + id, ...(worktreeOf && { worktreeOf }) })

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