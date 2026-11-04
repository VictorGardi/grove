import fs from 'node:fs'
import path from 'node:path'
import type { StatusEvent } from '../../status/contract.ts'
import { emptyFold, normalise, snapshotOf, statusFor, statusOfSnapshot, unwrap, type OpenCodeEvent, type OpenCodeFold } from './normalise.ts'

// The shared OpenCode service's registration file. Holds a password: never log it, never push it.
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

export type Fetch = (input: URL, init?: RequestInit) => Promise<Response>

export interface HubOptions {
  serviceFile: string
  fetch?: Fetch // default: the global fetch; tests inject one
  readFile?: (file: string) => string // default: utf8 read of the file
  retryMs?: number // first reconnect delay, doubling up to maxRetryMs; default 1000
  maxRetryMs?: number // default 10000
  silenceMs?: number // drop a stream with no bytes for this long (the service heartbeats every 15 s); default 45000
  watchMs?: number // service file poll interval; default 1000
}

// One tab's watch on one OpenCode session. The clock stamps the events that carry no time of their own.
export interface HubWatch {
  sessionId: string
  clock: () => number
  onEvent: (event: StatusEvent, at: number) => void
}

// One connection to the service, shared by every watch in the core.
export interface OpenCodeHub {
  // Returns a function that stops this watch. The first watch starts the connection.
  watch(watch: HubWatch): () => void
  stop(): void
}

interface Entry {
  input: HubWatch
  fold: OpenCodeFold
}

export function createOpenCodeHub(o: HubOptions): OpenCodeHub {
  const fetchFn: Fetch = o.fetch ?? ((input, init) => fetch(input, init))
  const readFile = o.readFile ?? ((file: string) => fs.readFileSync(file, 'utf8'))
  const minRetry = o.retryMs ?? 1000
  const maxRetry = o.maxRetryMs ?? 10000
  const silenceMs = o.silenceMs ?? 45000
  const entries = new Set<Entry>()
  let svc: { url: string; headers: Record<string, string> } | null = null // while connected
  let abort: AbortController | null = null
  let wake: (() => void) | null = null
  let started = false
  let stopped = false
  let kicked = false // service file changed: reconnect without waiting
  // The service file was rewritten: reconnect now, with the new registration. A poll that sees no change (or
  // a file that is not there yet) is not a rewrite, so it does not drop a healthy stream.
  const kick = (curr: fs.Stats, prev: fs.Stats) => {
    if (curr.mtimeMs === prev.mtimeMs && curr.size === prev.size && curr.ino === prev.ino) return
    kicked = true
    abort?.abort()
    wake?.()
  }

  // A JSON body from the connected service; null on 404.
  async function get(p: string): Promise<unknown> {
    if (!svc) throw new Error('not connected')
    const res = await fetchFn(new URL(p, svc.url), { headers: svc.headers, signal: AbortSignal.timeout(5000) })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`${p.split('?')[0]} ${res.status}`)
    return res.json()
  }

  // Re-sync: folds what OpenCode says now for each watched session, so a missed event or a turn that ended
  // while disconnected is not lost.
  async function resync(list: Entry[]): Promise<void> {
    if (list.length === 0) return
    const active = unwrap(await get('/api/session/active'))
    for (const entry of list) {
      const base = `/api/session/${encodeURIComponent(entry.input.sessionId)}`
      const info = unwrap(await get(base)) // null: OpenCode does not know the session yet (404 until its first prompt)
      const permissions = unwrap(await get(`${base}/permission`)) ?? []
      const forms = unwrap(await get(`${base}/form`)) ?? []
      const step = statusOfSnapshot(entry.fold, snapshotOf(info, active, permissions, forms))
      entry.fold = step.fold
      for (const event of step.events) entry.input.onEvent(event, entry.input.clock())
    }
  }

  // Routes one live event to the watch of its session. A subagent's event (its own session) is not this tab's.
  function route(e: OpenCodeEvent): void {
    if (e.type === 'connected' || e.type === 'child') return
    for (const entry of [...entries]) {
      if (entry.input.sessionId !== e.sessionId) continue
      const step = statusFor(entry.fold, e)
      entry.fold = step.fold
      // An ended execution carries the time it ended; every other event is stamped when it arrives.
      const at = e.type === 'exec-ended' ? Date.parse(e.at) : entry.input.clock()
      for (const event of step.events) entry.input.onEvent(event, at)
    }
  }

  // One connection: service file, info (for the version), event stream, re-sync, then the frames until it ends.
  // Throws on any failure; the loop retries.
  async function stream(onConnected: () => void): Promise<void> {
    const ctl = (abort = new AbortController())
    const { url, password } = JSON.parse(readFile(o.serviceFile)) as { url: string; password: string }
    const headers = { authorization: 'Basic ' + Buffer.from(`opencode:${password}`).toString('base64') }
    const info = await fetchFn(new URL('/api/info', url), { headers, signal: AbortSignal.any([ctl.signal, AbortSignal.timeout(2000)]) })
    if (!info.ok) throw new Error(`info ${info.status}`)
    const body = (await info.json()) as { version?: string; data?: { version?: string } }
    const version = body.data?.version ?? body.version ?? ''

    const res = await fetchFn(new URL('/api/event', url), { headers: { ...headers, accept: 'text/event-stream' }, signal: ctl.signal })
    if (!res.ok || !res.body) throw new Error(`event ${res.status}`)
    svc = { url, headers }
    onConnected()
    await resync([...entries])

    // A stream with no bytes for silenceMs is dropped, so a dead connection cannot look live.
    let silence = setTimeout(() => ctl.abort(), silenceMs)
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        clearTimeout(silence)
        silence = setTimeout(() => ctl.abort(), silenceMs)
        // Any byte means the service's reader is alive: a heartbeat, never activity.
        for (const entry of [...entries]) entry.input.onEvent({ kind: 'heartbeat' }, entry.input.clock())
        const { frames, rest } = sseData(buffer + decoder.decode(value, { stream: true }))
        buffer = rest
        for (const frame of frames) {
          let raw: unknown
          try {
            raw = JSON.parse(frame)
          } catch {
            continue
          }
          const e = normalise(raw, version)
          if (e) route(e)
        }
      }
    } finally {
      clearTimeout(silence)
    }
  }

  // Waits ms, or less if kick() fires.
  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(() => wake?.(), ms)
      wake = () => {
        clearTimeout(t)
        wake = null
        resolve()
      }
    })
  }

  async function loop(): Promise<void> {
    let delay = minRetry
    while (!stopped) {
      let connected = false
      try {
        await stream(() => {
          connected = true
        })
      } catch {
        // missing file, service down, auth, network error or silence: retried below
      }
      svc = null
      // A stream that was up and went down: nothing is known until the next connection re-syncs.
      if (connected) for (const entry of [...entries]) entry.input.onEvent({ kind: 'lost' }, entry.input.clock())
      if (stopped) break
      if (connected) delay = minRetry
      if (!kicked) await sleep(delay)
      kicked = false
      if (!connected) delay = Math.min(delay * 2, maxRetry)
    }
  }

  return {
    watch(input) {
      const entry: Entry = { input, fold: emptyFold() }
      entries.add(entry)
      if (!started) {
        started = true
        // persistent: false, so a pending poll never keeps the core's process alive by itself.
        fs.watchFile(o.serviceFile, { interval: o.watchMs ?? 1000, persistent: false }, kick)
        void loop()
      } else if (svc) {
        // Connected already: this session's current state comes from a re-sync, not from the next reconnect.
        resync([entry]).catch(() => {})
      }
      return () => {
        entries.delete(entry)
      }
    },
    stop() {
      stopped = true
      if (started) fs.unwatchFile(o.serviceFile, kick)
      abort?.abort()
      wake?.()
    },
  }
}
