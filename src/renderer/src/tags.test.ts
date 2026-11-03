import { describe, expect, it } from 'vitest'
import type { Project } from '@shared/types'
import { TAG_COUNT, colorTags } from './tags'

const project = (id: string): Project => ({ id, name: id, path: '/' + id })
describe('colorTags', () => {
  it('gives a worktree no slot of its own but the colour of its repo, so nothing downstream shifts', () => {
    const wt = (id: string): Project => ({ id, name: id, path: '/' + id, worktreeOf: 'p' })
    const plain = [project('p'), project('q')]
    const withWorktrees = [project('p'), wt('wt1'), project('q'), wt('wt2'), project('r')]
    const before = colorTags(plain)
    const after = colorTags(withWorktrees)
    expect([after.project('p'), after.project('q'), after.project('r')]).toEqual([before.project('p'), before.project('q'), 2])
    expect(after.project('wt1')).toBe(after.project('p')) // the repo's colour
    expect(after.project('wt2')).toBe(after.project('p'))
  })

  it('has no colour for an unknown project, or a worktree whose repo is not configured', () => {
    const orphan = { id: 'wt', name: 'wt', path: '/wt', worktreeOf: 'gone' }
    expect(colorTags([project('p'), orphan]).project('wt')).toBeNull()
    expect(colorTags([project('p')]).project('nope')).toBeNull()
  })

  it('wraps around the palette', () => {
    expect(colorTags(Array.from({ length: TAG_COUNT + 1 }, (_, i) => project(`p${i}`))).project(`p${TAG_COUNT}`)).toBe(0)
  })
})
