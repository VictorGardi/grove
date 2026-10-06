import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HttpOpenCode, serviceFilePath, sseData } from './client'
import type { OcEvent } from './types'

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

const frame = (type: string, data: unknown = {}) => `data: ${JSON.stringify({ id: 'evt', type, created: 1, data })}\n\n`

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => boolean // true: handled

// A stand-in for the OpenCode service: /api/info, /api/event (held open), plus `extra` routes.
async function stub(password: string, o: { onEvent?: (res: http.ServerResponse) => void; extra?: Handler } = {}) {
  const requests: { url: string; auth: string | undefined }[] = []
  const streams = new Set<http.ServerResponse>()
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url ?? '', auth: req.headers.authorization })
    if (req.headers.authorization !== 'Basic ' + Buffer.from(`opencode:${password}`).toString('base64')) {
      res.writeHead(401).end()
    } else if (req.url === '/api/info') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: { version: '2.0.20' } }))
    } else if (req.url === '/api/event') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      streams.add(res)
      res.on('close', () => streams.delete(res))
      if (o.onEvent) o.onEvent(res)
      else res.write(frame('server.connected'))
    } else if (!o.extra?.(req, res)) res.writeHead(404).end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const close = () => new Promise<void>((r) => {
    for (const s of streams) s.destroy()
    server.close(() => r())
  })
  return { url, requests, streams, close }
}

function serviceFile(url: string, password: string, file?: string) {
  const f = file ?? path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-oc-')), 'service.json')
  fs.writeFileSync(f, JSON.stringify({ id: 'svc', version: '2.0.20', url, pid: 1, password }))
  return f
}

// Resolves once `n` events matching `pred` have arrived.
function collector() {
  const events: OcEvent[] = []
  const waiters: { pred: (e: OcEvent[]) => boolean; resolve: () => void }[] = []
  const onEvent = (e: OcEvent) => {
    events.push(e)
    for (const w of [...waiters]) if (w.pred(events)) { waiters.splice(waiters.indexOf(w), 1); w.resolve() }
  }
  const until = (pred: (e: OcEvent[]) => boolean, ms = 2000) => new Promise<void>((resolve, reject) => {
    if (pred(events)) return resolve()
    const t = setTimeout(() => reject(new Error(`timeout; got ${JSON.stringify(events)}`)), ms)
    waiters.push({ pred, resolve: () => { clearTimeout(t); resolve() } })
  })
  const count = (type: OcEvent['type']) => (es: OcEvent[]) => es.filter((e) => e.type === type).length
  return { events, onEvent, until, count }
}

describe('HttpOpenCode', () => {
  const cleanups: (() => unknown)[] = []
  afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c()
  })

  async function setup(password: string, o: Parameters<typeof stub>[1] = {}, opts: { retryMs?: number; silenceMs?: number } = {}) {
    const s = await stub(password, o)
    cleanups.push(s.close)
    const file = serviceFile(s.url, password)
    const client = new HttpOpenCode({ serviceFile: file, retryMs: 10, maxRetryMs: 20, watchMs: 20, ...opts })
    cleanups.push(() => client.stop())
    const c = collector()
    return { s, file, client, c }
  }

  it('authenticates and emits connected with the service version', async () => {
    const { s, client, c } = await setup('pw1')
    client.start(c.onEvent)
    await c.until((es) => c.count('connected')(es) >= 1)
    expect(c.events[0]).toEqual({ type: 'connected', version: '2.0.20' })
    const auth = 'Basic ' + Buffer.from('opencode:pw1').toString('base64')
    expect(s.requests.filter((r) => r.url === '/api/info' || r.url === '/api/event').every((r) => r.auth === auth)).toBe(true)
  })

  it('joins a frame split over two writes', async () => {
    const { client, c } = await setup('pw', {
      onEvent: (res) => {
        res.write(frame('server.connected'))
        const f = frame('session.execution.started', { sessionID: 'ses_a' })
        res.write(f.slice(0, 20))
        setTimeout(() => res.write(f.slice(20)), 20)
      },
    })
    client.start(c.onEvent)
    await c.until((es) => c.count('exec-started')(es) >= 1)
    expect(c.events.filter((e) => e.type === 'exec-started')).toEqual([{ type: 'exec-started', sessionId: 'ses_a' }])
  })

  it('emits disconnected when the stream ends, then reconnects', async () => {
    const { s, client, c } = await setup('pw')
    client.start(c.onEvent)
    await c.until((es) => c.count('connected')(es) >= 1)
    for (const r of s.streams) r.end()
    await c.until((es) => c.count('connected')(es) >= 2)
    expect(c.events.map((e) => e.type).slice(0, 3)).toEqual(['connected', 'disconnected', 'connected'])
  })

  it('drops a silent stream and reconnects', async () => {
    const { client, c } = await setup('pw', {}, { silenceMs: 50 })
    client.start(c.onEvent)
    await c.until((es) => c.count('connected')(es) >= 2)
    expect(c.events.map((e) => e.type).slice(0, 3)).toEqual(['connected', 'disconnected', 'connected'])
  })

  it('follows a service.json change without waiting for the retry', async () => {
    const { s, file, client, c } = await setup('pw', {}, { retryMs: 60000 })
    client.start(c.onEvent)
    await c.until((es) => c.count('connected')(es) >= 1)
    const next = await stub('pw2')
    cleanups.push(next.close)
    await s.close()
    serviceFile(next.url, 'pw2', file)
    await c.until((es) => c.count('connected')(es) >= 2)
    expect(next.requests.some((r) => r.url === '/api/event')).toBe(true)
  })

  it('snapshots sessions, their children and unknown ones', async () => {
    const json = (res: http.ServerResponse, body: unknown) =>
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: body }))
    const routes: Record<string, unknown> = {
      '/api/session/active': { ses_a: { type: 'running' } },
      '/api/session/ses_a': { id: 'ses_a', time: { created: 1, idle: 1791194400000 } },
      '/api/session/ses_a/permission': [{ id: 'per_1' }],
      '/api/session/ses_a/form': [{ id: 'frm_1' }],
      '/api/session?parentID=ses_a': [{ id: 'ses_c', parentID: 'ses_a' }],
      '/api/session/ses_c': { id: 'ses_c', parentID: 'ses_a', time: { created: 1 } },
      '/api/session/ses_c/permission': [],
      '/api/session/ses_c/form': [{ id: 'frm_2' }],
      '/api/session?parentID=ses_c': [],
    }
    const { client, c } = await setup('pw', {
      extra: (req, res) => (req.url! in routes ? (json(res, routes[req.url!]), true) : false),
    })
    await expect(client.snapshot(['ses_a'])).rejects.toThrow('not connected')
    client.start(c.onEvent)
    await c.until((es) => c.count('connected')(es) >= 1)
    const snaps = await client.snapshot(['ses_a', 'ses_new'])
    expect(snaps).toEqual(new Map([
      ['ses_a', {
        running: true,
        idleAt: new Date(1791194400000).toISOString(),
        pending: [{ id: 'per_1', kind: 'permission' }, { id: 'frm_1', kind: 'question' }],
        children: ['ses_c'],
      }],
      ['ses_c', { running: false, idleAt: null, pending: [{ id: 'frm_2', kind: 'question' }], children: [] }],
      ['ses_new', { running: false, idleAt: null, pending: [], children: [] }],
    ]))
  })

  it('makes no requests after stop', async () => {
    const { s, client, c } = await setup('pw')
    client.start(c.onEvent)
    await c.until((es) => c.count('connected')(es) >= 1)
    client.stop()
    await new Promise((r) => setTimeout(r, 30))
    const n = s.requests.length
    await new Promise((r) => setTimeout(r, 100))
    expect(s.requests.length).toBe(n)
  })
})
