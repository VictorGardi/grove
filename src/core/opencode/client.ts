import fs from 'node:fs'
import path from 'node:path'
import { childIds, lastWritesOf, normalise, snapshotOf, toolWrites, unwrap } from './normalise'
import type { AgentEvent, AgentSource, SessionSnapshot } from '../agents/types'
import { mintSessionId } from '../opencodeId'

// The shared OpenCode service's registration file. Holds a password: never log or push it.
export function serviceFilePath(env: NodeJS.ProcessEnv, home: string): string {
  return path.join(env.XDG_STATE_HOME || path.join(home, '.local', 'state'), 'opencode', 'service.json')
}

// Complete SSE blocks → their joined `data:` payloads; the unfinished tail stays in `rest`.
export function sseData(buffer: string): { frames: string[]; rest: string } {
  const blocks = buffer.replace(/\r\n/g, '\n').split('\n\n')
  const rest = blocks.pop() ?? ''
  const frames: string[] = []
  for (const block of blocks) {
    const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, ''))
    if (data.length) frames.push(data.join('\n'))
  }
  return { frames, rest }
}

interface ClientOptions {
  serviceFile: string
  retryMs?: number // first reconnect delay, doubling up to maxRetryMs; default 1000
  maxRetryMs?: number // default 10000
  silenceMs?: number // drop a stream with no bytes for this long (heartbeat is 15 s); default 45000
  watchMs?: number // service.json poll interval; default 1000
}

export class HttpOpenCode implements AgentSource {
  readonly kind = 'opencode' as const
  readonly statusNeedsEvent = false
  private abort: AbortController | null = null
  private wake: (() => void) | null = null
  private svc: { url: string; headers: Record<string, string> } | null = null // while connected
  private stopped = false
  private kicked = false // service.json changed: reconnect without waiting
  private readonly kick = () => {
    this.kicked = true
    this.abort?.abort()
    this.wake?.()
  }

  constructor(private readonly o: ClientOptions) {}

  mintId(now: Date): string {
    return mintSessionId(now.getTime())
  }

  argv(id: string, _mode: 'start' | 'resume'): string[] {
    return ['opencode', '-s', id] // resume is the same: -s picks up the session's history
  }

  forget(_id: string): void {} // OpenCode keeps its own sessions

  start(onEvent: (e: AgentEvent) => void): void {
    fs.watchFile(this.o.serviceFile, { interval: this.o.watchMs ?? 1000 }, this.kick)
    void this.loop(onEvent)
  }

  stop(): void {
    this.stopped = true
    fs.unwatchFile(this.o.serviceFile, this.kick)
    this.kick()
  }

  // A JSON body from the connected service; null on 404.
  private async get(p: string): Promise<unknown> {
    const svc = this.svc
    if (!svc) throw new Error('not connected')
    const res = await fetch(new URL(p, svc.url), { headers: svc.headers, signal: AbortSignal.timeout(5000) })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`${p.split('?')[0]} ${res.status}`)
    return res.json()
  }

  async snapshot(ids: string[]): Promise<Map<string, SessionSnapshot>> {
    const get = async (p: string) => unwrap(await this.get(p))
    const active = await get('/api/session/active')
    // null: OpenCode doesn't know the session yet (404 until its first prompt)
    const one = async (id: string): Promise<SessionSnapshot | null> => {
      const base = `/api/session/${encodeURIComponent(id)}`
      const info = await get(base)
      return info === null ? null : snapshotOf(info, active, (await get(`${base}/permission`)) ?? [], (await get(`${base}/form`)) ?? [])
    }
    const blank = () => snapshotOf(null, null, null, null)
    const out = new Map<string, SessionSnapshot>()
    for (const id of ids) {
      const snap = await one(id)
      out.set(id, snap ?? blank())
      if (!snap) continue
      snap.children = childIds(await get(`/api/session?parentID=${encodeURIComponent(id)}`))
      for (const child of snap.children) out.set(child, (await one(child)) ?? blank())
    }
    return out
  }

  async lastWrites(id: string): Promise<string[]> {
    const base = `/api/session/${encodeURIComponent(id)}/message`
    let query = '?limit=200' // newest first
    for (let page = 0; page < 5; page++) {
      const body = (await this.get(base + query)) as { data?: unknown; cursor?: { next?: unknown } } | null
      if (!body || !Array.isArray(body.data) || body.data.length === 0) return []
      const paths = lastWritesOf(body.data)
      if (paths) return paths
      const next = body.cursor?.next
      if (typeof next !== 'string') return []
      query = `?cursor=${encodeURIComponent(next)}&limit=200` // the cursor carries the order
    }
    return []
  }

  // Waits ms, or less if kick() fires.
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(() => this.wake?.(), ms)
      this.wake = () => {
        clearTimeout(t)
        this.wake = null
        resolve()
      }
    })
  }

  private async loop(onEvent: (e: AgentEvent) => void): Promise<void> {
    const min = this.o.retryMs ?? 1000
    let delay = min
    while (!this.stopped) {
      let connected = false
      try {
        await this.stream((e) => {
          if (e.type === 'connected') connected = true
          onEvent(e)
        })
      } catch {
        // missing file, service down, auth, network error or silence: retried below
      }
      this.svc = null
      if (connected) onEvent({ type: 'disconnected' })
      if (this.stopped) break
      if (connected) delay = min
      if (!this.kicked) await this.sleep(delay)
      this.kicked = false
      if (!connected) delay = Math.min(delay * 2, this.o.maxRetryMs ?? 10000)
    }
  }

  private async stream(onEvent: (e: AgentEvent) => void): Promise<void> {
    const abort = (this.abort = new AbortController())
    const { url, password } = JSON.parse(fs.readFileSync(this.o.serviceFile, 'utf8')) as { url: string; password: string }
    const headers = { authorization: 'Basic ' + Buffer.from(`opencode:${password}`).toString('base64') }
    const info = await fetch(new URL('/api/info', url), { headers, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(2000)]) })
    if (!info.ok) throw new Error(`info ${info.status}`)
    const body = (await info.json()) as { version?: string; data?: { version?: string } }
    const version = body.data?.version ?? body.version ?? ''

    const res = await fetch(new URL('/api/event', url), {
      headers: { ...headers, accept: 'text/event-stream' },
      signal: abort.signal,
    })
    if (!res.ok || !res.body) throw new Error(`event ${res.status}`)
    this.svc = { url, headers }
    const tools = toolWrites()
    let silence = setTimeout(() => abort.abort(), this.o.silenceMs ?? 45000)
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for await (const chunk of res.body) {
        clearTimeout(silence)
        silence = setTimeout(() => abort.abort(), this.o.silenceMs ?? 45000)
        const { frames, rest } = sseData(buffer + decoder.decode(chunk, { stream: true }))
        buffer = rest
        for (const frame of frames) {
          let raw: unknown
          try {
            raw = JSON.parse(frame)
          } catch {
            continue
          }
          const e = normalise(raw, version) ?? tools(raw)
          if (e) onEvent(e)
        }
      }
    } finally {
      clearTimeout(silence)
    }
  }
}
