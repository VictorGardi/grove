import type { OcEvent, OpenCodeSource, SessionSnapshot } from '../opencode/types'

export class FakeOpenCode implements OpenCodeSource {
  started = false
  stopped = false
  snapshots = new Map<string, SessionSnapshot>() // what snapshot() returns, by session id
  snapshotCalls: string[][] = []
  writes = new Map<string, string[]>() // what lastWrites() returns, by session id
  private cb: ((e: OcEvent) => void) | null = null

  start(onEvent: (e: OcEvent) => void): void {
    this.started = true
    this.cb = onEvent
  }

  emit(e: OcEvent): void {
    if (!this.cb) throw new Error('FakeOpenCode: emit before start')
    this.cb(e)
  }

  async snapshot(ids: string[]): Promise<Map<string, SessionSnapshot>> {
    this.snapshotCalls.push(ids)
    const out = new Map<string, SessionSnapshot>()
    for (const id of ids) {
      const s = this.snapshots.get(id)
      if (!s) continue
      out.set(id, s)
      for (const c of s.children) {
        const cs = this.snapshots.get(c)
        if (cs) out.set(c, cs)
      }
    }
    return out
  }

  async lastWrites(id: string): Promise<string[]> {
    return this.writes.get(id) ?? []
  }

  stop(): void {
    this.stopped = true
  }
}
