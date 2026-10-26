import { describe, expect, it } from 'vitest'
import type { Comment, Project } from './types'
import { featureDrafts, linkedDrafts, repoFeatureDrafts, sameFeature } from './comments'

const T = '2026-10-07T10:00:00.000Z'
const anchor = { kind: 'file' as const, projectId: 'p', path: 'docs/work/f/03-design.md', exact: 'q', prefix: '', suffix: '', start: 1, end: 1 }
const c = (id: string, owner: string | { projectId: string; slug: string }, state: 'draft' | 'sent' = 'draft'): Comment => ({
  id, ...(typeof owner === 'string' ? { sessionId: owner } : { sessionId: null, feature: owner }),
  anchor, body: id, state, orphaned: false, createdAt: T, updatedAt: T, sentAt: state === 'sent' ? T : null,
})
const projects: Project[] = [
  { id: 'p', name: 'grove', path: '/g' },
  { id: 'wt', name: 'grove · x', path: '/g/wt', worktreeOf: 'p' },
  { id: 'q', name: 'other', path: '/o' },
]
const session = { id: 's', projectId: 'p', feature: 'f' }
const ids = (cs: Comment[]) => cs.map((x) => x.id)

describe('sameFeature', () => {
  it('matches project and slug', () => {
    expect(sameFeature({ projectId: 'p', slug: 'f' }, { projectId: 'p', slug: 'f' })).toBe(true)
    expect(sameFeature({ projectId: 'p', slug: 'f' }, { projectId: 'q', slug: 'f' })).toBe(false)
    expect(sameFeature({ projectId: 'p', slug: 'f' }, { projectId: 'p', slug: 'g' })).toBe(false)
  })
})

describe('featureDrafts', () => {
  it('lists the drafts kept on this feature only', () => {
    const cs = [c('own', 's'), c('a', { projectId: 'p', slug: 'f' }), c('b', { projectId: 'p', slug: 'g' }), c('c', { projectId: 'q', slug: 'f' }), c('d', { projectId: 'p', slug: 'f' }, 'sent')]
    expect(ids(featureDrafts(cs, { projectId: 'p', slug: 'f' }))).toEqual(['a'])
  })
})

describe('repoFeatureDrafts', () => {
  it('lists drafts kept on the slug in any checkout of the repo', () => {
    const cs = [c('a', { projectId: 'p', slug: 'f' }), c('w', { projectId: 'wt', slug: 'f' }), c('q', { projectId: 'q', slug: 'f' }),
      c('g', { projectId: 'p', slug: 'g' }), c('s', { projectId: 'p', slug: 'f' }, 'sent'), c('own', 's')]
    expect(ids(repoFeatureDrafts(cs, { projectId: 'p', slug: 'f' }, projects))).toEqual(['a', 'w'])
    expect(ids(repoFeatureDrafts(cs, { projectId: 'wt', slug: 'f' }, projects))).toEqual(['a', 'w'])
  })
})

describe('linkedDrafts', () => {
  it('lists only the session own drafts when nothing else matches', () => {
    expect(ids(linkedDrafts([c('a', 's'), c('b', 'other')], session, projects))).toEqual(['a'])
  })
  it('merges drafts kept on the same feature after its own', () => {
    expect(ids(linkedDrafts([c('f1', { projectId: 'p', slug: 'f' }), c('a', 's')], session, projects))).toEqual(['a', 'f1'])
  })
  it('excludes the same slug in another repo', () => {
    expect(ids(linkedDrafts([c('x', { projectId: 'q', slug: 'f' })], session, projects))).toEqual([])
  })
  it('excludes another feature', () => {
    expect(ids(linkedDrafts([c('x', { projectId: 'p', slug: 'g' })], session, projects))).toEqual([])
  })
  it('includes a worktree checkout of the same repo, either way round', () => {
    expect(ids(linkedDrafts([c('w', { projectId: 'wt', slug: 'f' })], session, projects))).toEqual(['w'])
    expect(ids(linkedDrafts([c('m', { projectId: 'p', slug: 'f' })], { ...session, projectId: 'wt' }, projects))).toEqual(['m'])
  })
  it('excludes sent ones', () => {
    expect(ids(linkedDrafts([c('a', 's', 'sent'), c('b', { projectId: 'p', slug: 'f' }, 'sent')], session, projects))).toEqual([])
  })
  it('merges nothing for a session with no feature', () => {
    expect(ids(linkedDrafts([c('a', 's'), c('b', { projectId: 'p', slug: 'f' })], { ...session, feature: null }, projects))).toEqual(['a'])
  })
})
