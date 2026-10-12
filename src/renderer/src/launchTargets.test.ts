import { describe, expect, it } from 'vitest'
import type { Project } from '@shared/types'
import { baseOf, branchName, buildTargets, tidyPath, worktreeBranch } from './launchTargets'

const proj = (id: string, name: string, worktreeOf?: string) => ({ id, name, path: `/Users/v/${name}`, worktreeOf }) as Project
const grove = proj('g', 'grove')
const wt = proj('w', 'grove · fix-auth', 'g')
const other = proj('o', 'other')
const refs = { g: { branch: 'dev', default: 'master' }, o: { branch: 'main', default: 'main' } }
const keys = (q: string, from?: string, head = false) => buildTargets([other, grove, wt], from, refs, q, head).map((t) => t.key)

describe('buildTargets', () => {
  it('groups each repo with its worktrees and a create row, the opening repo first', () => {
    expect(keys('', 'w')).toEqual(['use:g', 'use:w', 'new:g', 'use:o', 'new:o'])
  })

  it('reads a worktree’s branch from its name and a repo’s from its refs', () => {
    const rows = buildTargets([grove, wt], undefined, refs, '', false)
    expect(rows[0]).toMatchObject({ branch: 'dev', worktree: false })
    expect(rows[1]).toMatchObject({ branch: 'fix-auth', worktree: true })
  })

  it('names the base every create row forks from', () => {
    expect(buildTargets([grove], undefined, refs, '', false).at(-1)).toMatchObject({ type: 'create', base: 'master', branch: null })
    expect(buildTargets([grove], undefined, refs, '', true).at(-1)).toMatchObject({ base: 'dev' })
  })

  it('turns a typed name into the top create row and offers it to every other repo last', () => {
    const rows = buildTargets([grove, other], undefined, refs, 'login fix', false)
    expect(rows[0]).toMatchObject({ type: 'create', key: 'new:g', branch: 'login-fix' })
    expect(rows.at(-1)).toMatchObject({ type: 'create', key: 'new:o', branch: 'login-fix' })
  })

  it('filters checkouts by the query and ranks them between the create rows', () => {
    expect(keys('fix', 'g')).toEqual(['new:g', 'use:w', 'new:o'])
  })

  it('does not offer a branch a repo already has checked out', () => {
    expect(keys('fix-auth', 'g')).toEqual(['new:o', 'use:w'])
  })
})

describe('baseOf', () => {
  it('falls back to whichever ref the repo does report', () => {
    expect(baseOf({ g: { branch: 'dev', default: null } }, 'g', false)).toBe('dev')
    expect(baseOf({}, 'g', true)).toBeNull()
  })
})

describe('naming helpers', () => {
  it('folds whitespace into dashes', () => expect(branchName(' fix  the auth ')).toBe('fix-the-auth'))
  it('takes the branch after the repo name', () => expect(worktreeBranch(wt)).toBe('fix-auth'))
  it('abbreviates home and keeps the tail of a long path', () => {
    expect(tidyPath('/Users/victor/git/grove')).toBe('~/git/grove')
    expect(tidyPath('/Users/victor/git/a/very/long/path/to/some/repo', 20)).toBe('…/path/to/some/repo')
  })
})
