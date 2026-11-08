import fs from 'node:fs'
import type { ContextUsage } from '../../../protocol/messages.ts'
import { POLL_MS } from '../../status/spool.ts'

export interface CopilotUsageSource {
  // Reads the events file and delivers the newest valid reading that differs from the last one delivered.
  drain: () => void
  close: () => void
}

export interface CopilotUsageOptions {
  // The session's events.jsonl: <copilotHome>/session-state/<sessionId>/events.jsonl.
  file: string
  onContext: (context: ContextUsage) => void
}

// The most a read from the start of the log takes. Only the newest usage record is wanted, and the log grows into many MB.
const FIRST_READ_MAX = 1 << 20

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const obj = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null

// One events.jsonl line as a context reading, or null for any line with nothing to show: other event types,
// `session.usage_checkpoint` (its totals accumulate across requests, so it never measures one), lines that are not
// JSON, and usage records with a missing or invalid `inputTokens`. `tokens` is the record's `inputTokens` alone —
// the cache read/write counts are breakdowns of that value, never additions. `window` is the CLI's prompt budget,
// not a context window, and is absent when the record carries none. `at` is the event's own timestamp: the moment
// the request finished, never a poll time.
export function usageFromLine(line: string): ContextUsage | null {
  let record: unknown
  try {
    record = JSON.parse(line)
  } catch {
    return null
  }
  const parsed = obj(record)
  if (parsed === null || parsed.type !== 'session.usage_record') return null
  const data = obj(parsed.data)
  const usage = data === null ? null : obj(data.usage)
  const tokens = usage === null ? null : num(usage.inputTokens)
  const at = Date.parse(typeof parsed.timestamp === 'string' ? parsed.timestamp : '')
  if (tokens === null || tokens <= 0 || !Number.isFinite(at)) return null
  const window = num(usage?.maxPromptTokens)
  return {
    tokens,
    window: window !== null && window > 0 ? window : null,
    percent: null,
    model: typeof usage?.model === 'string' ? usage.model : null,
    at,
  }
}

// Watches one session's events.jsonl. On start it scans the existing lines and shows the newest usage record at once;
// then it follows appended complete lines each poll, so a torn final line waits for its newline. A truncation or a
// rewritten file is noticed and read again from the start. While the file is unreadable the last valid sample is kept
// as delivered — it is never dropped and never re-stamped — and a new record goes out when the file returns.
// A poll reads only the bytes past the last consumed offset (the log grows into many MB over a session), so the cost
// stays proportional to the new data rather than the whole file.
export function createCopilotUsageSource(options: CopilotUsageOptions): CopilotUsageSource {
  // Bytes of the file already split into complete lines and consumed. A poll only grows it over whole lines, so a torn
  // trailing line waits for its newline instead of being read half.
  let offset = 0
  // The bytes just before the offset (the last 64 consumed, or fewer in a short file). When they no longer match on a
  // poll, the file was truncated or rewritten in place: read again from the start, since an offset is then mid-line.
  let guard = Buffer.alloc(0)
  let last = ''
  let read: Buffer
  const drain = (): void => {
    let fd: number
    try {
      fd = fs.openSync(options.file, 'r')
    } catch {
      return
    }
    try {
      const size = fs.fstatSync(fd).size
      let start = offset
      // A shorter file is a truncation, and the guard window needs the bytes before the offset.
      if (size < start) start = 0
      if (start > 0 && guard.length > 0) {
        const expected = Buffer.alloc(guard.length)
        if (fs.readSync(fd, expected, 0, expected.length, start - expected.length) !== expected.length || !expected.equals(guard)) start = 0
      }
      // A read from the start is capped at the last FIRST_READ_MAX bytes, so the cut lands mid-line and its first line is dropped.
      const capped = start === 0 && size > FIRST_READ_MAX
      if (capped) start = size - FIRST_READ_MAX
      read = Buffer.alloc(size - start)
      if (read.length > 0 && fs.readSync(fd, read, 0, read.length, start) !== read.length) return // short read: next poll
      if (read.length === 0) return
      const cut = read.lastIndexOf(10) // the newline byte, which never occurs inside a UTF-8 sequence
      if (cut === -1) return
      const firstLine = read.indexOf(10)
      if (capped && firstLine === -1) return
      const from = capped ? firstLine + 1 : 0
      if (from > cut) return
      // The events file was rewritten from the start: the bytes before the old position are vintage, not the guard's.
      const prior = start === 0 ? Buffer.alloc(0) : guard
      guard = Buffer.concat([prior, read.subarray(0, cut + 1)])
      guard = guard.length > 64 ? guard.subarray(guard.length - 64) : guard
      offset = start + cut + 1
      // The newest valid record of the fresh lines is the reading: by its event time, and a later line breaks a tie.
      let newest: ContextUsage | null = null
      for (const line of read.subarray(from, cut).toString('utf8').split('\n')) {
        const context = usageFromLine(line)
        if (context !== null && (newest === null || context.at >= newest.at)) newest = context
      }
      if (newest === null) return
      const key = JSON.stringify(newest)
      if (key === last) return
      last = key
      try {
        options.onContext(newest)
      } catch (error) {
        console.error(`core: could not report the Copilot context: ${error instanceof Error ? error.message : String(error)}`)
      }
    } catch {
      return
    } finally {
      fs.closeSync(fd)
    }
  }
  drain()
  const timer = setInterval(drain, POLL_MS)
  return { drain, close: () => clearInterval(timer) }
}
