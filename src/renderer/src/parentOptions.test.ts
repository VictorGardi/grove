import { describe, expect, it } from 'vitest'
import type { Project, Session } from '@shared/types'
import { parentOptions } from './parentOptions'

const project = (id: string, worktreeOf?: string): Project => ({ id, name: id, path: '/' + id, ...(worktreeOf && { worktreeOf }) })
const s = (id: string, projectId: string, parentId?: string): Session => ({ id, projectId, parentId } as Session)

describe('parentOptions', () => {
  const projects = [project('a'), project('b'), project('b-wt', 'b')]
  const sessions = [s('a1', 'a'), s('b1', 'b'), s('b2', 'b-wt'), s('me', 'b-wt'), s('kid', 'a', 'a1')]

  it('puts the session\'s own repo first, then the others in project order', () => {
    expect(parentOptions(projects, sessions, sessions[3]).map((r) => r.project.id)).toEqual(['b', 'a'])
    expect(parentOptions(projects, sessions, sessions[4]).map((r) => r.project.id)).toEqual(['a', 'b'])
  })

  it('counts a worktree\'s sessions under their repo, and offers neither itself nor a child', () => {
    const [own, other] = parentOptions(projects, sessions, sessions[3])
    expect(own.sessions.map((x) => x.id)).toEqual(['b1', 'b2'])
    expect(other.sessions.map((x) => x.id)).toEqual(['a1'])
  })

  it('leaves out a repo with nothing to offer, and everything for a session that leads a group', () => {
    expect(parentOptions(projects, sessions, sessions[1]).map((r) => r.project.id)).toEqual(['b', 'a'])
    expect(parentOptions(projects, sessions, sessions[0])).toEqual([]) // a1 has a child, so it cannot become one
  })
})
