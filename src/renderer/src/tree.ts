import type { Feature, Project, Session, UiState } from '@shared/types'

export type TreeNode =
  | { type: 'project'; key: string; project: Project; collapsed: boolean; children: TreeNode[] }
  | { type: 'feature'; key: string; feature: Feature; collapsed: boolean; children: TreeNode[] }

export const projectKey = (id: string) => 'p:' + id
export const featureKey = (f: Feature) => 'f:' + f.projectId + '/' + f.slug

const bySlugDoneLast = (a: Feature, b: Feature) =>
  Number(a.cardState === 'done') - Number(b.cardState === 'done') || a.slug.localeCompare(b.slug)
const byStart = (a: Session, b: Session) => a.startedAt.localeCompare(b.startedAt)

// Features tab: project → features, nested by parent.
// Collapsing only marks nodes; their children stay in the tree.
export function buildTree(projects: Project[], features: Feature[], ui: Pick<UiState, 'collapsed'>): TreeNode[] {
  const collapsed = new Set(ui.collapsed)
  return projects.map((project) => {
    const own = features.filter((f) => f.projectId === project.id)
    const slugs = new Set(own.map((f) => f.slug))
    const childrenOf = (parent: string | null) =>
      own.filter((f) => (f.parent !== null && slugs.has(f.parent) ? f.parent : null) === parent).sort(bySlugDoneLast)

    const featureNode = (feature: Feature): TreeNode => {
      const key = featureKey(feature)
      return {
        type: 'feature',
        key,
        feature,
        collapsed: collapsed.has(key),
        children: childrenOf(feature.slug).map(featureNode),
      }
    }

    const key = projectKey(project.id)
    return {
      type: 'project',
      key,
      project,
      collapsed: collapsed.has(key),
      children: childrenOf(null).map(featureNode),
    }
  })
}

export interface SessionGroup { project: Project; key: string; collapsed: boolean; sessions: Session[] }

// Sessions tab: every session under its project, projects in config order, sessions by start time.
export function sessionGroups(projects: Project[], sessions: Session[], ui: Pick<UiState, 'collapsed'>): SessionGroup[] {
  const collapsed = new Set(ui.collapsed)
  return projects.map((project) => {
    const key = projectKey(project.id)
    return {
      project,
      key,
      collapsed: collapsed.has(key),
      sessions: sessions.filter((s) => s.projectId === project.id).sort(byStart),
    }
  })
}

// Sessions in display order, collapsed groups included. Cmd+1..9 counts in this order.
export function sessionOrder(groups: SessionGroup[]): Session[] {
  return groups.flatMap((g) => g.sessions)
}

export interface BoardCard { feature: Feature; epic: string | null }

// One column per workflow stage; non-group features by current stage, done ones in the last column.
export function boardColumns(stages: { id: string; label: string }[], features: Feature[]): { stage: { id: string; label: string }; cards: BoardCard[] }[] {
  const last = stages[stages.length - 1]?.id
  const epicTitle = (f: Feature) =>
    features.find((e) => e.projectId === f.projectId && e.slug === f.parent)?.title ?? null
  return stages.map((stage) => ({
    stage,
    cards: features
      .filter((f) => !f.group && (f.currentStage ?? last) === stage.id)
      .map((feature) => ({ feature, epic: feature.parent === null ? null : epicTitle(feature) })),
  }))
}

// The feature a session is linked to, in the session's own project; null when unlinked or missing.
export function linkedFeature(session: Session, features: Feature[]): Feature | null {
  return features.find((f) => f.projectId === session.projectId && f.slug === session.feature) ?? null
}
