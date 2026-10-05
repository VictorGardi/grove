import type { Session, SessionKind } from '@shared/types'
import { mintSessionId } from './opencodeId'

const KIND_NAMES: Record<SessionKind, string> = { opencode: 'OpenCode', terminal: 'Terminal' }
const pad = (n: number) => String(n).padStart(2, '0')

export function makeLabel(kind: SessionKind, date: Date): string {
  return `${KIND_NAMES[kind]} · ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function newSession(o: { projectId: string; kind: SessionKind; now: Date; id: string }): Session {
  return {
    id: o.id,
    projectId: o.projectId,
    kind: o.kind,
    label: makeLabel(o.kind, o.now),
    labelPinned: false,
    tmuxName: 'grove-' + o.id,
    opencodeSessionId: o.kind === 'opencode' ? mintSessionId(o.now.getTime()) : null,
    feature: null,
    linkPinned: false,
    action: null,
    startedAt: o.now.toISOString(),
    endedAt: null,
    lastStatus: 'running',
  }
}

export function reconcile(sessions: Session[], live: Set<string>, now: string): Session[] {
  let changed = false
  const out = sessions.map((s) => {
    if (s.lastStatus !== 'running' || live.has(s.tmuxName)) return s
    changed = true
    return markGone(s, now)
  })
  return changed ? out : sessions
}

export function markGone(s: Session, now: string): Session {
  return s.lastStatus === 'gone' ? s : { ...s, lastStatus: 'gone', endedAt: now }
}

export function link(s: Session, feature: string | null): Session {
  return { ...s, feature, linkPinned: true }
}

export function rename(s: Session, label: string): Session {
  return { ...s, label, labelPinned: true }
}
