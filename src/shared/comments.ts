import type { Comment, FeatureKey, Project, Session } from './types'

export const sameFeature = (a: FeatureKey, b: FeatureKey) => a.projectId === b.projectId && a.slug === b.slug

// Drafts owned by this feature, not by a session (D3).
export const featureDrafts = (cs: Comment[], f: FeatureKey) =>
  cs.filter((c) => c.sessionId === null && c.state === 'draft' && !!c.feature && sameFeature(c.feature, f))

const repoOf = (projects: Project[], id: string) => { const p = projects.find((x) => x.id === id); return p ? p.worktreeOf ?? p.id : id }

// A session's tray: its own drafts, then the drafts kept on its linked feature in any checkout of its repo.
export function linkedDrafts(cs: Comment[], session: Pick<Session, 'id' | 'projectId' | 'feature'>, projects: Project[]): Comment[] {
  const own = cs.filter((c) => c.sessionId === session.id && c.state === 'draft')
  if (!session.feature) return own
  const repo = repoOf(projects, session.projectId)
  const linked = cs.filter((c) => c.sessionId === null && c.state === 'draft' && c.feature?.slug === session.feature
    && repoOf(projects, c.feature.projectId) === repo)
  return [...own, ...linked]
}
