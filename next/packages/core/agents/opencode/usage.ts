import type { ContextUsage } from '../../../protocol/messages.ts'
import { POLL_MS } from '../../status/spool.ts'

export interface OpencodeUsageSource {
  // Reads the exact session once and delivers the newest reading that differs from the last one delivered.
  drain: () => Promise<void>
  close: () => void
}

export interface OpencodeUsageOptions {
  // The exact `ses_...` id the tab runs, launched with `-s` or identified by discovery.
  sessionId: string
  // Resolves the parsed JSON body of GET <path> (`/api/session/<sessionId>/context`, `/api/model`) and rejects on any outage.
  fetchJson: (path: string) => Promise<unknown>
  onContext: (context: ContextUsage | null) => void
  // Poll period. Default POLL_MS, about a second.
  intervalMs?: number
}

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const obj = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null

// The list a body carries: `/api/model` and `/api/session/...` bodies arrive bare or wrapped in `{ data: [...] }`.
function listOf(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body
  const wrapped = obj(body)
  const data = wrapped === null ? undefined : wrapped.data
  return Array.isArray(data) ? data : null
}

// One assistant message as a reading candidate, or null for anything unusable: another entry kind (session-level
// `compaction` and `idle` entries appear too), a non-finite `time.created`, or a message shape that is not an object.
function messageOf(entry: unknown): { created: number; entry: Record<string, unknown> } | null {
  const parsed = obj(entry)
  if (parsed === null || parsed.type !== 'assistant') return null
  const time = obj(parsed.time)
  const created = time === null ? null : num(time.created)
  return created !== null && created > 0 ? { created, entry: parsed } : null
}

// The message's own numbers, validated: the components must each be a finite number, so a partial or bogus tokens
// object is refused whole instead of guessed with zeros. The sum is exactly OpenCode's reported input plus cache
// read and write; `output` and `reasoning` are generated, not context, and never added.
function tokensOf(entry: Record<string, unknown>): number | null {
  const tokens = obj(entry.tokens)
  const cache = tokens === null ? null : obj(tokens.cache)
  if (tokens === null || cache === null) return null
  const parts = [num(tokens.input), num(cache.read), num(cache.write)]
  return parts.every((part) => part !== null) ? parts.reduce((sum, part) => sum + (part ?? 0), 0) : null
}

// The model a message ran as, matched with both fields so two providers that share a model id never swap windows.
function modelOf(entry: Record<string, unknown>): { providerID: string; id: string } | null {
  const model = obj(entry.model)
  return model !== null && typeof model.providerID === 'string' && typeof model.id === 'string'
    ? { providerID: model.providerID, id: model.id }
    : null
}

// The newest assistant message of a context response, completed or not. An in-flight one is the newest, so a
// reading would go stale the moment it becomes old news: the caller refuses it until the request completes.
function newestMessage(context: unknown): Record<string, unknown> | null {
  const entries = listOf(context)
  if (entries === null) return null
  let newest: { created: number; entry: Record<string, unknown> } | null = null
  for (const entry of entries) {
    const parsed = messageOf(entry)
    if (parsed !== null && (newest === null || parsed.created > newest.created)) newest = parsed
  }
  return newest?.entry ?? null
}

const windowKey = (providerID: string, modelID: string): string => `${providerID}/${modelID}`

// The matched catalog entry's `limit.context` — the model limit, which may note a fallback but is what OpenCode
// exposes. A mismatched shape anywhere down the entry is no window at all, never a guess.
function windowOfCatalogEntry(entry: unknown): number | null {
  return num(obj(obj(entry)?.limit)?.context)
}

// One context response against a model catalog: the newest assistant message as a reading, or null when nothing may
// be shown — no assistant message, an incomplete newest one (no completed time or unusable tokens), a model the
// catalog does not list, or a catalog entry without a usable `limit.context`. `at` is the message's own
// `time.completed`, the moment the request finished — never a poll time.
export function usageFromContext(context: unknown, models: unknown): ContextUsage | null {
  const message = newestMessage(context)
  if (message === null) return null
  const completed = num(obj(message.time)?.completed)
  const tokens = tokensOf(message)
  const model = modelOf(message)
  if (completed === null || completed <= 0 || tokens === null || model === null) return null
  const catalog = listOf(models)
  if (catalog === null) return null
  let window: number | null = null
  for (const modelEntry of catalog) {
    const parsed = obj(modelEntry)
    const modelID = parsed === null ? null : (typeof parsed.id === 'string' ? parsed.id : (typeof parsed.modelID === 'string' ? parsed.modelID : null))
    if (parsed !== null && parsed.providerID === model.providerID && modelID === model.id) {
      window = windowOfCatalogEntry(parsed)
      break
    }
  }
  if (window === null || window <= 0) return null
  return { tokens, window, percent: null, model: model.id, at: completed }
}

// Watches one session's context over the authenticated shared service. On each poll it reads the exact session and
// delivers a reading only when it differs from the last one delivered, so an unchanged pair never re-stamps the UI;
// a null reading is delivered once a real one stands, to clear it when the reading stops being supported. Nothing is
// fetched at creation: until the first poll answers, nothing shows. A failed poll delivers nothing, leaving the last
// valid pair — with its original completion time — as the standing reading. One poll runs at a time: a slow drain is
// never overtaken by the next one, so readings never arrive out of order, the catalog is never refetched
// concurrently, and a drain still running at close() delivers nothing.
export function createOpencodeUsageSource(options: OpencodeUsageOptions): OpencodeUsageSource {
  // The model catalog, cached across polls: each matched model's limit, with 0 marking a model the catalog does not
  // list, so a refused model stays refused and a genuinely new model costs exactly one refetch.
  let catalog: Map<string, number> | undefined
  // The last delivered reading: JSON, undefined while nothing has been delivered.
  let last: string | undefined
  // One drain at a time, and nothing delivered after close().
  let busy = false
  let closed = false

  const readCatalog = async (): Promise<Map<string, number>> => {
    const body = listOf(await options.fetchJson('/api/model'))
    if (body === null) throw new Error('the model catalog body is not a list')
    const limits = new Map<string, number>()
    for (const entry of body) {
      const parsed = obj(entry)
      if (parsed === null) continue
      const modelID = typeof parsed.id === 'string' ? parsed.id : (typeof parsed.modelID === 'string' ? parsed.modelID : null)
      if (modelID === null || typeof parsed.providerID !== 'string') continue
      const limit = windowOfCatalogEntry(parsed)
      if (limit === null || limit <= 0) continue
      limits.set(windowKey(parsed.providerID, modelID), limit)
    }
    return limits
  }

  const drain = async (): Promise<void> => {
    if (busy || closed) return
    busy = true
    try {
      let body: unknown
      try {
        body = await options.fetchJson(`/api/session/${options.sessionId}/context`)
      } catch (error) {
        console.error(
          `core: could not read the OpenCode context for ${options.sessionId}: ${error instanceof Error ? error.message : String(error)}`,
        )
        return
      }
      const message = newestMessage(body)
      if (message === null) return
      const completed = num(obj(message.time)?.completed)
      const tokens = tokensOf(message)
      const model = modelOf(message)
      if (completed === null || completed <= 0 || tokens === null || model === null) {
        if (last !== undefined && last !== 'null' && !closed) {
          last = 'null'
          options.onContext(null)
        }
        return
      }
      // The catalog is fetched once, and refetched only when the session runs a model it does not name yet.
      if (catalog === undefined || !catalog.has(windowKey(model.providerID, model.id))) {
        try {
          catalog = await readCatalog()
        } catch (error) {
          console.error(
            `core: could not read the OpenCode model catalog for ${options.sessionId}: ${error instanceof Error ? error.message : String(error)}`,
          )
          return
        }
        if (!catalog.has(windowKey(model.providerID, model.id))) catalog.set(windowKey(model.providerID, model.id), 0)
      }
      const window = catalog.get(windowKey(model.providerID, model.id)) ?? 0
      const reading: ContextUsage | null = window > 0 ? { tokens, window, percent: null, model: model.id, at: completed } : null
      const key = JSON.stringify(reading)
      // A null stands for "refused" here; it is delivered only when it replaces a shown reading.
      if (reading === null && last === undefined) return
      if (key === last) return
      last = key
      if (closed) return
      try {
        options.onContext(reading)
      } catch (error) {
        console.error(`core: could not report the OpenCode context: ${error instanceof Error ? error.message : String(error)}`)
      }
    } finally {
      busy = false
    }
  }

  const timer = setInterval(() => {
    void drain().catch(() => {}) // logged inside; the poll continues
  }, options.intervalMs ?? POLL_MS)
  return { drain, close: () => { closed = true; clearInterval(timer) } }
}
