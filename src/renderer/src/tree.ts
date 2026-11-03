import type { Feature, Session } from '@shared/types'

// The group keys live in @shared/groups: core has to recognise a project's keys when the
// project goes away and the renderer draws them, so the format is defined once.

// The feature a session is linked to, in the session's own project; null when unlinked or missing.
export function linkedFeature(session: Session, features: Feature[]): Feature | null {
  return features.find((f) => f.projectId === session.projectId && f.slug === session.feature) ?? null
}
