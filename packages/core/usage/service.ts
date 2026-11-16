import fs from 'node:fs'
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
const NOTIFY_MS = 1000

export interface UsageServiceOptions {
  home: string
  readers: UsageReader[]
  // Grove's own records of the sessions it ran: the readers use them to tell Grove's requests from the others, and what they
  // learnt (when Grove began recording Claude sessions) is shown in the summary.
  grove?: GroveSessions
  clock?: () => number
  pollMs?: number
  // How long after a change the window is told. It coalesces: many changes inside it are one.
  notifyMs?: number
  // The folders of the current Spaces, which "Where it went" marks and rolls subfolders and former worktrees into.
  spaces?: () => string[]
  // How folders are placed in repositories: git (read-only, time limited) and the folders that count as home, Grove's worktrees and scratch.
  git?: GitRun
  places?: RepositoryPlaces
}

// What an earlier build of the usage history saved in the Grove home: the file, the temp files of a write that was killed, and the
// copies of an unreadable one set aside. They name folders, and nothing reads them any more (ADR 0004), so a core start removes them.
const isOldHistoryFile = (name: string): boolean => name === 'usage-history.json' || (name.startsWith('usage-history.json.') && (name.endsWith('.tmp') || name.startsWith('usage-history.json.corrupt-')))

export function removeOldUsageHistory(home: string): void {
  try {
    for (const name of fs.readdirSync(home)) if (isOldHistoryFile(name)) fs.rmSync(path.join(home, name), { force: true })
  } catch {}
}

// How a reader's failures are named.
const readerKey = (reader: UsageReader): string => reader.id ?? reader.agent
const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

// The usage statistics: the history of requests (ADR 0004), built in memory by one reader per agent from what the agents' files hold
// now, and the summary the usage panel asks for. Nothing is saved. Readers work in small slices with the event loop given back
// between them, so the read of gigabytes of transcripts at every start never holds up the core's other work.
export class UsageService {
  private readonly history = new UsageHistory()
  private readonly index = new UsageIndex()
  private readonly repositories: RepositoryResolver
  private readonly clock: () => number
  private readonly listeners = new Set<() => void>()
  private running: Promise<void> | undefined
  // True until every reader has read everything once: the history is the agents' files as far as read.
  private building: boolean
  private poller: { stop: () => void } | undefined
  private closed = false
  // The progress the window was last told of, so a slice that moved it tells the window again.
  private shownProgress = ''
  private notifyTimer: ReturnType<typeof setTimeout> | undefined
  private cached: { key: string; summary: UsageSummary } | undefined

  constructor(private readonly options: UsageServiceOptions) {
    this.clock = options.clock ?? Date.now
    removeOldUsageHistory(options.home)
    this.history.observer = (before, after) => this.index.apply(before, after)
    this.repositories = new RepositoryResolver({ git: options.git, spaces: options.spaces ?? (() => []), places: options.places, clock: this.clock, onChange: () => this.changed() })
    // A core without a reader has nothing to build.
    this.building = options.readers.length > 0
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
    if (this.options.readers.length === 0 || this.closed) return
    let clean = true
    for (const reader of this.options.readers) {
      try {
        for (;;) {
          const { requests, done } = await reader.step()
          if (this.closed) return
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
    if (clean && this.building && !this.closed) {
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

  // Resolves once every folder the summary needs placed in a repository has been looked up.
  settled(): Promise<void> {
    return this.repositories.settled()
  }

  // The numbers for the panel: per agent that made a request in the last 30 days, per-day detail for the last `days` days, the
  // Today / 7 days / 30 days totals, and the hour, repository and model breakdowns over the last `range` days (default `days`);
  // the days the history holds so far; whether the first read is still running. Folders not yet placed in a repository count by their path
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
      building: this.building,
      ready: Number.isFinite(first) ? { from: dayKey(first), to: dayKey(last) } : null,
      progress: this.progress(),
      agents: summarizeAgents(this.index, this.repositories.snapshot(), now, days, range, (agent) => this.options.grove?.trackedSince(agent)),
    }
    this.cached = { key, summary }
    return summary
  }
}
