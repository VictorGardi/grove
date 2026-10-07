import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { AgentEvent, AgentSource, SessionSnapshot } from '../agents/types'
import { claudeArgv } from './hooks'
import { emptyFold, step, type ClaudeFold } from './normalise'
import { SpoolTail, type SpoolRecord } from './spool'

// Claude Code sessions (E-D10, ADR 0016): per-launch hooks append to <dir>/<id>.jsonl; this tails
// and folds them. Connected from start(); a session has status only once its spool has a record.
export class SpoolClaude implements AgentSource {
  readonly kind = 'claude' as const
  readonly statusNeedsEvent = true
  private readonly folds = new Map<string, ClaudeFold>()
  private readonly tail: SpoolTail
  private onEvent: ((e: AgentEvent) => void) | null = null

  constructor(private readonly opts: { dir: string }) {
    this.tail = new SpoolTail(opts.dir, (id, records, initial) => this.fold(id, records, initial))
  }

  mintId(): string {
    return randomUUID()
  }

  argv(id: string, mode: 'start' | 'resume'): string[] {
    return claudeArgv(id, this.spool(id), mode, mode === 'resume' ? this.folds.get(id)?.resumeId ?? undefined : undefined)
  }

  start(onEvent: (e: AgentEvent) => void): void {
    this.onEvent = onEvent
    this.tail.start() // records already there are folded without events
    onEvent({ type: 'connected', version: 'spool' })
  }

  async snapshot(ids: string[]): Promise<Map<string, SessionSnapshot>> {
    const out = new Map<string, SessionSnapshot>()
    for (const id of ids) {
      const f = this.folds.get(id)
      if (!f) continue // no record yet: no status (live gate)
      out.set(id, { running: f.running, idleAt: f.idleAt, pending: [...f.pending].map(([id, kind]) => ({ id, kind })), children: [] })
    }
    return out
  }

  async lastWrites(id: string): Promise<string[]> {
    return this.folds.get(id)?.lastWrite ?? []
  }

  // The session was removed: its spool goes with it.
  forget(id: string): void {
    this.folds.delete(id)
    this.tail.forget(id)
    try {
      fs.rmSync(this.spool(id), { force: true })
    } catch {
      // nothing to clean up
    }
  }

  stop(): void {
    this.tail.stop()
  }

  private spool(id: string): string {
    return path.join(this.opts.dir, `${id}.jsonl`)
  }

  private fold(id: string, records: SpoolRecord[], initial: boolean): void {
    let f = this.folds.get(id) ?? emptyFold(id)
    for (const r of records) {
      const out = step(f, r)
      f = out.fold
      this.folds.set(id, f)
      if (!initial) for (const e of out.events) this.onEvent?.(e)
    }
  }
}
