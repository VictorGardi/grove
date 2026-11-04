import fs from 'node:fs'
import path from 'node:path'
import type { StatusEvent } from '../../status/contract.ts'
import { SESSION_ID } from './launch.ts'

// The poll is the backstop for a missed fs.watch event and for a spool that does not exist yet.
export const POLL_MS = 1000

// One spool line as hook.mjs wrote it. `at` is missing only in a hand-edited line; then the clock stands in.
export interface SpoolRecord {
  event: string
  at: number | undefined
  payload: unknown
}

export interface SpoolRead {
  records: SpoolRecord[]
  // Byte offset just past the last complete line read. A partial last line waits for its newline.
  offset: number
  corrupt: number
}

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

export interface ClaudeSource {
  // Delivers anything new and reports whether the read worked. Runs on creation and on each fs.watch event.
  drain: () => boolean
  // Complete lines that did not parse, counted since this source was created.
  corruptLines: () => number
  close: () => void
}

// Reads complete lines from a byte offset. A line that is not a JSON object with a string event is corrupt.
export function readSpool(spoolFile: string, fromOffset: number): SpoolRead {
  let size: number
  try {
    size = fs.statSync(spoolFile).size
  } catch {
    return { records: [], offset: fromOffset, corrupt: 0 }
  }
  // A spool shorter than the saved offset was replaced, so it is read from the start.
  const start = size < fromOffset ? 0 : fromOffset
  if (size === start) return { records: [], offset: start, corrupt: 0 }

  const buffer = Buffer.alloc(size - start)
  let filled = 0
  let fd: number | undefined
  try {
    fd = fs.openSync(spoolFile, 'r')
    while (filled < buffer.length) {
      const n = fs.readSync(fd, buffer, filled, buffer.length - filled, start + filled)
      if (n === 0) break
      filled += n
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }

  const lastNewline = buffer.subarray(0, filled).lastIndexOf(0x0a)
  if (lastNewline === -1) return { records: [], offset: start, corrupt: 0 }

  const records: SpoolRecord[] = []
  let corrupt = 0
  for (const line of buffer.subarray(0, lastNewline).toString('utf8').split('\n')) {
    if (line.trim() === '') continue
    const record = parseRecord(line)
    if (record === null) corrupt += 1
    else records.push(record)
  }
  return { records, offset: start + lastNewline + 1, corrupt }
}

function parseRecord(line: string): SpoolRecord | null {
  try {
    const value = JSON.parse(line)
    if (value === null || typeof value !== 'object' || typeof value.event !== 'string') return null
    return {
      event: value.event,
      at: typeof value.at === 'number' ? value.at : undefined,
      payload: value.payload ?? null,
    }
  } catch {
    return null
  }
}

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

export function createClaudeSource(options: ClaudeSourceOptions): ClaudeSource {
  const { spoolFile, offsetFile, clock, onEvent } = options
  let offset = loadOffset(offsetFile)
  let corrupt = 0
  let watcher: fs.FSWatcher | null = null

  // Never throws: one failed read or save is logged and the next drain tries again.
  const drain = (): boolean => {
    try {
      const read = readSpool(spoolFile, offset)
      corrupt += read.corrupt
      for (const { event, at } of deliveriesFor(read.records, clock())) onEvent(event, at)
      // Saved only after delivery: a crash in between replays lines rather than skipping them.
      if (read.offset !== offset) {
        offset = read.offset
        saveOffset(offsetFile, offset)
      }
      return true
    } catch (error) {
      console.error(`core: could not read the Claude spool ${spoolFile}: ${errorText(error)}`)
      return false
    }
  }

  // A watch that fails is closed; the poll goes on and recreates it.
  const watch = (): void => {
    if (watcher !== null || !fs.existsSync(spoolFile)) return
    try {
      const current: fs.FSWatcher = fs.watch(spoolFile, (eventType) => {
        if (eventType === 'rename') {
          current.close()
          if (watcher === current) watcher = null
        }
        drain()
      })
      current.on('error', (error) => {
        console.error(`core: the Claude spool watch failed: ${errorText(error)}`)
        current.close()
        if (watcher === current) watcher = null
      })
      watcher = current
    } catch {
      watcher = null
    }
  }

  drain()
  watch()
  // The poll is the reader's heartbeat: it reports only after a drain that worked, never on hook activity.
  const timer = setInterval(() => {
    watch()
    if (!drain()) return
    try {
      onEvent({ kind: 'heartbeat' }, clock())
    } catch (error) {
      console.error(`core: could not report the Claude spool heartbeat: ${errorText(error)}`)
    }
  }, POLL_MS)

  return {
    drain,
    corruptLines: () => corrupt,
    close: () => {
      clearInterval(timer)
      watcher?.close()
      watcher = null
    },
  }
}

function loadOffset(file: string): number {
  try {
    const value = (JSON.parse(fs.readFileSync(file, 'utf8')) as { offset?: unknown }).offset
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0
  } catch {
    return 0
  }
}

function saveOffset(file: string, offset: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ offset }) + '\n', { mode: 0o600 })
  fs.renameSync(tmp, file)
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
