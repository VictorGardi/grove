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

// The events one Claude hook record means. Only SessionStart matters: it carries the resume id, which also changes on /clear.
export function eventsFor(record: SpoolRecord): StatusEvent[] {
  if (record.event !== 'SessionStart') return []
  const resumeId = field(record.payload, 'session_id')
  return resumeId && SESSION_ID.test(resumeId) ? [{ kind: 'session', resumeId }] : []
}

// The events a batch of records means, in order, each stamped with its own time.
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
