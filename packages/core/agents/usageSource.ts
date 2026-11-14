import type { ContextUsage } from '../../protocol/messages.ts'
import { POLL_MS } from '../status/spool.ts'

export const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
export const obj = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null

// Delivers a reading to `onContext` unless it matches the last one delivered, so a repeated reading does not wake the
// window. `keyOf` names what counts as a change (default: the whole reading). A throwing callback is logged, never
// retried: the reading still counts as delivered.
export function reporter(
  agent: string,
  onContext: (context: ContextUsage) => void,
  keyOf: (context: ContextUsage) => string = (context) => JSON.stringify(context),
): (context: ContextUsage) => void {
  let last: string | undefined
  return (context) => {
    const key = keyOf(context)
    if (key === last) return
    last = key
    try {
      onContext(context)
    } catch (error) {
      console.error(`core: could not report the ${agent} context: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

// Runs `drain` every poll (a second by default), first at once when `immediate`. A sync drain runs inside the timer
// tick; an async one that rejects has already logged its own failure, so the poll carries on.
export function poll(
  drain: () => void | Promise<void>,
  options: { intervalMs?: number; immediate: boolean },
): { stop: () => void } {
  const run = (): void => {
    const done = drain()
    if (done !== undefined) done.catch(() => {})
  }
  if (options.immediate) run()
  const timer = setInterval(run, options.intervalMs ?? POLL_MS)
  return { stop: () => clearInterval(timer) }
}
