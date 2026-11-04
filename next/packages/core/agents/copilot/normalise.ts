import type { StatusEvent } from '../../status/contract.ts'
import type { SpoolRecord } from '../../status/spool.ts'

// One Copilot session's fold: whether its root turn is running, when it started, and the prompts a shown
// notification left open. Built record by record from the hook spool and Copilot's own log, one per tab.
export interface CopilotFold {
  running: boolean
  startedAt: number | null // when the current turn started: an abort or shutdown read from before it is stale
  pending: Map<string, 'permission' | 'question'> // perm:main and q:main, from shown prompts only
}

export const emptyFold = (): CopilotFold => ({ running: false, startedAt: null, pending: new Map() })

interface Hook {
  agentId?: unknown
  notification_type?: unknown
}

// The state a fold is in, for a tab's first read: a running turn is working, or needs you when a prompt is open.
// Nothing for an idle fold, so a restored tab does not replay an old end.
export function stateEvents(f: CopilotFold): StatusEvent[] {
  if (!f.running) return []
  const open = f.pending.values().next().value
  return [open === undefined ? { kind: 'working' } : { kind: 'needs-you', reason: open }]
}

// The hook and log records → status events. `r.event` is the hook event name; `now` stands in for a record with no time.
// A shown permission prompt or question (`notification`) opens attention; it closes on a tool result, the end of the
// turn or a new prompt (a denied call fires no post hook), and a close while the turn runs is working again.
// A subagent's hooks land in the same spool and carry `agentId`: they never start or end the turn, so a background
// subagent still working after the turn ends does not flip the tab back to working. A shown subagent prompt still counts.
// `abort` (Esc) and `session.shutdown` come from Copilot's log, as no hook fires for an interrupted turn; one from
// before the current turn started is stale. Never mutates `f`.
export function step(f: CopilotFold, r: SpoolRecord, now: number): { fold: CopilotFold; events: StatusEvent[] } {
  const e = (r.payload ?? {}) as Hook
  const at = r.at ?? now
  const sub = typeof e.agentId === 'string'
  const events: StatusEvent[] = []
  let fold = f

  const closeAll = () => {
    if (!fold.pending.size) return
    fold = { ...fold, pending: new Map() }
    if (fold.running) events.push({ kind: 'working' })
  }
  const begin = () => {
    fold = { ...fold, running: true, startedAt: at }
    events.push({ kind: 'working' })
  }
  const end = () => {
    fold = { ...fold, running: false }
    events.push({ kind: 'finished' })
  }
  const open = (id: string, kind: 'permission' | 'question') => {
    if (fold.pending.has(id)) return
    fold = { ...fold, pending: new Map(fold.pending).set(id, kind) }
    events.push({ kind: 'needs-you', reason: kind })
  }

  switch (r.event) {
    case 'assistant.turn_start':
      if (sub || fold.running) break
      begin()
      break
    case 'assistant.turn_end':
      if (sub) break
      closeAll()
      end()
      break
    case 'userPromptSubmitted':
      if (sub) break
      closeAll()
      begin()
      break
    case 'notification':
    case 'Notification':
      if (e.notification_type === 'permission_prompt') open('perm:main', 'permission')
      else if (e.notification_type === 'elicitation_dialog') open('q:main', 'question')
      break
    case 'preToolUse': // a turn whose prompt hook was missed still shows working
      if (!sub && !fold.running) begin()
      break
    case 'sessionStart': // also fires on a resume: nothing survives an unclean end of the earlier run
      if (sub) break
      closeAll()
      if (fold.running) end()
      break
    case 'postToolUseFailure':
    case 'postToolUse':
      closeAll()
      break
    case 'agentStop':
      if (sub) break
      closeAll()
      end()
      break
    case 'sessionEnd':
      if (sub) break
      closeAll()
      if (fold.running) end()
      break
    case 'abort':
    case 'session.shutdown':
      if (sub || !fold.running || (fold.startedAt !== null && at < fold.startedAt)) break
      closeAll()
      end()
      break
  }
  return { fold, events }
}
