import type { Feature, Project, Session, UiState } from '@shared/types'

export const projectKey = (id: string) => 'p:' + id

const byStart = (a: Session, b: Session) => a.startedAt.localeCompare(b.startedAt)

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

export interface BoardCard { feature: Feature; parent: Feature | null }

// One column per workflow stage; non-group features by current stage, done ones in the last column.
export function boardColumns(stages: { id: string; label: string }[], features: Feature[]): { stage: { id: string; label: string }; cards: BoardCard[] }[] {
  const last = stages[stages.length - 1]?.id
  const parentOf = (f: Feature) =>
    features.find((e) => e.projectId === f.projectId && e.slug === f.parent) ?? null
  return stages.map((stage) => ({
    stage,
    cards: features
      .filter((f) => !f.group && (f.currentStage ?? last) === stage.id)
      .map((feature) => ({ feature, parent: feature.parent === null ? null : parentOf(feature) })),
  }))
}

// The feature a session is linked to, in the session's own project; null when unlinked or missing.
export function linkedFeature(session: Session, features: Feature[]): Feature | null {
  return features.find((f) => f.projectId === session.projectId && f.slug === session.feature) ?? null
}
