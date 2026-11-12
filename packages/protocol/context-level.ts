import type { ContextLevel, ContextUsage } from './messages.ts'

// The lines of a context level: a reading is at a level from the first of its token count or its share of the window.
// Agents act on the level, so the ring, the CLI and an orchestrator all agree on what "high" is.
export const CONTEXT_LEVELS = {
  warn: { tokens: 150_000, percent: 50 },
  handoff: { tokens: 200_000, percent: 70 },
} as const

// The level of a reading, or null when there is none to judge: no reading, or no tokens (before the first request, after a
// compaction). A reading with no window is judged by its token count alone. A provider's own `percent` wins over one
// worked out from `tokens` and `window`.
export function contextLevel(context: ContextUsage | undefined): ContextLevel | null {
  if (!context || context.tokens === null || context.tokens <= 0) return null
  const { tokens, window, percent } = context
  const share = percent ?? (window !== null && window > 0 ? (tokens / window) * 100 : null)
  const over = (line: { tokens: number; percent: number }): boolean => tokens >= line.tokens || (share !== null && share >= line.percent)
  if (over(CONTEXT_LEVELS.handoff)) return 'handoff'
  return over(CONTEXT_LEVELS.warn) ? 'warn' : 'ok'
}
