// The shared status model. Times are epoch milliseconds.
// `since` is when the state last changed, so a repeated event keeps the original time.

export const GRACE_MS = 3000
export const SILENCE_MS = 30000

export interface TimingOptions {
  graceMs?: number
  silenceMs?: number
}

export type NeedsYouReason = 'permission' | 'question' | 'error'

export type Status =
  | { state: 'working'; since: number }
  | { state: 'needs-you'; reason: NeedsYouReason; since: number }
  | { state: 'finished'; since: number }
  | { state: 'idle'; since: number }
  | { state: 'unknown'; since: number }

export interface StatusReport {
  state: string
  kind?: string
}

// Legacy adapter events remain defined while the integrations are removed. Only session events are consumed.
export type StatusEvent =
  | { kind: 'working' }
  | { kind: 'needs-you'; reason: NeedsYouReason }
  | { kind: 'finished' }
  | { kind: 'idle' }
  | { kind: 'idle-prompt' }
  | { kind: 'session'; resumeId: string }
  | { kind: 'heartbeat' }
  | { kind: 'lost' }

export function unknownStatus(now: number): Status {
  return { state: 'unknown', since: now }
}

// A report transition keeps the adapter's state vocabulary out of the reducer. In this slice only working and idle map.
export function applyReport(status: Status, report: StatusReport, now: number): Status {
  if (report.state === 'working') return applyEvent(status, { kind: 'working' }, now)
  if (report.state === 'idle') {
    if (status.state === 'working' || status.state === 'needs-you') return { state: 'finished', since: now }
    if (status.state === 'idle' || status.state === 'finished') return status
    return { state: 'idle', since: now }
  }
  return status
}

// The legacy adapter reducer remains until those event types are removed.
export function applyEvent(status: Status, event: StatusEvent, now: number): Status {
  switch (event.kind) {
    case 'working':
      return status.state === 'working' ? status : { state: 'working', since: now }
    case 'needs-you':
      if (status.state === 'needs-you' && status.reason === event.reason) return status
      return { state: 'needs-you', reason: event.reason, since: now }
    case 'finished':
      return status.state === 'finished' ? status : { state: 'finished', since: now }
    case 'idle':
      return status.state === 'idle' ? status : { state: 'idle', since: now }
    case 'idle-prompt':
      if (status.state === 'working' || status.state === 'needs-you') return { state: 'finished', since: now }
      if (status.state === 'finished' || status.state === 'idle') return status
      return { state: 'idle', since: now }
    case 'session':
    case 'heartbeat':
    case 'lost':
      return status
  }
}
