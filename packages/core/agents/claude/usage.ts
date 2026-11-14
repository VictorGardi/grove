import fs from 'node:fs'
import type { ContextUsage } from '../../../protocol/messages.ts'
import { num, poll, reporter } from '../usageSource.ts'

export interface ClaudeUsageSource {
  // Reads the usage file and delivers a reading that differs from the last one delivered.
  drain: () => void
  close: () => void
}

export interface ClaudeUsageOptions {
  usageFile: string
  onContext: (context: ContextUsage) => void
}

// One statusLine record (as statusline.mjs writes it) as a context reading. `tokens` is Claude's input-side context
// occupancy (cache reads and writes included). It is null, never 0, before the first API request and after a compaction,
// when Claude sends no current_usage. `window` is read from the input, never assumed.
export function contextFromStatusLine(payload: unknown, at: number): ContextUsage | null {
  if (payload === null || typeof payload !== 'object') return null
  const input = payload as Record<string, unknown>
  const cw = (typeof input.context_window === 'object' && input.context_window !== null ? input.context_window : {}) as Record<string, unknown>
  const usage = typeof cw.current_usage === 'object' && cw.current_usage !== null ? (cw.current_usage as Record<string, unknown>) : null
  const parts = usage === null ? null : [usage.input_tokens, usage.cache_read_input_tokens, usage.cache_creation_input_tokens].map(num)
  const summed = parts !== null && parts.some((part) => part !== null) ? parts.reduce<number>((sum, part) => sum + (part ?? 0), 0) : null
  // The window's current occupancy is the `current_usage` sum; `total_input_tokens` is cumulative across the session,
  // so it can exceed the window and disagree with `used_percentage`. It is only a fallback when Claude reports no
  // `current_usage` breakdown at all.
  const reported = num(cw.total_input_tokens)
  const measured = usage === null ? null : (summed ?? reported)
  const tokens = measured !== null && measured > 0 ? measured : null
  const window = num(cw.context_window_size)
  return {
    tokens,
    window: window !== null && window > 0 ? window : null,
    percent: tokens === null ? null : num(cw.used_percentage),
    model: typeof input.model === 'string' ? input.model : null,
    at,
  }
}

// The latest reading in a usage file, or null when it is missing or not a record.
export function readUsageFile(file: string): ContextUsage | null {
  try {
    const record = JSON.parse(fs.readFileSync(file, 'utf8')) as { at?: unknown; payload?: unknown } | null
    if (record === null || typeof record !== 'object') return null
    return contextFromStatusLine(record.payload, num(record.at) ?? Date.now())
  } catch {
    return null
  }
}

// Watches one tab's usage file. A reading is delivered when it changes, so a repeated one does not wake the window; a null
// reading is delivered too, so a compaction clears the old figure.
export function createClaudeUsageSource(options: ClaudeUsageOptions): ClaudeUsageSource {
  // The write time is not part of the reading: statusline.mjs writes on every refresh, so it must not count as a change.
  const report = reporter('Claude', options.onContext, (context) => JSON.stringify({ ...context, at: 0 }))
  const drain = (): void => {
    const context = readUsageFile(options.usageFile)
    if (context !== null) report(context)
  }
  const timer = poll(drain, { immediate: true })
  return { drain, close: timer.stop }
}
