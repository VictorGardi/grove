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
export function createCopilotUsageSource(options: CopilotUsageOptions): CopilotUsageSource {
  // Chars of the file already split into complete lines and read. A poll only grows it over whole lines, so a torn
  // trailing line waits for its newline instead of being read half.
  let done = 0
  // The tail of the file just before `done`. When it no longer matches, the file was truncated or replaced: re-read
  // from the start, since slicing at `done` is then mid-line.
  let guard = ''
  let last = ''
  const drain = (): void => {
    let text: string
    try {
      text = fs.readFileSync(options.file, 'utf8')
    } catch {
      return
    }
    const shorten = done > 0 && text.slice(Math.max(0, done - guard.length), done) !== guard
    if (text.length < done || shorten) done = 0
    if (text.length === done) return
    const rest = text.slice(done)
    const cut = rest.lastIndexOf('\n')
    if (cut === -1) return
    done += cut + 1
    guard = text.slice(Math.max(0, done - 64), done)
    // The newest valid record of the fresh lines is the reading: by its event time, and a later line breaks a tie.
    let newest: ContextUsage | null = null
    for (const line of rest.slice(0, cut).split('\n')) {
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
  }
  drain()
  const timer = setInterval(drain, POLL_MS)
  return { drain, close: () => clearInterval(timer) }
}
