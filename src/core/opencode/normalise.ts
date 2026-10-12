import type { AgentEvent, ContextUsage, SessionSnapshot } from '../agents/types'

// Every OpenCode 2.0.20 event shape grove reads lives here (design risk: Experimental API).
// Envelope: { id, type, created, data, location? }.

const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null

function toIso(v: unknown): string {
  const d = typeof v === 'number' || typeof v === 'string' ? new Date(v) : new Date()
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

const FORM = new Set(['form.created', 'form.replied', 'form.cancelled']) // every form counts as a question

function pending(sessionId: unknown, id: unknown, kind: 'permission' | 'question', open: boolean): AgentEvent | null {
  return typeof sessionId === 'string' && typeof id === 'string' ? { type: 'pending', sessionId, id, kind, open } : null
}

const ENDED = new Set(['session.execution.succeeded', 'session.execution.failed', 'session.execution.interrupted'])

export function normalise(raw: unknown, version: string): AgentEvent | null {
  const e = obj(raw)
  if (!e || typeof e.type !== 'string') return null
  if (e.type === 'server.connected') return { type: 'connected', version }
  const data = obj(e.data)
  if (e.type === 'permission.asked') return pending(data?.sessionID, data?.id, 'permission', true)
  if (e.type === 'permission.replied') return pending(data?.sessionID, data?.requestID, 'permission', false)
  if (FORM.has(e.type)) {
    const form = obj(data?.form) // form.created: the session id is only inside the form
    return pending(data?.sessionID ?? form?.sessionID, data?.id ?? form?.id, 'question', e.type === 'form.created')
  }
  if (e.type === 'session.created') {
    const info = obj(data?.info)
    const sessionId = data?.sessionID ?? data?.id ?? info?.id
    const parentId = data?.parentID ?? info?.parentID
    return typeof sessionId === 'string' && typeof parentId === 'string' ? { type: 'child', sessionId, parentId } : null
  }
  const sessionId = data?.sessionID
  if (typeof sessionId !== 'string') return null
  if (e.type === 'session.execution.started') return { type: 'exec-started', sessionId }
  if (ENDED.has(e.type)) return { type: 'exec-ended', sessionId, at: toIso(e.created) }
  return null
}

// HTTP bodies used on re-sync (research Q5). Responses usually come as { data: … }.
export function unwrap(body: unknown): unknown {
  const b = obj(body)
  return b && 'data' in b ? b.data : body
}

const ids = (list: unknown): string[] =>
  Array.isArray(list) ? list.map((x) => obj(x)?.id).filter((id): id is string => typeof id === 'string') : []

// GET /api/session?parentID=… → the children's ids.
export function childIds(body: unknown): string[] {
  const list = Array.isArray(body) ? body : obj(body)?.items
  return ids(list)
}

// info: GET /api/session/:id (null on 404, not started yet); active: GET /api/session/active;
// permissions, forms: GET /api/session/:id/permission and /form. Bodies already unwrapped.
export function snapshotOf(info: unknown, active: unknown, permissions: unknown, forms: unknown): SessionSnapshot {
  const i = obj(info)
  if (!i) return { running: false, idleAt: null, pending: [], children: [] }
  const idle = obj(i.time)?.idle
  const a = obj(active)
  return {
    running: typeof i.id === 'string' && !!a && i.id in a,
    idleAt: idle === undefined || idle === null ? null : toIso(idle),
    pending: [
      ...ids(permissions).map((id) => ({ id, kind: 'permission' as const })),
      ...ids(forms).map((id) => ({ id, kind: 'question' as const })),
    ],
    children: [],
  }
}

// File writes (research Q6, Q7). write/edit carry `path`; patch names its files in `patchText` headers.
const PATCH_HEADER = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm

export function patchPaths(text: unknown): string[] {
  return typeof text === 'string' ? [...text.matchAll(PATCH_HEADER)].map((m) => m[1].trim()) : []
}

function writePaths(name: unknown, input: unknown): string[] | null {
  const i = obj(input)
  if ((name === 'write' || name === 'edit') && typeof i?.path === 'string') return [i.path]
  if (name === 'patch') return patchPaths(i?.patchText)
  return null // read also has `path`: only these three write
}

// Tool events → `wrote` on success. Only input.started names the tool, only called has the
// parsed input, so both are held by call id until success or failure. One per stream.
export function toolWrites(): (raw: unknown) => AgentEvent | null {
  const calls = new Map<string, { name?: unknown; input?: unknown }>()
  return (raw) => {
    const e = obj(raw)
    const data = obj(e?.data)
    const id = data?.id
    if (typeof e?.type !== 'string' || !e.type.startsWith('session.tool.') || typeof id !== 'string') return null
    const call = calls.get(id) ?? {}
    if (e.type === 'session.tool.input.started') calls.set(id, { ...call, name: data?.name })
    else if (e.type === 'session.tool.called') calls.set(id, { ...call, input: data?.input })
    else if (e.type === 'session.tool.failed') calls.delete(id)
    else if (e.type === 'session.tool.success') {
      calls.delete(id)
      const paths = writePaths(call.name, call.input)
      const sessionId = data?.sessionID
      return paths?.length && typeof sessionId === 'string' ? { type: 'wrote', sessionId, paths } : null
    }
    return null
  }
}

// GET /api/session/:id/message items, newest first → the latest completed write/edit/patch's paths.
// A completed state has `content` and no `error`; running and streaming ones have no `content`.
export function lastWritesOf(messages: unknown[]): string[] | null {
  for (const m of messages) {
    const content = obj(m)?.content
    if (!Array.isArray(content)) continue
    for (let i = content.length - 1; i >= 0; i--) {
      const item = obj(content[i])
      const state = obj(item?.state)
      if (item?.type !== 'tool' || !state || 'error' in state) continue
      if (state.status !== 'completed' && !Array.isArray(state.content)) continue
      const paths = writePaths(item.name, state.input)
      if (paths?.length) return paths
    }
  }
  return null
}

// Context readings (OpenCode 2.0.20). A step's `tokens` is { input, output, reasoning, cache: { read, write } } with
// input and cache apart; the context is what the model was sent: input + cache, output excluded (as Claude's is).
// A session's own `tokens` is cumulative over every step, so it says nothing about the window.
export function contextTokens(tokens: unknown): number | null {
  const t = obj(tokens)
  const cache = obj(t?.cache)
  const parts = [t?.input, cache?.read, cache?.write].filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  const sum = parts.reduce((a, n) => a + n, 0)
  return sum > 0 ? sum : null // an unfinished step reports zeros
}

// A model as `providerID/id`, the key both the readings and the window table use.
export function modelKey(model: unknown): string | null {
  const m = obj(model)
  return typeof m?.providerID === 'string' && typeof m.id === 'string' ? `${m.providerID}/${m.id}` : null
}

export type TokenReading = Pick<ContextUsage, 'tokens' | 'model'>

// session.step.started names the model, session.step.ended carries the tokens; both are keyed by the assistant
// message, so the model is held until the step ends. One per stream.
export function contextTracker(): (raw: unknown) => (TokenReading & { sessionId: string }) | null {
  const models = new Map<string, string | null>()
  return (raw) => {
    const e = obj(raw)
    const data = obj(e?.data)
    const message = data?.assistantMessageID
    if (typeof message !== 'string') return null
    if (e?.type === 'session.step.started') models.set(message, modelKey(data?.model))
    else if (e?.type === 'session.step.ended') {
      const model = models.get(message) ?? null
      models.delete(message)
      const tokens = contextTokens(data?.tokens)
      if (tokens !== null && typeof data?.sessionID === 'string') return { sessionId: data.sessionID, tokens, model }
    } else if (e?.type === 'session.step.failed') models.delete(message)
    return null
  }
}

// GET /api/session/:id/message items, newest first → the latest finished assistant message's reading.
export function contextOfMessages(messages: unknown[]): TokenReading | null {
  for (const m of messages) {
    const msg = obj(m)
    if (msg?.type !== 'assistant') continue
    const tokens = contextTokens(msg.tokens)
    if (tokens !== null) return { tokens, model: modelKey(msg.model) }
  }
  return null
}

// GET /api/model (unwrapped) → each model's context window, by modelKey. The full window, not `limit.input`.
export function modelWindows(body: unknown): Map<string, number> {
  const out = new Map<string, number>()
  if (!Array.isArray(body)) return out
  for (const m of body) {
    const o = obj(m)
    const window = obj(o?.limit)?.context
    if (typeof o?.providerID === 'string' && typeof o.modelID === 'string' && typeof window === 'number' && window > 0) out.set(`${o.providerID}/${o.modelID}`, window)
  }
  return out
}
