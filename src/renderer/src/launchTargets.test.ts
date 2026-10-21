import { describe, expect, it } from 'vitest'
import type { Project } from '@shared/types'
import { baseChoices, baseOf, branchName, buildTargets, labelFromBranch, prefillBranch, tidyPath, worktreeBranch } from './launchTargets'

const proj = (id: string, name: string, worktreeOf?: string) => ({ id, name, path: `/Users/v/${name}`, worktreeOf }) as Project
const grove = proj('g', 'grove')
const wt = proj('w', 'grove · fix-auth', 'g')
const other = proj('o', 'other')
const refs = { g: { branch: 'dev', default: 'master' }, o: { branch: 'main', default: 'main' } }
const keys = (q: string, from?: string) => buildTargets([other, grove, wt], from, refs, q).map((t) => t.key)

describe('buildTargets', () => {
  it('groups each repo with its worktrees and a create row, the opening repo first', () => {
    expect(keys('', 'w')).toEqual(['use:g', 'use:w', 'new:g', 'use:o', 'new:o'])
  })

  it('reads a worktree’s branch from its name and a repo’s from its refs', () => {
    const rows = buildTargets([grove, wt], undefined, refs, '')
    expect(rows[0]).toMatchObject({ branch: 'dev', worktree: false })
    expect(rows[1]).toMatchObject({ branch: 'fix-auth', worktree: true })
  })

  it('names the base every create row forks from', () => {
    expect(buildTargets([grove], undefined, refs, '').at(-1)).toMatchObject({ type: 'create', base: 'master', branch: null })
    expect(buildTargets([grove], undefined, refs, '', { g: 'origin/release' }).at(-1)).toMatchObject({ base: 'origin/release' })
  })

  it('turns a typed name into the top create row and offers it to every other repo last', () => {
    const rows = buildTargets([grove, other], undefined, refs, 'login fix')
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
    expect(baseOf({ g: { branch: 'dev', default: null } }, 'g')).toBe('dev')
    expect(baseOf({}, 'g')).toBeNull()
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

describe('baseChoices', () => {
  const r = { g: { branch: 'dev', default: 'master', bases: ['dev', 'feat/x', 'master', 'origin/dev', 'origin/feat/y'] } }

  it('leads with the default and the checked-out branch, then the rest without repeats', () => {
    expect(baseChoices(r, 'g', '')).toEqual(['master', 'dev', 'feat/x', 'origin/dev', 'origin/feat/y'])
  })

  it('ranks by the query and offers remote branches', () => {
    expect(baseChoices(r, 'g', 'feat/y')).toEqual(['origin/feat/y'])
    expect(baseChoices(r, 'g', 'zzz')).toEqual([])
  })

  it('is empty for a repo nothing is known about', () => {
    expect(baseChoices({}, 'g', '')).toEqual([])
  })
})

describe('chosen base', () => {
  it('beats the default for that repo only', () => {
    expect(baseOf(refs, 'g', { g: 'origin/x' })).toBe('origin/x')
    expect(baseOf(refs, 'o', { g: 'origin/x' })).toBe('main')
  })
})

describe('prefillBranch', () => {
  it('puts a bare name under feature/ and leaves one with its own folder alone', () => {
    expect(prefillBranch('')).toBe('feature/')
    expect(prefillBranch('test scoring')).toBe('feature/test-scoring')
    expect(prefillBranch('fix/login')).toBe('fix/login')
  })
})

describe('labelFromBranch', () => {
  it('reads the label off the part after the first folder', () => {
    expect(labelFromBranch('feature/test-scoring-model')).toBe('test-scoring-model')
    expect(labelFromBranch('fix/test-scoring-model')).toBe('test-scoring-model')
    expect(labelFromBranch('user/feature/x')).toBe('feature/x')
  })
  it('uses a folderless branch whole, and gives nothing for a bare prefix', () => {
    expect(labelFromBranch('test-scoring')).toBe('test-scoring')
    expect(labelFromBranch('feature/')).toBe('')
    expect(labelFromBranch('')).toBe('')
  })
})
