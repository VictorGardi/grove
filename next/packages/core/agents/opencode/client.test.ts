import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { StatusEvent } from '../../status/contract.ts'
import { afterEach, describe, expect, it } from 'vitest'
import { createOpenCodeHub, serviceFilePath, sseData, type Fetch, type OpenCodeHub } from './hub.ts'

describe('sseData', () => {
  it('splits data frames and keeps a partial one', () => {
    expect(sseData('data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c"')).toEqual({
      frames: ['{"a":1}', '{"b":2}'],
      rest: 'data: {"c"',
    })
  })

  it('skips comment blocks such as the heartbeat', () => {
    expect(sseData(': heartbeat\n\ndata: x\n\n')).toEqual({ frames: ['x'], rest: '' })
  })

  it('handles CRLF and joins multi-line data', () => {
    expect(sseData('data: a\r\ndata: b\r\n\r\n')).toEqual({ frames: ['a\nb'], rest: '' })
  })
})

describe('serviceFilePath', () => {
  it('uses XDG_STATE_HOME when set, else ~/.local/state', () => {
    expect(serviceFilePath({ XDG_STATE_HOME: '/x' }, '/home/u')).toBe('/x/opencode/service.json')
    expect(serviceFilePath({}, '/home/u')).toBe('/home/u/.local/state/opencode/service.json')
  })
})

// A stand-in for the OpenCode service behind an injected fetch: /api/info, /api/event (held open by the test),
// and the session routes. No network, no real opencode.
const PASSWORD = 'pw1'
const json = (body: unknown) => new Response(JSON.stringify({ data: body }), { status: 200, headers: { 'content-type': 'application/json' } })

function fakeService(routes: Record<string, unknown> = {}) {
  const requests: { path: string; auth: string | undefined }[] = []
  const streams: { push: (text: string) => void; end: () => void }[] = []
  const service = { password: PASSWORD, routes, requests, streams, fetch: null as unknown as Fetch }
  service.fetch = async (input, init) => {
    const url = new URL(input)
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization
    requests.push({ path: url.pathname, auth })
    if (auth !== 'Basic ' + Buffer.from(`opencode:${service.password}`).toString('base64')) return new Response(null, { status: 401 })
    if (url.pathname === '/api/info') return json({ version: '2.0.20' })
    if (url.pathname === '/api/event') {
      const enc = new TextEncoder()
      let controller!: ReadableStreamDefaultController<Uint8Array>
      const body = new ReadableStream<Uint8Array>({ start: (c) => { controller = c } })
      init?.signal?.addEventListener('abort', () => { try { controller.error(new Error('aborted')) } catch { /* already closed */ } })
      streams.push({
        push: (text) => controller.enqueue(enc.encode(text)),
        end: () => { try { controller.close() } catch { /* already closed */ } },
      })
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    if (url.pathname in service.routes) return json(service.routes[url.pathname])
    return new Response(null, { status: 404 })
  }
  return service
}

const frame = (type: string, data: unknown = {}) => `data: ${JSON.stringify({ id: 'evt', type, created: 1791194400000, data })}\n\n`
const ses = (id: string) => ({ sessionID: id })

// Resolves once `pred` holds, polling; rejects after ms.
async function until(pred: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('timeout')
    await new Promise((r) => setTimeout(r, 5))
  }
}

describe('OpenCode hub', () => {
  const hubs: OpenCodeHub[] = []
  afterEach(() => {
    for (const hub of hubs.splice(0)) hub.stop()
  })

  function setup(routes: Record<string, unknown> = {}, o: { silenceMs?: number; retryMs?: number; maxRetryMs?: number } = {}) {
    const service = fakeService(routes)
    const hub = createOpenCodeHub({
      serviceFile: '/unused/service.json',
      readFile: () => JSON.stringify({ url: 'http://opencode.test', password: service.password }),
      fetch: service.fetch,
      retryMs: 5,
      maxRetryMs: 10,
      // The service file is not polled in these tests: a poll of a file that is not there would drop the stream.
      watchMs: 600000,
      ...o,
    })
    hubs.push(hub)
    const now = 1000
    const watch = (sessionId: string) => {
      const events: { event: StatusEvent; at: number }[] = []
      const stop = hub.watch({ sessionId, clock: () => now, onEvent: (event, at) => events.push({ event, at }) })
      // Heartbeats are a read of bytes, not activity: the tests look at the rest.
      const kinds = () => events.filter((e) => e.event.kind !== 'heartbeat').map((e) => e.event)
      return { events, stop, kinds }
    }
    return { service, hub, watch }
  }

  it('connects with the password and routes nothing before any event', async () => {
    const { service, watch } = setup()
    const w = watch('ses_a')
    await until(() => service.streams.length >= 1)
    expect(service.requests.filter((r) => r.path === '/api/event').every((r) => r.auth !== undefined)).toBe(true)
    expect(w.kinds()).toEqual([])
    expect(JSON.stringify(w.events)).not.toContain(PASSWORD)
  })

  it('routes a live turn and its permission to the watch of its own session only', async () => {
    const { service, watch } = setup()
    const a = watch('ses_a')
    const other = watch('ses_other')
    await until(() => service.streams.length >= 1)
    service.streams[0].push(frame('session.execution.started', ses('ses_a')))
    service.streams[0].push(frame('permission.asked', { id: 'per_1', sessionID: 'ses_a' }))
    service.streams[0].push(frame('session.created', { sessionID: 'ses_c', parentID: 'ses_a' }))
    service.streams[0].push(frame('permission.replied', { sessionID: 'ses_a', requestID: 'per_1' }))
    service.streams[0].push(frame('session.execution.succeeded', ses('ses_a')))
    await until(() => a.kinds().length === 4)
    expect(a.kinds()).toEqual([
      { kind: 'working' },
      { kind: 'needs-you', reason: 'permission' },
      { kind: 'working' },
      { kind: 'finished' },
    ])
    expect(other.kinds()).toEqual([])
  })

  it('joins a frame split over two writes', async () => {
    const { service, watch } = setup()
    const w = watch('ses_a')
    await until(() => service.streams.length >= 1)
    const f = frame('session.execution.started', ses('ses_a'))
    service.streams[0].push(f.slice(0, 20))
    await new Promise((r) => setTimeout(r, 20))
    service.streams[0].push(f.slice(20))
    await until(() => w.kinds().length === 1)
    expect(w.kinds()).toEqual([{ kind: 'working' }])
  })

  it('sends a heartbeat for each read and never mistakes it for activity', async () => {
    const { service, watch } = setup()
    const w = watch('ses_a')
    await until(() => service.streams.length >= 1)
    service.streams[0].push(': heartbeat\n\n')
    await until(() => w.events.some((e) => e.event.kind === 'heartbeat'))
    expect(w.kinds()).toEqual([])
  })

  it('sends lost to every watch when the stream drops, then reconnects and re-syncs', async () => {
    const routes: Record<string, unknown> = { '/api/session/active': {}, '/api/session/ses_a': { id: 'ses_a', time: {} } }
    const { service, watch } = setup(routes)
    const a = watch('ses_a')
    const b = watch('ses_b')
    await until(() => service.streams.length >= 1)
    service.streams[0].push(frame('session.execution.started', ses('ses_a')))
    await until(() => a.kinds().length === 1)
    routes['/api/session/active'] = { ses_a: { type: 'running' } }
    service.streams[0].end()
    await until(() => service.streams.length >= 2)
    await until(() => a.kinds().length === 4)
    // The first connect re-syncs an idle session too: a fresh fold reads it as idle-prompt, as after a core restart.
    expect(a.kinds()).toEqual([{ kind: 'idle-prompt' }, { kind: 'working' }, { kind: 'lost' }, { kind: 'working' }])
    expect(b.kinds()).toEqual([{ kind: 'lost' }])
  })

  it('reads a turn that ended while disconnected as idle-prompt on re-sync', async () => {
    const routes: Record<string, unknown> = { '/api/session/active': {}, '/api/session/ses_a': { id: 'ses_a', time: {} } }
    const { service, watch } = setup(routes)
    const a = watch('ses_a')
    await until(() => service.streams.length >= 1)
    service.streams[0].push(frame('session.execution.started', ses('ses_a')))
    await until(() => a.kinds().length === 1)
    // The turn ends while nothing is connected: the re-sync finds the session no longer running.
    service.streams[0].end()
    await until(() => service.streams.length >= 2)
    await until(() => a.kinds().length === 4)
    expect(a.kinds()).toEqual([{ kind: 'idle-prompt' }, { kind: 'working' }, { kind: 'lost' }, { kind: 'idle-prompt' }])
  })

  it('re-syncs an open permission on connect for a watch added while connected', async () => {
    const routes = {
      '/api/session/active': {},
      '/api/session/ses_a': { id: 'ses_a', time: {} },
      '/api/session/ses_a/permission': [{ id: 'per_1' }],
    }
    const { service, watch } = setup(routes)
    watch('ses_other')
    await until(() => service.streams.length >= 1)
    const a = watch('ses_a')
    await until(() => a.kinds().length === 1)
    expect(a.kinds()).toEqual([{ kind: 'needs-you', reason: 'permission' }])
  })

  it('stays silent for a session OpenCode does not know yet', async () => {
    const { service, watch } = setup({ '/api/session/active': {} })
    const a = watch('ses_new')
    await until(() => service.streams.length >= 1)
    await new Promise((r) => setTimeout(r, 30))
    expect(a.kinds()).toEqual([])
  })

  it('drops a silent stream, which sends lost and reconnects', async () => {
    const { service, watch } = setup({}, { silenceMs: 50 })
    const a = watch('ses_a')
    await until(() => service.streams.length >= 2)
    expect(a.kinds()[0]).toEqual({ kind: 'lost' })
  })

  it('follows a service file change without waiting for the retry', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-oc-hub-'))
    const file = path.join(dir, 'service.json')
    fs.writeFileSync(file, JSON.stringify({ url: 'http://opencode.test', password: PASSWORD }))
    const service = fakeService()
    const hub = createOpenCodeHub({ serviceFile: file, fetch: service.fetch, retryMs: 60000, watchMs: 20 })
    hubs.push(hub)
    try {
      hub.watch({ sessionId: 'ses_a', clock: () => 0, onEvent: () => {} })
      await until(() => service.streams.length >= 1)
      service.password = 'pw2'
      fs.writeFileSync(file, JSON.stringify({ url: 'http://opencode.test', password: 'pw2' }))
      await until(() => service.streams.length >= 2)
      expect(service.requests.at(-1)?.auth).toBe('Basic ' + Buffer.from('opencode:pw2').toString('base64'))
    } finally {
      hub.stop()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('makes no requests after stop', async () => {
    const { service, hub, watch } = setup()
    watch('ses_a')
    await until(() => service.streams.length >= 1)
    hub.stop()
    await new Promise((r) => setTimeout(r, 30))
    const n = service.requests.length
    await new Promise((r) => setTimeout(r, 100))
    expect(service.requests.length).toBe(n)
  })

  it('stops a watch without touching the others', async () => {
    const { service, watch } = setup()
    const a = watch('ses_a')
    const b = watch('ses_a')
    await until(() => service.streams.length >= 1)
    a.stop()
    service.streams[0].push(frame('session.execution.started', ses('ses_a')))
    await until(() => b.kinds().length === 1)
    expect(a.kinds()).toEqual([])
  })
})
