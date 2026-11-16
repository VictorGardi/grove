import path from 'node:path'
import { dayKey } from '../../protocol/days.ts'
import type { UsageAgent, UsageProgress, UsageSummary } from '../../protocol/messages.ts'
import { poll } from '../agents/usageSource.ts'
import type { GitRun } from '../gitrun.ts'
import type { GroveSessions } from './groveSessions.ts'
import { UsageHistory } from './history.ts'
import { UsageIndex } from './index.ts'
import type { UsageReader } from './reader.ts'
import { RepositoryResolver, type RepositoryPlaces } from './repositories.ts'
import { clampDays, summarizeAgents } from './summary.ts'

export const USAGE_POLL_MS = 5000
// Where the history keeps what Grove's own records taught it, beside the readers' places.
const GROVE_STATE = 'grove'
const SAVE_MS = 5000
const NOTIFY_MS = 1000

export interface UsageServiceOptions {
  home: string
  readers: UsageReader[]
  // Grove's own records of the sessions it ran: the readers use them to tell Grove's requests from the others, and what they
  // learnt (when Grove began recording Claude sessions) is saved with the history and shown in the summary.
  grove?: GroveSessions
  clock?: () => number
  pollMs?: number
  // How long after a change the history is saved, and the window told. Both coalesce: many changes inside it are one.
  saveMs?: number
  notifyMs?: number
  // The folders of the current Spaces, which "Where it went" marks and rolls subfolders and former worktrees into.
  spaces?: () => string[]
  // How folders are placed in repositories: git (read-only, time limited) and the folders that count as home, Grove's worktrees and scratch.
  git?: GitRun
  places?: RepositoryPlaces
}

export const usageHistoryFile = (home: string): string => path.join(home, 'usage-history.json')

// What a reader's place is saved under in the history, and how its failures are named.
const readerKey = (reader: UsageReader): string => reader.id ?? reader.agent
const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

// The usage statistics: Grove's saved history of requests (ADR 0003), filled by one reader per agent, and the summary the usage
// panel asks for. Readers work in small slices with the event loop given back between them, so a first read of gigabytes of
// transcripts never holds up the core's other work.
export class UsageService {
  private readonly history: UsageHistory
  private readonly index = new UsageIndex()
  private readonly repositories: RepositoryResolver
  private readonly clock: () => number
  private readonly listeners = new Set<() => void>()
  private running: Promise<void> | undefined
  // Bumped by a wipe, so a pass in flight drops what it read instead of putting it back.
  private generation = 0
  private building: boolean
  private poller: { stop: () => void } | undefined
  private closed = false
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  // The save in progress, and whether more changed while it ran.
  private saving: Promise<void> | undefined
  private saveAgain = false
  // The progress the window was last told of, so a slice that moved it tells the window again.
  private shownProgress = ''
  private notifyTimer: ReturnType<typeof setTimeout> | undefined
  private cached: { key: string; summary: UsageSummary } | undefined

  constructor(private readonly options: UsageServiceOptions) {
    this.clock = options.clock ?? Date.now
    this.history = UsageHistory.load(usageHistoryFile(options.home), this.clock())
    for (const request of this.history.requests()) this.index.apply(undefined, request)
    this.history.observer = (before, after) => this.index.apply(before, after)
    this.repositories = new RepositoryResolver({ git: options.git, spaces: options.spaces ?? (() => []), places: options.places, clock: this.clock, onChange: () => this.changed() })
    for (const reader of options.readers) reader.restore(this.history.readers[readerKey(reader)])
    options.grove?.restore(this.history.readers[GROVE_STATE])
    this.building = !this.history.built
  }

  // Starts reading at once and then every poll.
  start(): void {
    this.poller ??= poll(() => this.drain(), { immediate: true, intervalMs: this.options.pollMs ?? USAGE_POLL_MS })
  }

  close(): void {
    this.closed = true
    this.repositories.close()
    this.poller?.stop()
    this.poller = undefined
    clearTimeout(this.notifyTimer)
    this.notifyTimer = undefined
    if (this.saveTimer !== undefined || this.saving !== undefined) this.persist()
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
          // While the history is being built the numbers move with every slice, whether or not it held a request.
          if (changed || (this.building && this.progressKey() !== this.shownProgress)) this.changed()
          if (done) break
          await yieldToLoop()
        }
      } catch (error) {
        // A failing source gives nothing and does not stop the others.
        clean = false
        console.error(`core: usage read of ${readerKey(reader)} failed: ${message(error)}`)
      }
    }
    if (generation !== this.generation) return
    if (clean && !this.history.built) {
      this.history.built = true
      this.building = false
      this.changed()
    }
  }

  // How far the first read has got per agent: the readers that can say, an agent with several as far as its slowest. Empty once built.
  private progress(): UsageProgress[] {
    if (!this.building) return []
    const fractions = new Map<UsageAgent, number>()
    for (const reader of this.options.readers) {
      // A reader that can say but has not looked yet has read nothing: its agent is not done because another source of it is.
      const fraction = reader.progress ? (reader.progress() ?? 0) : undefined
      if (fraction !== undefined) fractions.set(reader.agent, Math.min(fractions.get(reader.agent) ?? 1, fraction))
    }
    return [...fractions].map(([agent, fraction]) => ({ agent, fraction: Math.round(fraction * 100) / 100 }))
  }

  private progressKey(): string {
    return this.progress().map((entry) => `${entry.agent}:${entry.fraction}`).join()
  }

  private changed(): void {
    this.cached = undefined
    this.shownProgress = this.progressKey()
    if (this.closed) return
    this.saveTimer ??= setTimeout(() => void this.persistLater(), this.options.saveMs ?? SAVE_MS).unref()
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

  // An empty, never-wiped history has nothing to keep: it starts again, from the same day, when the core does.
  private worthKeeping(): boolean {
    return this.history.size > 0 || this.history.floor !== null
  }

  private rememberReaders(): void {
    for (const reader of this.options.readers) this.history.readers[readerKey(reader)] = reader.state()
    if (this.options.grove) this.history.readers[GROVE_STATE] = this.options.grove.state()
  }

  // Saves the whole file at once, holding the loop: for a core that is closing, and for a wipe (an empty file).
  private persist(): void {
    clearTimeout(this.saveTimer)
    this.saveTimer = undefined
    if (!this.worthKeeping()) return
    this.rememberReaders()
    try {
      this.history.save()
    } catch (error) {
      console.error(`core: could not save the usage history: ${message(error)}`)
    }
  }

  // Saves the file in slices, so a history of hundreds of thousands of requests never holds the loop. A change that comes in while it
  // writes is saved by the next one, which starts when this one is done.
  private persistLater(): Promise<void> {
    clearTimeout(this.saveTimer)
    this.saveTimer = undefined
    if (!this.worthKeeping()) return Promise.resolve()
    if (this.saving !== undefined) {
      this.saveAgain = true
      return this.saving
    }
    this.rememberReaders()
    this.saving = this.history
      .saveAsync()
      .then(() => undefined)
      .catch((error: unknown) => console.error(`core: could not save the usage history: ${message(error)}`))
      .finally(() => {
        this.saving = undefined
        if (this.saveAgain && !this.closed) {
          this.saveAgain = false
          this.saveTimer ??= setTimeout(() => void this.persistLater(), this.options.saveMs ?? SAVE_MS).unref()
        }
      })
    return this.saving
  }

  // Resolves once every folder the summary needs placed in a repository has been looked up.
  settled(): Promise<void> {
    return this.repositories.settled()
  }

  // The numbers for the panel: per agent that made a request in the last 30 days, per-day detail for the last `days` days, the
  // Today / 7 days / 30 days totals, and the hour, repository and model breakdowns over the last `range` days (default `days`);
  // when the history starts; whether the first read is still running. Folders not yet placed in a repository count by their path
  // until git has answered, and the window is told then.
  summary(daysAsked?: number, rangeAsked?: number): UsageSummary {
    const days = clampDays(daysAsked)
    const range = rangeAsked === undefined ? days : clampDays(rangeAsked)
    const now = this.clock()
    const today = dayKey(now)
    const spaces = (this.options.spaces?.() ?? []).join('\n')
    const key = `${this.history.revision}|${days}|${range}|${today}|${this.building}|${this.progressKey()}|${this.repositories.version}|${spaces}|${this.options.grove?.trackedSince('claude')}`
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
      progress: this.progress(),
      agents: summarizeAgents(this.index, this.repositories.snapshot(), now, days, range, (agent) => this.options.grove?.trackedSince(agent)),
    }
    this.cached = { key, summary }
    return summary
  }

  // Wipes the saved history. Its start date becomes now, and the agents' existing files are skipped, not read again.
  async wipe(): Promise<void> {
    this.generation++
    await this.running?.catch(() => undefined)
    this.history.wipe(this.clock())
    this.index.clear()
    await Promise.all(
      this.options.readers.map((reader) =>
        reader.skipToEnd().catch((error: unknown) => console.error(`core: usage skip of ${readerKey(reader)} failed: ${message(error)}`)),
      ),
    )
    this.history.built = true
    this.building = false
    this.changed()
    this.persist()
  }
}
