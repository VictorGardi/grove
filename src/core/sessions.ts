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
    seenAt: null,
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

// Each live session's branch, from its tmux pane's current directory. Same array when unchanged.
export function withBranches(sessions: Session[], cwds: Map<string, string>, branchAt: (dir: string) => string | null): Session[] {
  let changed = false
  const out = sessions.map((s) => {
    const cwd = cwds.get(s.tmuxName)
    if (s.lastStatus !== 'running' || cwd === undefined) return s
    const branch = branchAt(cwd)
    if (branch === s.branch) return s
    changed = true
    return { ...s, branch }
  })
  return changed ? out : sessions
}

export function markGone(s: Session, now: string): Session {
  return s.lastStatus === 'gone' ? s : { ...s, lastStatus: 'gone', endedAt: now }
}

export function markSeen(s: Session, at: string): Session {
  return { ...s, seenAt: at }
}

export function autoLink(s: Session, feature: string): Session {
  return { ...s, feature } // leaves linkPinned alone
}

export function resume(s: Session): Session {
  return { ...s, lastStatus: 'running', endedAt: null }
}

export function link(s: Session, feature: string | null): Session {
  return { ...s, feature, linkPinned: true }
}

export function rename(s: Session, label: string): Session {
  return { ...s, label, labelPinned: true }
}
