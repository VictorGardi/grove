import fs from 'node:fs'
import path from 'node:path'
import { normalise } from './normalise'
import type { OcEvent, OpenCodeSource } from './types'

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class HttpOpenCode implements OpenCodeSource {
  private abort: AbortController | null = null
  private stopped = false

  constructor(private readonly o: { serviceFile: string; retryMs?: number }) {}

  start(onEvent: (e: OcEvent) => void): void {
    void this.loop(onEvent)
  }

  stop(): void {
    this.stopped = true
    this.abort?.abort()
  }

  private async loop(onEvent: (e: OcEvent) => void): Promise<void> {
    while (!this.stopped) {
      let connected = false
      try {
        await this.stream((e) => {
          if (e.type === 'connected') connected = true
          onEvent(e)
        })
      } catch {
        // missing file, service down, auth or network error: retried below
      }
      if (connected) onEvent({ type: 'disconnected' })
      if (!this.stopped) await sleep(this.o.retryMs ?? 1000)
    }
  }

  private async stream(onEvent: (e: OcEvent) => void): Promise<void> {
    const { url, password } = JSON.parse(fs.readFileSync(this.o.serviceFile, 'utf8')) as { url: string; password: string }
    const headers = { authorization: 'Basic ' + Buffer.from(`opencode:${password}`).toString('base64') }
    const info = await fetch(new URL('/api/info', url), { headers, signal: AbortSignal.timeout(2000) })
    if (!info.ok) throw new Error(`info ${info.status}`)
    const body = (await info.json()) as { version?: string; data?: { version?: string } }
    const version = body.data?.version ?? body.version ?? ''

    this.abort = new AbortController()
    const res = await fetch(new URL('/api/event', url), {
      headers: { ...headers, accept: 'text/event-stream' },
      signal: this.abort.signal,
    })
    if (!res.ok || !res.body) throw new Error(`event ${res.status}`)
    const decoder = new TextDecoder()
    let buffer = ''
    for await (const chunk of res.body) {
      const { frames, rest } = sseData(buffer + decoder.decode(chunk, { stream: true }))
      buffer = rest
      for (const frame of frames) {
        let raw: unknown
        try {
          raw = JSON.parse(frame)
        } catch {
          continue
        }
        const e = normalise(raw, version)
        if (e) onEvent(e)
      }
    }
  }
}
