import type { StatusEvent } from '../../status/contract.ts'
import { createSpoolSource, readSpool, type SpoolRecord, type SpoolRead, type SpoolSource } from '../../status/spool.ts'
import { SESSION_ID } from './launch.ts'

export { POLL_MS, readSpool, type SpoolRecord, type SpoolRead } from '../../status/spool.ts'

export interface DeliveredEvent {
  event: StatusEvent
  at: number
}

export interface ClaudeSourceOptions {
  spoolFile: string
  offsetFile: string
  clock: () => number
  onEvent: (event: StatusEvent, at: number) => void
}

export type ClaudeSource = SpoolSource

function field(payload: unknown, key: string): string | undefined {
  if (payload === null || typeof payload !== 'object') return undefined
  const value = (payload as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

// The status events one Claude hook record means. Empty for hooks that carry no status.
export function eventsFor(record: SpoolRecord): StatusEvent[] {
  switch (record.event) {
    case 'UserPromptSubmit':
    // A failed tool (or a denied permission) still goes on with the turn, so it clears the needs-you as the old Grove does.
    case 'PostToolUse':
    case 'PostToolUseFailure':
    case 'SubagentStart':
      return [{ kind: 'working' }]
    case 'PreToolUse':
      // The old Grove shows a question the moment it is asked, not when the tool is allowed.
      if (field(record.payload, 'tool_name') === 'AskUserQuestion') return [{ kind: 'needs-you', reason: 'question' }]
      return [{ kind: 'working' }]
    case 'PermissionRequest':
      // The hook fires for a question too, and the question's own event already covers it.
      if (field(record.payload, 'tool_name') === 'AskUserQuestion') return []
      return [{ kind: 'needs-you', reason: 'permission' }]
    case 'Notification': {
      const type = field(record.payload, 'notification_type')
      if (type === 'permission_prompt') return [{ kind: 'needs-you', reason: 'permission' }]
      if (type === 'elicitation_dialog') return [{ kind: 'needs-you', reason: 'question' }]
      if (type === 'idle_prompt') return [{ kind: 'idle-prompt' }]
      return []
    }
    case 'StopFailure':
    case 'Stop': {
      // A subagent's Stop carries its agent_id and does not end the main turn. 'main' is the main agent.
      const agentId = field(record.payload, 'agent_id')
      if (agentId !== undefined && agentId !== 'main') return []
      return record.event === 'Stop' ? [{ kind: 'finished' }] : [{ kind: 'needs-you', reason: 'error' }]
    }
    case 'SessionEnd':
      return [{ kind: 'idle' }]
    case 'SessionStart': {
      const resumeId = field(record.payload, 'session_id')
      return resumeId && SESSION_ID.test(resumeId) ? [{ kind: 'session', resumeId }] : []
    }
    default:
      return []
  }
}

// The status events a batch of records means, in order, each stamped with its own time.
export function deliveriesFor(records: SpoolRecord[], fallbackAt: number): DeliveredEvent[] {
  const out: DeliveredEvent[] = []
  for (const record of records) {
    const at = record.at ?? fallbackAt
    for (const event of eventsFor(record)) out.push({ event, at })
  }
  return out
}

// For tests and tools: what a spool holds from an offset, without any state kept.
export function replaySpool(spoolFile: string, fromOffset: number, fallbackAt = 0): SpoolRead & { events: DeliveredEvent[] } {
  const read = readSpool(spoolFile, fromOffset)
  return { ...read, events: deliveriesFor(read.records, fallbackAt) }
}

// The Claude spool is read by the generic spool source; only the hook record meaning is Claude's.
export function createClaudeSource(options: ClaudeSourceOptions): ClaudeSource {
  return createSpoolSource({ ...options, toEvents: eventsFor })
}
