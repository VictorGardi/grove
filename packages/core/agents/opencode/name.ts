import { cleanName, nameReporter, NAME_POLL_MS, poll } from '../nameSource.ts'
import { obj } from '../usageSource.ts'

export interface OpencodeNameSource {
  drain: () => Promise<void>
  close: () => void
}

// What OpenCode calls a session before it has written a title for it.
const PLACEHOLDER = /^(new|child) session\b/i

// The title of one session in the list body of GET /api/session (bare or wrapped in `{ data: [...] }`). Undefined for
// a session that is not listed, one with no title yet, or one still on OpenCode's placeholder title.
export function openCodeTitle(body: unknown, sessionId: string): string | undefined {
  const wrapped = obj(body)
  const list = Array.isArray(body) ? body : wrapped !== null && Array.isArray(wrapped.data) ? wrapped.data : null
  if (list === null) return undefined
  for (const entry of list) {
    const session = obj(entry)
    if (session === null || session.id !== sessionId) continue
    const title = cleanName(session.title)
    return title === undefined || PLACEHOLDER.test(title) ? undefined : title
  }
  return undefined
}

export function createOpencodeNameSource(options: {
  sessionId: string
  fetchJson: (path: string) => Promise<unknown>
  onName: (name: string) => void
  intervalMs?: number
}): OpencodeNameSource {
  const report = nameReporter('OpenCode', options.onName)
  let busy = false
  let closed = false
  const drain = async (): Promise<void> => {
    if (busy || closed) return
    busy = true
    try {
      // An outage is the usage source's to log; a name that cannot be read is simply not there yet.
      const body = await options.fetchJson('/api/session').catch(() => undefined)
      if (!closed) report(openCodeTitle(body, options.sessionId))
    } finally {
      busy = false
    }
  }
  const timer = poll(drain, { immediate: true, intervalMs: options.intervalMs ?? NAME_POLL_MS })
  return {
    drain,
    close: () => {
      closed = true
      timer.stop()
    },
  }
}
