import { describe, expect, it } from 'vitest'
import type { Project } from '@shared/types'
import { branchFor, buildRows, orderProjects, suggestBranch } from './launchRows'

const proj = (id: string, name: string, worktreeOf?: string) => ({ id, name, worktreeOf } as Project)
const grove = proj('g', 'grove')
const wt = proj('w', 'grove · grove-1', 'g')
const other = proj('o', 'other')
const refs = { g: { branch: 'master', default: 'master' }, o: { branch: 'dev', default: 'main' } }

describe('orderProjects', () => {
  it('puts the repo the dialog was opened from, and its worktrees, first', () => {
    expect(orderProjects([other, grove, wt], 'w').map((p) => p.id)).toEqual(['g', 'w', 'o'])
  })
})

describe('buildRows', () => {
  it('offers a create row and an open row per checkout, create first', () => {
    const rows = buildRows([grove, other], refs, '')
    expect(rows.map((r) => r.key)).toEqual(['new:g', 'use:g', 'new:o', 'use:o'])
    expect(rows[0]).toMatchObject({ type: 'create', label: 'New worktree from master' })
  })

  it('turns a typed name nobody has into the top create row, carrying the name', () => {
    const [top] = buildRows([grove], refs, 'feat/login')
    expect(top).toMatchObject({ type: 'create', branch: 'feat/login', base: 'master' })
  })

  it('does not offer to create a branch that a checkout is already on', () => {
    expect(buildRows([grove], refs, 'master').some((r) => r.type === 'create' && r.branch === 'master')).toBe(false)
  })
})

describe('branchFor', () => {
  const row = buildRows([grove], refs, 'feat/login')[0]
  if (row.type !== 'create') throw new Error('expected a create row')

  it('prefers what was edited, then the typed name, then a proposal', () => {
    expect(branchFor(row, 'my branch', [grove])).toBe('my-branch')
    expect(branchFor(row, null, [grove])).toBe('feat/login')
    expect(branchFor({ ...row, branch: null }, '  ', [grove])).toBe('grove/grove-1')
  })
})

describe('suggestBranch', () => {
  it('takes the lowest free number', () => {
    expect(suggestBranch(grove, [grove, wt])).toBe('grove/grove-2')
  })
})
