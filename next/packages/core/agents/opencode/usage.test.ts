import { describe, expect, it } from 'vitest'
import type { ContextUsage } from '../../../protocol/messages.ts'
import { createOpencodeUsageSource, usageFromContext } from './usage.ts'

// These tests pin the OpenCode usage source (slice 3 of agent-session-context) to the shapes observed on the
// shared service (research 02, plan slice 3):
// - `GET /api/session/<sessionId>/context` returns an array of entries (bare or wrapped in `{ data: [...] }`):
//   assistant messages plus session-level compaction/idle entries that must never become readings. A completed
//   assistant message carries `time.completed` (epoch ms) and `tokens.input`/`tokens.cache.read`/`tokens.cache.write`;
//   an in-flight one carries neither `time.completed` nor usable tokens.
// - `GET /api/model` returns the catalog array (same wrap); the window is the matched entry's `limit.context`
//   (matched by `providerID` + model id), labeled a model limit.
// The reading is the newest completed assistant message: an in-flight one is skipped, so the last completed request
// stays the reading until the next one completes. Polls are driven by explicit `drain()` calls: creating a source fetches nothing, and
// `close()` only stops the adapter's background timer. Like the Copilot sibling, `percent` stays null — the window
// is the model limit and the UI computes the ratio — but unlike Copilot, `at` is OpenCode's own `time.completed`.

const SESSION_A = 'ses_open_a'
const SESSION_B = 'ses_open_b'

const AT_A = Date.parse('2026-11-07T20:30:28.702Z')
const AT_B = Date.parse('2026-11-07T21:15:10.123Z')

// One assistant message's token field, shaped like OpenCode writes it.
const tok = (input: unknown, read: unknown, write: unknown) => ({ input, cache: { read, write } })

// One context entry for a completed or in-flight assistant message. `completed` omitted means in-flight. The live
// entries carry the kind in `type` (assistant/user/synthetic/idle), not `role`.
const assistant = (
  id: string,
  providerID: string,
  modelID: string,
  options: { created: number; completed?: number; tokens?: unknown },
) => ({
  id,
  type: 'assistant',
  time: { created: options.created, ...(options.completed === undefined ? {} : { completed: options.completed }) },
  ...(options.tokens === undefined ? {} : { tokens: options.tokens }),
  model: { providerID, id: modelID },
})

const compaction = (id: string, created: number) => ({ id, type: 'compaction', time: { created } })
const idle = (id: string) => ({ id, type: 'idle' })

// One `/api/model` catalog entry; omit `context` to get a `limit` without a usable window.
const modelEntry = (providerID: string, id: string, context?: unknown) => ({
  id,
  providerID,
  limit: { output: 32_000, ...(context === undefined ? {} : { context }) },
})

const fullCatalog = [
  modelEntry('anthropic', 'claude-sonnet-4-5', 200_000),
  // Same model id under another provider, so matching must take the providerID into account.
  modelEntry('grove-fake', 'claude-sonnet-4-5', 4_000),
  modelEntry('openai', 'gpt-5.2-codex', 400_000),
]

const MSG_A = () =>
  assistant('msg-a', 'anthropic', 'claude-sonnet-4-5', {
    created: AT_A - 60_000,
    completed: AT_A,
    tokens: tok(18_106, 10_464, 7_639),
  })

const MSG_B = () =>
  assistant('msg-b', 'openai', 'gpt-5.2-codex', {
    created: AT_B - 45_000,
    completed: AT_B,
    tokens: tok(9_123, 1_211, 204),
  })

// Session A's reading: tokens are the exact sum of the reported input and cache components, the window is the
// matched catalog limit (anthropic, not grove-fake), the model is the message's model id, and `at` is
// `time.completed` — not a poll time. Session B's reading likewise.
const READING_A = { tokens: 18_106 + 10_464 + 7_639, window: 200_000, percent: null, model: 'claude-sonnet-4-5', at: AT_A }
const READING_B = { tokens: 9_123 + 1_211 + 204, window: 400_000, percent: null, model: 'gpt-5.2-codex', at: AT_B }

// A plainly completed message used by the refusal tests, with a small token sum that cannot be confused with
// any of the other fixtures.
const completedWith = (providerID: string, modelID: string) =>
  assistant(`msg-${providerID}-${modelID}`, providerID, modelID, {
    created: AT_A - 60_000,
    completed: AT_A,
    tokens: tok(4, 3, 2),
  })

// Starts a source against fake bodies and records every fetch path. `fail` rejects every request while true,
// the outage case. Body getters are closures so tests can swap them between polls.
const startSource = (
  sessionId: string,
  context: () => unknown,
  models: () => unknown,
  fail?: () => boolean,
) => {
  const paths: string[] = []
  const seen: Array<ContextUsage | null> = []
  const source = createOpencodeUsageSource({
    sessionId,
    fetchJson: async (path: string) => {
      paths.push(path)
      if (fail?.()) throw new Error(`openapi down for ${path}`)
      if (path === '/api/model') return models()
      if (path === `/api/session/${sessionId}/context`) return context()
      throw new Error(`unexpected api path ${path}`)
    },
    onContext: (c) => seen.push(c),
  })
  return {
    seen,
    paths,
    drain: () => source.drain(),
    close: () => source.close(),
    count: (path: string) => paths.filter((p) => p === path).length,
  }
}

describe('usageFromContext', () => {
  it('reads the newest completed message: summed tokens, matched model limit, model id and completion time', () => {
    const context = [
      assistant('msg-old', 'anthropic', 'claude-sonnet-4-5', {
        created: AT_A - 90_000,
        completed: AT_A - 90_000,
        tokens: tok(1_000, 10, 1),
      }),
      MSG_A(),
      // Session-level entries may be newer than the newest message; they are skipped, never readings.
      compaction('comp-1', AT_A + 5_000),
      idle('idle-1'),
    ]
    expect(usageFromContext(context, fullCatalog)).toEqual(READING_A)
  })

  it('reads bodies wrapped in the service { data: [...] } envelope, as the live API sends them', () => {
    expect(usageFromContext({ data: [MSG_A()] }, { data: fullCatalog })).toEqual(READING_A)
  })

  it('matches the catalog entry by providerID and model id together', () => {
    const catalog = [
      modelEntry('anthropic', 'claude-sonnet-4-5', 200_000),
      modelEntry('grove-fake', 'claude-sonnet-4-5', 4_000),
    ]
    expect(
      usageFromContext([assistant('msg-a', 'anthropic', 'claude-sonnet-4-5', { created: AT_A - 60_000, completed: AT_A, tokens: tok(2, 0, 0) })], catalog)?.window,
    ).toBe(200_000)
    expect(
      usageFromContext([assistant('msg-b', 'grove-fake', 'claude-sonnet-4-5', { created: AT_A - 60_000, completed: AT_A, tokens: tok(2, 0, 0) })], catalog)?.window,
    ).toBe(4_000)
  })

  it('keeps the last completed reading while a newer request is still in flight', () => {
    const done = assistant('msg-done', 'anthropic', 'claude-sonnet-4-5', { created: AT_A - 120_000, completed: AT_A, tokens: tok(2, 0, 0) })
    const inFlight = assistant('msg-live', 'anthropic', 'claude-sonnet-4-5', { created: AT_B, tokens: tok(9, 9, 9) })
    expect(usageFromContext([done, inFlight], fullCatalog)).toMatchObject({ tokens: 2, at: AT_A })
  })

  it('is null for an in-flight message: no or zero time.completed, or no tokens', () => {
    const tokens = tok(3, 2, 1)
    // No time.completed: OpenCode has not finished this model request.
    expect(
      usageFromContext([assistant('msg-f1', 'anthropic', 'claude-sonnet-4-5', { created: AT_A - 60_000, tokens })], fullCatalog),
    ).toBeNull()
    expect(
      usageFromContext([assistant('msg-f2', 'anthropic', 'claude-sonnet-4-5', { created: AT_A - 60_000, completed: 0, tokens })], fullCatalog),
    ).toBeNull()
    // Completed, but no usable tokens yet.
    expect(
      usageFromContext([assistant('msg-f3', 'anthropic', 'claude-sonnet-4-5', { created: AT_A - 60_000, completed: AT_A })], fullCatalog),
    ).toBeNull()
    expect(
      usageFromContext([assistant('msg-f4', 'anthropic', 'claude-sonnet-4-5', { created: AT_A - 60_000, completed: AT_A, tokens: null })], fullCatalog),
    ).toBeNull()
  })

  it('is null when any token component is missing or not a finite number', () => {
    const at = AT_A - 60_000
    expect(
      usageFromContext([assistant('msg-f5', 'anthropic', 'claude-sonnet-4-5', { created: at, completed: AT_A, tokens: { input: 5, cache: { read: 1 } } })], fullCatalog),
    ).toBeNull()
    expect(
      usageFromContext([assistant('msg-f6', 'anthropic', 'claude-sonnet-4-5', { created: at, completed: AT_A, tokens: tok(Number.POSITIVE_INFINITY, 1, 1) })], fullCatalog),
    ).toBeNull()
    expect(
      usageFromContext([assistant('msg-f7', 'anthropic', 'claude-sonnet-4-5', { created: at, completed: AT_A, tokens: tok(Number.NaN, 1, 1) })], fullCatalog),
    ).toBeNull()
    expect(
      usageFromContext([assistant('msg-f8', 'anthropic', 'claude-sonnet-4-5', { created: at, completed: AT_A, tokens: tok('100', 1, 1) })], fullCatalog),
    ).toBeNull()
  })

  it('is null when the model is absent from the catalog or its limit.context is unusable', () => {
    // A model the catalog does not list: withhold rather than show a guessed window.
    expect(usageFromContext([completedWith('zap', 'gone-9')], fullCatalog)).toBeNull()
    // A matched entry whose limit has no context, a non-number context, or no limit at all.
    expect(usageFromContext([completedWith('glitch', 'phantom-x')], [modelEntry('glitch', 'phantom-x')])).toBeNull()
    expect(usageFromContext([completedWith('glitch', 'phantom-x')], [modelEntry('glitch', 'phantom-x', '200k')])).toBeNull()
    expect(usageFromContext([completedWith('glitch', 'phantom-x')], [{ id: 'phantom-x', providerID: 'glitch', limit: null }])).toBeNull()
  })

  it('is null with no assistant messages to read and for bodies that are not the expected shape', () => {
    // Only session-level entries: nothing has been measured yet.
    expect(usageFromContext([compaction('comp-1', AT_A), idle('idle-1')], fullCatalog)).toBeNull()
    expect(usageFromContext([], fullCatalog)).toBeNull()
    expect(usageFromContext({ messages: [] }, fullCatalog)).toBeNull()
    expect(usageFromContext('not the context body', fullCatalog)).toBeNull()
    expect(usageFromContext([completedWith('anthropic', 'claude-sonnet-4-5')], 'not the catalog')).toBeNull()
  })
})

describe('createOpencodeUsageSource', () => {
  it('keeps two concurrent sessions apart, each delivering only its own reading', async () => {
    const paths: string[] = []
    // One fetch, keyed by path: the context path names the exact session, so the two sources cannot collide.
    const fetchJson = async (path: string) => {
      paths.push(path)
      if (path === `/api/session/${SESSION_A}/context`) return [MSG_A()]
      if (path === `/api/session/${SESSION_B}/context`) return [MSG_B()]
      if (path === '/api/model') return fullCatalog
      throw new Error(`unexpected api path ${path}`)
    }
    const seenA: Array<ContextUsage | null> = []
    const seenB: Array<ContextUsage | null> = []
    const sourceA = createOpencodeUsageSource({ sessionId: SESSION_A, fetchJson, onContext: (c) => seenA.push(c) })
    const sourceB = createOpencodeUsageSource({ sessionId: SESSION_B, fetchJson, onContext: (c) => seenB.push(c) })
    await sourceA.drain()
    await sourceB.drain()
    sourceA.close()
    sourceB.close()
    // Distinct tokens, windows, models and completion times; each spy receives only its own session's numbers.
    expect(seenA).toEqual([READING_A])
    expect(seenB).toEqual([READING_B])
    expect(paths).toContain(`/api/session/${SESSION_A}/context`)
    expect(paths).toContain(`/api/session/${SESSION_B}/context`)
  })

  it('stamps the reading with the message completion time, never the poll time, and does not re-deliver it unchanged', async () => {
    let body: unknown = [MSG_A()]
    const api = startSource(SESSION_A, () => body, () => fullCatalog)
    await api.drain()
    // `at` is the fixture's time.completed: there is no clock injection in these tests, so any poll time would
    // show up as `not AT_A`.
    expect(api.seen).toEqual([READING_A])
    await api.drain()
    // The same data later delivers nothing again: the saved reading, with its original time, stands.
    expect(api.seen).toEqual([READING_A])
    api.close()
  })

  it('delivers nothing, not even null, before any message has completed', async () => {
    let body: unknown = [
      assistant('msg-early', 'anthropic', 'claude-sonnet-4-5', { created: AT_A - 60_000 }),
      compaction('comp-1', AT_A - 30_000),
      idle('idle-1'),
    ]
    const api = startSource(SESSION_A, () => body, () => fullCatalog)
    await api.drain()
    // No completed request yet: no reading, and no clearing either — nothing was ever delivered.
    expect(api.seen).toEqual([])
    body = [compaction('comp-1', AT_A - 30_000), MSG_A(), idle('idle-1')]
    await api.drain()
    expect(api.seen).toEqual([READING_A])
    api.close()
  })

  it('delivers null when the delivered reading stops being supported: the model is missing from the catalog', async () => {
    let body: unknown = [MSG_A()]
    const api = startSource(SESSION_A, () => body, () => fullCatalog)
    await api.drain()
    expect(api.seen).toEqual([READING_A])
    // The session moves to a model the freshly fetched catalog does not list. The poll refetches the catalog
    // (the model is not the one already matched), finds nothing for it, and clears the stale numbers.
    body = [assistant('msg-gone', 'zap', 'gone-9', { created: AT_A + 60_000, completed: AT_A + 60_000, tokens: tok(300, 40, 5) })]
    await api.drain()
    expect(api.seen).toEqual([READING_A, null])
    // The original model is still in the catalog cache, so bringing its message back delivers the reading again.
    body = [MSG_A()]
    await api.drain()
    expect(api.seen).toEqual([READING_A, null, READING_A])
    api.close()
  })

  it('keeps the last completed reading through drain while a newer message is in flight', async () => {
    let body: unknown = [MSG_A()]
    const api = startSource(SESSION_A, () => body, () => fullCatalog)
    await api.drain()
    expect(api.seen).toEqual([READING_A])
    // A newer assistant message is in flight: no time.completed, no tokens. The badge keeps the last completed request.
    body = [MSG_A(), assistant('msg-next', 'anthropic', 'claude-sonnet-4-5', { created: AT_A + 60_000 })]
    await api.drain()
    expect(api.seen).toEqual([READING_A])
    api.close()
  })

  it('keeps the saved reading through an outage and re-delivers only when the message changes', async () => {
    let body: unknown = [MSG_A()]
    let down = false
    const api = startSource(SESSION_A, () => body, () => fullCatalog, () => down)
    await api.drain()
    expect(api.seen).toEqual([READING_A])
    down = true
    await api.drain()
    // The outage delivers nothing and leaves the saved reading untouched: no re-stamp, no clear.
    expect(api.seen).toEqual([READING_A])
    down = false
    await api.drain()
    // The same message as before the outage: nothing is re-delivered, and the original completion time stands.
    expect(api.seen).toEqual([READING_A])
    body = [
      MSG_A(),
      assistant('msg-new', 'anthropic', 'claude-sonnet-4-5', {
        created: AT_A + 60_000,
        completed: AT_B,
        tokens: tok(1_000, 2_000, 3_000),
      }),
    ]
    await api.drain()
    // A newer, different message after the outage is delivered.
    expect(api.seen).toEqual([
      READING_A,
      { tokens: 6_000, window: 200_000, percent: null, model: 'claude-sonnet-4-5', at: AT_B },
    ])
    api.close()
  })

  it('fetches the catalog at the first poll and only again for a newly seen model', async () => {
    let body: unknown = [
      assistant('msg-1', 'anthropic', 'claude-sonnet-4-5', { created: AT_A - 60_000, completed: AT_A, tokens: tok(10, 1, 1) }),
    ]
    let catalogBody: unknown[] = fullCatalog
    const api = startSource(SESSION_A, () => body, () => catalogBody)
    await api.drain()
    expect(api.seen.map((c) => c?.tokens)).toEqual([12])
    await api.drain()
    await api.drain()
    // Same model in later polls: no catalog refetch, and an unchanged reading delivers nothing.
    body = [
      assistant('msg-1', 'anthropic', 'claude-sonnet-4-5', { created: AT_A - 60_000, completed: AT_A, tokens: tok(10, 1, 1) }),
      assistant('msg-2', 'anthropic', 'claude-sonnet-4-5', { created: AT_A + 30_000, completed: AT_A + 30_000, tokens: tok(20, 2, 2) }),
    ]
    await api.drain()
    expect(api.seen.map((c) => c?.tokens)).toEqual([12, 24])
    // A poll whose newest message uses a model the cached catalog does not name yet triggers exactly one additional
    // catalog fetch — and the refetched catalog now lists it, so the reading still comes.
    catalogBody = [...catalogBody, modelEntry('deepseek', 'dsn-v3', 160_000)]
    body = [
      assistant('msg-1', 'anthropic', 'claude-sonnet-4-5', { created: AT_A - 60_000, completed: AT_A, tokens: tok(10, 1, 1) }),
      assistant('msg-2', 'anthropic', 'claude-sonnet-4-5', { created: AT_A + 30_000, completed: AT_A + 30_000, tokens: tok(20, 2, 2) }),
      assistant('msg-3', 'deepseek', 'dsn-v3', { created: AT_A + 90_000, completed: AT_A + 90_000, tokens: tok(300, 0, 0) }),
    ]
    await api.drain()
    expect(api.seen.map((c) => c?.tokens)).toEqual([12, 24, 300])
    expect(api.count(`/api/session/${SESSION_A}/context`)).toBe(5)
    expect(api.count('/api/model')).toBe(2)
    api.close()
  })

  it('serialises polls and delivers nothing after close', async () => {
    // The context fetch stalls until the test lets it through, so the first drain is genuinely in flight.
    let active = 0
    let maxActive = 0
    const gateBox: { release: ((value?: void) => void) | null } = { release: null }
    let body: unknown = [MSG_A()]
    const paths: string[] = []
    const seen: Array<ContextUsage | null> = []
    const source = createOpencodeUsageSource({
      sessionId: SESSION_A,
      fetchJson: async (path: string) => {
        paths.push(path)
        active += 1
        maxActive = Math.max(maxActive, active)
        try {
          if (path === '/api/model') return fullCatalog
          if (path === `/api/session/${SESSION_A}/context`) {
            await new Promise<void>((resolve) => { gateBox.release = resolve })
            return body
          }
          throw new Error(`unexpected api path ${path}`)
        } finally {
          active -= 1
        }
      },
      onContext: (c) => seen.push(c),
    })
    // While the first drain waits on the network, further polls must not overlap it.
    const first = source.drain()
    await source.drain()
    gateBox.release?.()
    await first
    expect(seen).toEqual([READING_A])
    expect(maxActive).toBe(1)
    expect(paths.filter((p) => p === `/api/session/${SESSION_A}/context`)).toHaveLength(1)
    // After close(), a drain neither fetches nor delivers.
    source.close()
    body = [
      assistant('msg-after-close', 'anthropic', 'claude-sonnet-4-5', { created: AT_B - 60_000, completed: AT_B, tokens: tok(1, 0, 0) }),
    ]
    gateBox.release = null
    await source.drain()
    expect(seen).toEqual([READING_A])
    expect(paths.filter((p) => p === `/api/session/${SESSION_A}/context`)).toHaveLength(1)
  })
})
