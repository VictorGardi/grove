import path from 'node:path'
import { dayKey } from '../../protocol/days.ts'
import type { UsageSummary } from '../../protocol/messages.ts'
import { poll } from '../agents/usageSource.ts'
import { UsageHistory } from './history.ts'
import type { UsageReader } from './reader.ts'
import { clampDays, summarizeAgents } from './summary.ts'

export const USAGE_POLL_MS = 5000
const SAVE_MS = 5000
const NOTIFY_MS = 1000

export interface UsageServiceOptions {
  home: string
  readers: UsageReader[]
  clock?: () => number
  pollMs?: number
  // How long after a change the history is saved, and the window told. Both coalesce: many changes inside it are one.
  saveMs?: number
  notifyMs?: number
}

export const usageHistoryFile = (home: string): string => path.join(home, 'usage-history.json')

const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

// The usage statistics: Grove's saved history of requests (ADR 0003), filled by one reader per agent, and the summary the usage
// panel asks for. Readers work in small slices with the event loop given back between them, so a first read of gigabytes of
// transcripts never holds up the core's other work.
export class UsageService {
  private readonly history: UsageHistory
  private readonly clock: () => number
  private readonly listeners = new Set<() => void>()
  private running: Promise<void> | undefined
  // Bumped by a wipe, so a pass in flight drops what it read instead of putting it back.
  private generation = 0
  private building: boolean
  private poller: { stop: () => void } | undefined
  private closed = false
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private notifyTimer: ReturnType<typeof setTimeout> | undefined
  private cached: { key: string; summary: UsageSummary } | undefined

  constructor(private readonly options: UsageServiceOptions) {
    this.clock = options.clock ?? Date.now
    this.history = UsageHistory.load(usageHistoryFile(options.home), this.clock())
    for (const reader of options.readers) reader.restore(this.history.readers[reader.agent])
    this.building = !this.history.built
  }

  // Starts reading at once and then every poll.
  start(): void {
    this.poller ??= poll(() => this.drain(), { immediate: true, intervalMs: this.options.pollMs ?? USAGE_POLL_MS })
  }

  close(): void {
    this.closed = true
    this.poller?.stop()
    this.poller = undefined
    clearTimeout(this.notifyTimer)
    this.notifyTimer = undefined
    if (this.saveTimer !== undefined) this.persist()
  }

  // Calls `listener` when the numbers changed. Coalesced: a burst of requests is one call.
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  // One pass of every reader over what its agent wrote since the last pass. Passes never overlap: a call during one waits for it.
  drain(): Promise<void> {
    this.running ??= this.pass().finally(() => {
      this.running = undefined
    })
    return this.running
  }

  private async pass(): Promise<void> {
    // No reader, nothing to read and nothing to keep: a core without agent files writes no history.
    if (this.options.readers.length === 0 || this.closed) return
    const generation = this.generation
    let clean = true
    for (const reader of this.options.readers) {
      try {
        for (;;) {
          const { requests, done } = await reader.step()
          if (generation !== this.generation) return
          let changed = false
          for (const request of requests) changed = this.history.add(request) || changed
          if (changed) this.changed()
          if (done) break
          await yieldToLoop()
        }
      } catch (error) {
        // A failing source gives nothing and does not stop the others.
        clean = false
        console.error(`core: usage read of ${reader.agent} failed: ${message(error)}`)
      }
    }
    if (generation !== this.generation) return
    if (clean && !this.history.built) {
      this.history.built = true
      this.building = false
      this.changed()
    }
  }

  private changed(): void {
    this.cached = undefined
    if (this.closed) return
    this.saveTimer ??= setTimeout(() => this.persist(), this.options.saveMs ?? SAVE_MS).unref()
    this.notifyTimer ??= setTimeout(() => {
      this.notifyTimer = undefined
      for (const listener of this.listeners) {
        try {
          listener()
        } catch (error) {
          console.error(`core: usage listener failed: ${message(error)}`)
        }
      }
    }, this.options.notifyMs ?? NOTIFY_MS).unref()
  }

  private persist(): void {
    clearTimeout(this.saveTimer)
    this.saveTimer = undefined
    // An empty, never-wiped history has nothing to keep: it starts again, from the same day, when the core does.
    if (this.history.size === 0 && this.history.floor === null) return
    for (const reader of this.options.readers) this.history.readers[reader.agent] = reader.state()
    try {
      this.history.save()
    } catch (error) {
      console.error(`core: could not save the usage history: ${message(error)}`)
    }
  }

  // The numbers for the panel: per agent that made a request in the last 30 days, per-day detail for the last `days` days
  // and the Today / 7 days / 30 days totals; when the history starts; whether the first read is still running.
  summary(days?: number): UsageSummary {
    const range = clampDays(days)
    const now = this.clock()
    const today = dayKey(now)
    const key = `${this.history.revision}|${range}|${today}|${this.building}`
    if (this.cached?.key === key) return this.cached.summary
    let first = Infinity
    let last = -Infinity
    for (const request of this.history.requests()) {
      if (request.at < first) first = request.at
      if (request.at > last) last = request.at
    }
    const summary: UsageSummary = {
      today,
      historyFrom: dayKey(this.history.floor ?? (Number.isFinite(first) ? first : this.history.since)),
      building: this.building,
      ready: Number.isFinite(first) ? { from: dayKey(first), to: dayKey(last) } : null,
      agents: summarizeAgents(this.history.requests(), now, range),
    }
    this.cached = { key, summary }
    return summary
  }

  // Wipes the saved history. Its start date becomes now, and the agents' existing files are skipped, not read again.
  async wipe(): Promise<void> {
    this.generation++
    await this.running?.catch(() => undefined)
    this.history.wipe(this.clock())
    await Promise.all(
      this.options.readers.map((reader) =>
        reader.skipToEnd().catch((error: unknown) => console.error(`core: usage skip of ${reader.agent} failed: ${message(error)}`)),
      ),
    )
    this.history.built = true
    this.building = false
    this.changed()
    this.persist()
  }
}
