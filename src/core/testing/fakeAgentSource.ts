import { randomUUID } from 'node:crypto'
import type { AgentEvent, AgentKind, AgentSource, SessionSnapshot } from '../agents/types'
import { mintSessionId } from '../opencodeId'

export class FakeAgentSource implements AgentSource {
  started = false
  stopped = false
  snapshots = new Map<string, SessionSnapshot>() // what snapshot() returns, by session id
  snapshotCalls: string[][] = []
  writes = new Map<string, string[]>() // what lastWrites() returns, by session id
  forgotten: string[] = []
  private cb: ((e: AgentEvent) => void) | null = null

  constructor(readonly kind: AgentKind, readonly statusNeedsEvent = false) {}

  mintId(now: Date): string {
    return this.kind === 'opencode' ? mintSessionId(now.getTime()) : randomUUID()
  }

  argv(id: string, _mode: 'start' | 'resume', opts?: { prompt?: string; name?: string }): string[] {
    return [this.kind, '-s', id, ...(opts?.name ? ['--name', opts.name] : []), ...(opts?.prompt ? ['--prompt', opts.prompt] : [])]
  }

  start(onEvent: (e: AgentEvent) => void): void {
    this.started = true
    this.cb = onEvent
  }

  emit(e: AgentEvent): void {
    if (!this.cb) throw new Error('FakeAgentSource: emit before start')
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

  forget(id: string): void {
    this.forgotten.push(id)
  }

  stop(): void {
    this.stopped = true
  }
}
