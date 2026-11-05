// The one status contract every agent adapter reports through (D3). Times are epoch milliseconds.
// `since` is when the state last changed, so a repeated event keeps the original time.

export const GRACE_MS = 3000
export const SILENCE_MS = 30000

export interface TimingOptions {
  // How long after needs-you the cross-check waits before it remembers the screen.
  graceMs?: number
  // How long a working tab may show no real activity, or any other state may go without the reader's
  // heartbeat, before the watchdog falls to unknown.
  silenceMs?: number
}

export type NeedsYouReason = 'permission' | 'question' | 'error'

export type Status =
  | { state: 'working'; since: number }
  | { state: 'needs-you'; reason: NeedsYouReason; since: number }
  | { state: 'finished'; since: number }
  | { state: 'idle'; since: number }
  | { state: 'unknown'; since: number }

// What an adapter emits. `heartbeat` is the source's reader still running (not a hook); it refreshes the
// heartbeat only, never a working tab's activity. `session` carries the agent's own resume id (it changes
// on /clear) and never changes the state. Every other event is a real hook record and counts as progress.
// `lost` means the source cannot read its signal now (an OpenCode event connection dropped). The service sets the
// tab to unknown, as for a gone tab, and it is not real activity.
// `idle-prompt` is Claude's idle_prompt notification. It ends a turn that was interrupted, or had a question
// rejected with Esc, when no other hook fires. A running turn (working, or needs-you with a pending permission
// or question) goes to finished, as the old Grove ends it; finished and idle keep their since; unknown goes to idle.
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

// Pure. A real event (working, needs-you, finished, idle) moves to its state and leaves unknown.
// Setting the same state again keeps `since`, except that a needs-you with a new reason is a change.
// `session`, `heartbeat` and `lost` never change the state; the service, not this reducer, decides their silence effect.
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
