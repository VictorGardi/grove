import type { Feature, Session } from '@shared/types'
import { shownStatus, type ShownStatus } from './sessionStatus'

export const projectKey = (id: string) => 'p:' + id

const byStart = (a: Session, b: Session) => a.startedAt.localeCompare(b.startedAt)

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

// A feature's linked sessions, in its own project, by start time.
export function linkedSessions(feature: Feature, sessions: Session[]): Session[] {
  return sessions.filter((s) => s.projectId === feature.projectId && s.feature === feature.slug).sort(byStart)
}

// The feature a session is linked to, in the session's own project; null when unlinked or missing.
export function linkedFeature(session: Session, features: Feature[]): Feature | null {
  return features.find((f) => f.projectId === session.projectId && f.slug === session.feature) ?? null
}

export interface SessionColumn { id: 'waiting' | 'working' | 'idle' | 'ended'; label: string; sessions: Session[] }

const SESSION_COLUMNS: { id: SessionColumn['id']; label: string; shown: ShownStatus[] }[] = [
  { id: 'waiting', label: 'Waiting', shown: ['waiting'] },
  { id: 'working', label: 'Working', shown: ['working', 'running'] }, // a plain terminal counts as working
  { id: 'idle', label: 'Idle', shown: ['idle'] },
  { id: 'ended', label: 'Ended', shown: ['gone'] },
]

// Sessions board: one column per shown status, sessions by start time.
export function sessionColumns(sessions: Session[]): SessionColumn[] {
  const sorted = [...sessions].sort(byStart)
  return SESSION_COLUMNS.map(({ id, label, shown }) => ({ id, label, sessions: sorted.filter((s) => shown.includes(shownStatus(s))) }))
}
