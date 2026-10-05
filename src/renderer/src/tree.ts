import type { Feature, Project, Session, UiState } from '@shared/types'

export type TreeNode =
  | { type: 'project'; key: string; project: Project; collapsed: boolean; children: TreeNode[] }
  | { type: 'feature'; key: string; feature: Feature; collapsed: boolean; children: TreeNode[] }
  | { type: 'session'; key: string; session: Session }

export const projectKey = (id: string) => 'p:' + id
export const featureKey = (f: Feature) => 'f:' + f.projectId + '/' + f.slug

const bySlugDoneLast = (a: Feature, b: Feature) =>
  Number(a.cardState === 'done') - Number(b.cardState === 'done') || a.slug.localeCompare(b.slug)
const byStart = (a: Session, b: Session) => a.startedAt.localeCompare(b.startedAt)
const sessionNode = (session: Session): TreeNode => ({ type: 'session', key: 's:' + session.id, session })

// Project → features (nested by parent) → linked sessions, then unlinked sessions.
// Collapsing only marks nodes; their children stay in the tree.
export function buildTree(projects: Project[], features: Feature[], sessions: Session[], ui: Pick<UiState, 'collapsed'>): TreeNode[] {
  const collapsed = new Set(ui.collapsed)
  return projects.map((project) => {
    const own = features.filter((f) => f.projectId === project.id)
    const slugs = new Set(own.map((f) => f.slug))
    const projectSessions = sessions.filter((s) => s.projectId === project.id).sort(byStart)
    const childrenOf = (parent: string | null) =>
      own.filter((f) => (f.parent !== null && slugs.has(f.parent) ? f.parent : null) === parent).sort(bySlugDoneLast)

    const featureNode = (feature: Feature): TreeNode => {
      const key = featureKey(feature)
      return {
        type: 'feature',
        key,
        feature,
        collapsed: collapsed.has(key),
        children: [
          ...projectSessions.filter((s) => s.feature === feature.slug).map(sessionNode),
          ...childrenOf(feature.slug).map(featureNode),
        ],
      }
    }

    const key = projectKey(project.id)
    return {
      type: 'project',
      key,
      project,
      collapsed: collapsed.has(key),
      children: [
        ...childrenOf(null).map(featureNode),
        ...projectSessions.filter((s) => s.feature === null || !slugs.has(s.feature)).map(sessionNode),
      ],
    }
  })
}

// Sessions in display order, collapsed nodes included. Cmd+1..9 counts in this order.
export function treeSessionOrder(tree: TreeNode[]): Session[] {
  return tree.flatMap((n) => (n.type === 'session' ? [n.session] : treeSessionOrder(n.children)))
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
