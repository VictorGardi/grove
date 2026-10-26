import type { FeatureKey, Project, Session, SessionKind } from '@shared/types'
import { repoProjectIds } from './repoGroups'
import { usualKind } from './usualKind'

// Where the full page's Send goes (D4): a session linked to the feature that can take a paste.
// one: that session; many: the most recently active, switchable; none: a new session is started.
export interface SendTarget { kind: 'one' | 'many' | 'none'; default: Session | null; candidates: Session[] }

const activeAt = (s: Session) => s.lastFocusedAt ?? s.startedAt

// Linked to this slug in any checkout of the feature's repo; never a terminal, a failed start, or a
// placeholder still being made (it cannot take a paste yet);
// running, or gone with an agent session to resume.
export function resolveTarget(feature: FeatureKey, sessions: Session[], projects: Project[]): SendTarget {
  const repo = repoProjectIds(projects, feature.projectId)
  const candidates = sessions
    .filter((s) => s.feature === feature.slug && repo.has(s.projectId) && s.kind !== 'terminal'
      && (s.lastStatus === 'running' || !!s.agentSessionId) && s.startup?.phase !== 'failed' && s.startup?.phase !== 'starting')
    .sort((a, b) => activeAt(b).localeCompare(activeAt(a)))
  const kind = candidates.length === 0 ? 'none' : candidates.length === 1 ? 'one' : 'many'
  return { kind, default: candidates[0] ?? null, candidates }
}

// The agent a new session starts with when there is none: the kind this repo was last run with.
export const defaultKind = (sessions: Session[], projects: Project[], projectId: string): SessionKind =>
  usualKind(sessions, projects, projectId)
