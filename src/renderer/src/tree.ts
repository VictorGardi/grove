import type { Feature, Session } from '@shared/types'
import { shownStatus, type ShownStatus } from './sessionStatus'

// The group keys live in @shared/groups: core has to recognise a project's keys when the
// project goes away and the renderer draws them, so the format is defined once.

const byStart = (a: Session, b: Session) => a.startedAt.localeCompare(b.startedAt)

// Generic in the feature type so a caller handing over a subtype (featureUnion's UnionFeature)
// gets its own type back, not the Feature it extends.
export interface BoardCard<T extends Feature = Feature> { feature: T; parent: T | null }

// One column per workflow stage some feature uses, in the global order; non-group features by current
// stage, done ones in the last stage of their own flow (the last column when they have none).
// `repoIds` widens the parent lookup to a repo's checkouts: one card per (repo, slug) means a
// feature only a worktree has is that checkout's, while its parent — a tracked folder, so the
// checkout has it too — is the checkout's. Without it a parent is looked up in its own project only.
export function boardColumns<T extends Feature>(stages: { id: string; label: string }[], features: T[], repoIds?: ReadonlySet<string>): { stage: { id: string; label: string }; cards: BoardCard<T>[] }[] {
  const shown = features.filter((f) => !f.group)
  const columns = stages.filter((s) => shown.some((f) => f.stages.some((fs) => fs.id === s.id)))
  const last = columns[columns.length - 1]?.id
  const parentOf = (f: T) =>
    features.find((e) => e.projectId === f.projectId && e.slug === f.parent)
      ?? features.find((e) => repoIds !== undefined && repoIds.has(e.projectId) && e.slug === f.parent)
      ?? null
  return columns.map((stage) => ({
    stage,
    cards: shown
      .filter((f) => (f.currentStage ?? f.stages[f.stages.length - 1]?.id ?? last) === stage.id)
      .map((feature) => ({ feature, parent: feature.parent === null ? null : parentOf(feature) })),
  }))
}

// A feature's linked sessions, in its own project, by start time. `projectIds` widens that to a
// whole repo's checkouts, which is what the board wants: one card per repo, one dot per agent.
export function linkedSessions(feature: Feature, sessions: Session[], projectIds?: ReadonlySet<string>): Session[] {
  const inScope = (id: string) => (projectIds ? projectIds.has(id) : id === feature.projectId)
  return sessions.filter((s) => inScope(s.projectId) && s.feature === feature.slug).sort(byStart)
}

// The feature a session is linked to, in the session's own project; null when unlinked or missing.
export function linkedFeature(session: Session, features: Feature[]): Feature | null {
  return features.find((f) => f.projectId === session.projectId && f.slug === session.feature) ?? null
}

export interface SessionColumn { id: 'waiting' | 'working' | 'idle' | 'ended'; label: string; sessions: Session[] }

const SESSION_COLUMNS: { id: SessionColumn['id']; label: string; shown: ShownStatus[] }[] = [
  { id: 'waiting', label: 'Waiting', shown: ['waiting'] },
  { id: 'working', label: 'Working', shown: ['working', 'running', 'starting'] }, // a plain terminal counts as working, and so does one still starting
  { id: 'idle', label: 'Idle', shown: ['idle'] },
  { id: 'ended', label: 'Ended', shown: ['gone'] },
]

// Sessions board: one column per shown status, sessions by start time.
export function sessionColumns(sessions: Session[]): SessionColumn[] {
  const sorted = [...sessions].sort(byStart)
  return SESSION_COLUMNS.map(({ id, label, shown }) => ({ id, label, sessions: sorted.filter((s) => shown.includes(shownStatus(s))) }))
}
