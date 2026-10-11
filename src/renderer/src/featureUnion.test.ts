import { describe, expect, it } from 'vitest'
import type { Feature, Project } from '@shared/types'
import { divergentCopies, unionFeatures } from './featureUnion'
import { repoGroups } from './repoGroups'

const project = (id: string, name: string, worktreeOf?: string): Project => ({ id, name, path: '/src/' + id, ...(worktreeOf && { worktreeOf }) })

// A checkout and a worktree of one repo, and a second repo.
const projects = [project('p', 'grove'), project('wt', 'grove · fix-auth', 'p'), project('q', 'other')]

const feature = (projectId: string, slug: string, over: Partial<Feature> = {}): Feature => ({
  projectId, slug, path: '/src/' + projectId + '/' + slug, title: slug, kind: 'feature', group: false,
  parent: null, flow: null, stages: [], currentStage: 'research', cardState: 'ready', progress: null,
  flags: [], warnings: [], artifacts: [], ...over,
})

const union = (features: Feature[], over: Project[] = projects) => unionFeatures(features, repoGroups(over))
const find = (features: Feature[], over?: Project[]) => union(features, over).find((u) => u.slug === features[0].slug)

describe('unionFeatures', () => {
  it('gives one card per repo and slug, not one per checkout', () => {
    const list = union([feature('p', 'f'), feature('wt', 'f')])
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ headId: 'p' })
    expect(list[0].copies.map((c) => c.projectId)).toEqual(['p', 'wt'])
  })

  it('keeps one card per repo when two repos hold the same slug', () => {
    expect(union([feature('p', 'f'), feature('q', 'f')]).map((u) => u.headId)).toEqual(['p', 'q'])
  })

  it('takes the checkout\'s copy as canonical, artifacts and stage included', () => {
    const list = union([
      feature('wt', 'f', { currentStage: 'design', title: 'from the worktree' }),
      feature('p', 'f', { currentStage: 'research', title: 'from the checkout', artifacts: [{ name: 'a.md', stage: null, role: null, mtimeMs: 1 }] }),
    ])
    expect(list[0]).toMatchObject({ projectId: 'p', currentStage: 'research', title: 'from the checkout' })
    expect(list[0].artifacts).toHaveLength(1)
  })

  it('stands a worktree-only feature on its own copy, keeping that checkout as where it opens', () => {
    const u = find([feature('wt', 'f')])!
    expect(u).toMatchObject({ projectId: 'wt', title: 'f', headId: 'p' })
    expect(u.copies.map((c) => c.projectId)).toEqual(['wt'])
  })

  it('carries each checkout\'s name on its copy', () => {
    expect(find([feature('p', 'f'), feature('wt', 'f')])!.copies)
      .toEqual([{ projectId: 'p', name: 'grove', feature: expect.objectContaining({ projectId: 'p' }) },
        { projectId: 'wt', name: 'grove · fix-auth', feature: expect.objectContaining({ projectId: 'wt' }) }])
  })

  it('unions the flags of every copy, by id', () => {
    expect(find([
      feature('p', 'f', { flags: [{ id: 'x', label: 'X' }] }),
      feature('wt', 'f', { flags: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }] }),
    ])!.flags).toEqual([{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }])
  })

  it('orders cards by the order each slug first arrives, which is the order the board showed them in', () => {
    expect(union([feature('wt', 'b'), feature('p', 'a'), feature('q', 'c')]).map((u) => [u.headId, u.slug]))
      .toEqual([['p', 'b'], ['p', 'a'], ['q', 'c']])
  })

  it('ignores features of a project that is not registered', () => {
    expect(union([feature('p', 'f'), feature('gone', 'g')])).toHaveLength(1)
  })

  it('is empty with no features', () => {
    expect(union([])).toEqual([])
  })

  it('returns Features, so everything taking one takes these', () => {
    const asFeatures: Feature[] = union([feature('p', 'f')])
    expect(asFeatures[0].slug).toBe('f')
  })
})

describe('divergentCopies', () => {
  it('is the worktree copies sitting at another stage', () => {
    const u = find([feature('p', 'f'), feature('wt', 'f', { currentStage: 'design' })])!
    expect(divergentCopies(u).map((c) => [c.projectId, c.name])).toEqual([['wt', 'grove · fix-auth']])
  })

  it('is empty when every copy agrees on the stage', () => {
    expect(divergentCopies(find([feature('p', 'f'), feature('wt', 'f')])!)).toEqual([])
  })

  it('is empty for a feature only one checkout has, however far along it is', () => {
    expect(divergentCopies(find([feature('wt', 'f', { currentStage: 'design' })])!)).toEqual([])
  })

  it('lists every divergent copy, not only the first', () => {
    const many = [project('p', 'grove'), project('wt1', 'grove · a', 'p'), project('wt2', 'grove · b', 'p')]
    const u = find([feature('p', 'f'), feature('wt1', 'f', { currentStage: 'design' }), feature('wt2', 'f', { currentStage: 'questions' })], many)!
    expect(divergentCopies(u).map((c) => c.projectId)).toEqual(['wt1', 'wt2'])
  })
})