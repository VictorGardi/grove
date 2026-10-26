import type { Comment, FeatureKey, Project, Session } from './types'

export const sameFeature = (a: FeatureKey, b: FeatureKey) => a.projectId === b.projectId && a.slug === b.slug

// Drafts owned by this feature, not by a session (D3).
export const featureDrafts = (cs: Comment[], f: FeatureKey) =>
  cs.filter((c) => c.sessionId === null && c.state === 'draft' && !!c.feature && sameFeature(c.feature, f))

const repoOf = (projects: Project[], id: string) => { const p = projects.find((x) => x.id === id); return p ? p.worktreeOf ?? p.id : id }

// Drafts kept on this feature's slug in any checkout of its repo.
export function repoFeatureDrafts(cs: Comment[], feature: FeatureKey, projects: Project[]): Comment[] {
  const repo = repoOf(projects, feature.projectId)
  return cs.filter((c) => c.sessionId === null && c.state === 'draft' && c.feature?.slug === feature.slug
    && repoOf(projects, c.feature.projectId) === repo)
}

// A session's tray: its own drafts, then the drafts kept on its linked feature in any checkout of its repo.
export function linkedDrafts(cs: Comment[], session: Pick<Session, 'id' | 'projectId' | 'feature'>, projects: Project[]): Comment[] {
  const own = cs.filter((c) => c.sessionId === session.id && c.state === 'draft')
  if (!session.feature) return own
  return [...own, ...repoFeatureDrafts(cs, { projectId: session.projectId, slug: session.feature }, projects)]
}
