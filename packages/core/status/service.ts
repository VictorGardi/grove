import fs from 'node:fs'
import path from 'node:path'
import { contextLevel } from '../../protocol/context-level.ts'
import type { AgentInfo, AgentStateName, ContextUsage, NeedsYouReason, StatusChange, TabInfo } from '../../protocol/messages.ts'
import type { TabRecord } from '../store/state.ts'
import { agentOfProgram } from '../presence.ts'
import type { AgentAdapter, AgentKind, AgentWatch } from './adapter.ts'
import { applyEvent, applyReport, unknownStatus, type Status, type StatusEvent, type StatusReport } from './contract.ts'

export interface StatusServiceOptions {
  home: string
  // One adapter per agent kind. A kind with no adapter cannot be tracked or restored.
  adapters: Partial<Record<AgentKind, AgentAdapter>>
  // The ids of the holder tabs that are alive. A tab not in this set is gone. One failed call is skipped, so a
  // blip cannot drop every tab; two in a row cannot confirm any tab alive, so every tab falls to unknown.
  alive: () => Promise<Set<string>>
  // The holder's last report for each tab, as of the latest `alive` call. Each tick applies a report the push missed
  // (a lost tabs.status notification) so a tab cannot stay on a stale state.
  reports?: () => ReadonlyMap<string, StatusReport | null | undefined>
  // Called when a tab reports its agent session id, on start and again after /clear.
  onSession?: (tabId: string, sessionId: string) => void
  clock?: () => number
  tickMs?: number
}

export interface TrackInput {
  tabId: string
  spaceId: string
  spacePath: string
  kind: AgentKind
  sessionId: string
}

interface Watch {
  tabId: string
  kind: AgentKind
  resumeId: string | undefined
  status: Status
  source: AgentWatch | undefined
  // True for an agent found by hand (adopt) rather than launched by the app: it is released when its program ends.
  adopted: boolean
  // The latest context reading the adapter delivered; undefined until one arrives.
  context: ContextUsage | undefined
  // The last report seen for this tab, pushed or read from the holder, as reportKey. A holder record equal to it is not applied again.
  lastReport: string | undefined
}

const reportKey = (report: StatusReport | null | undefined): string | undefined =>
  report === null || report === undefined ? undefined : `${report.state}:${report.kind ?? ''}`

const TICK_MS = 1000

// One watch per agent tab. Adapter events retain only the resume-id path; status comes from holder reports.
export class StatusService {
  private readonly watches = new Map<string, Watch>()
  private readonly listeners = new Set<(change: StatusChange) => void>()
  private readonly contextListeners = new Set<(tabId: string, context: ContextUsage) => void>()
  private readonly clock: () => number
  private readonly tickMs: number
  private timer: ReturnType<typeof setInterval> | undefined
  private ticking = false
  // Consecutive failed holder calls; reset by a successful one.
  private aliveFailures = 0

  constructor(private readonly options: StatusServiceOptions) {
    this.clock = options.clock ?? Date.now
    this.tickMs = options.tickMs ?? TICK_MS
  }

  // Returns a function that stops the listener.
  subscribe(listener: (change: StatusChange) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // Called with a tab's context reading each time it changes. Returns a function that stops the listener.
  subscribeContext(listener: (tabId: string, context: ContextUsage) => void): () => void {
    this.contextListeners.add(listener)
    return () => this.contextListeners.delete(listener)
  }

  // Rebuilds each saved agent tab from the holder's last report when that agent is still in the foreground.
  // A tab whose holder entry is missing or whose foreground is no longer an agent starts unknown.
  // A tab that fails to rebuild is logged and skipped.
  restore(records: TabRecord[], tabs: TabInfo[]): void {
    const tabsById = new Map(tabs.map((tab) => [tab.id, tab]))
    for (const record of records) {
      if (record.agent === undefined || this.watches.has(record.id)) continue
      try {
        const now = this.clock()
        const tab = tabsById.get(record.id)
        const status =
          tab?.alive && isForegroundAgent(tab.foreground, tab.argv0, record.agent)
            ? statusFromHolderReport(tab.status, now)
            : unknownStatus(now)
        // A stale record of an agent that quit is seen too, so the tick never applies it.
        // A record with no session id gets '' here: the adapter then has nothing to resume, as before.
        const watch = this.open({
          tabId: record.id,
          kind: record.agent,
          sessionId: record.agentSessionId ?? '',
          resumeId: record.agentSessionId,
          status,
          // A tab found by hand is still released when its program ends, after a restart too.
          adopted: record.found === true,
          lastReport: reportKey(tab?.status),
        })
        this.writeSnapshot(watch)
      } catch (error) {
        console.error(`core: could not restore status for tab ${record.id}: ${errorText(error)}`)
      }
    }
  }

  // An agent found running in a tab the app did not launch (typed into a shell). Its holder report is used only
  // while that agent is still in the foreground. An empty session id is allowed when the adapter can watch without
  // one; otherwise there is no source until identify() gives the id.
  adopt(input: {
    tabId: string
    kind: AgentKind
    sessionId: string
    status?: StatusReport | null
    foreground?: string | null
    argv0?: string | null
  }): void {
    if (this.watches.has(input.tabId)) return
    const now = this.clock()
    const status = isForegroundAgent(input.foreground ?? null, input.argv0 ?? null, input.kind)
      ? statusFromHolderReport(input.status, now)
      : unknownStatus(now)
    const watch = this.open({
      tabId: input.tabId,
      kind: input.kind,
      sessionId: input.sessionId,
      resumeId: input.sessionId === '' ? undefined : input.sessionId,
      status,
      adopted: true,
      lastReport: reportKey(input.status),
    })
    this.writeSnapshot(watch)
    if (input.sessionId !== '') this.saveSession(input.tabId, input.sessionId)
  }

  // Gives an adopted tab its session id once it is known. A source that started without one (Copilot's, which reads its
  // spool at once) is restarted with it, so its log is read too; a source that needed the id is started now.
  identify(tabId: string, sessionId: string): void {
    const watch = this.watches.get(tabId)
    if (!watch || watch.resumeId === sessionId) return
    watch.source?.close()
    watch.source = this.startSource(watch, sessionId)
    watch.resumeId = sessionId
    this.writeSnapshot(watch)
    // Saved with the tab, so a core restart can still watch it and resume it.
    this.saveSession(tabId, sessionId)
  }

  // The agent kind of an adopted tab, or undefined for a tab the app launched or that has no watch.
  adoptedKind(tabId: string): AgentKind | undefined {
    const watch = this.watches.get(tabId)
    return watch?.adopted ? watch.kind : undefined
  }

  // Whether a tab has a watch, launched or adopted.
  isWatched(tabId: string): boolean {
    return this.watches.has(tabId)
  }

  // A launched tab starts unknown until the holder receives its first root status report.
  track(input: TrackInput): void {
    this.close(input.tabId)
    const watch = this.open({
      tabId: input.tabId,
      kind: input.kind,
      sessionId: input.sessionId,
      resumeId: input.sessionId,
      status: unknownStatus(this.clock()),
    })
    this.writeSnapshot(watch)
  }

  report(tabId: string, report: StatusReport): void {
    const watch = this.watches.get(tabId)
    if (!watch) return
    watch.lastReport = reportKey(report)
    this.apply(watch, applyReport(watch.status, report, this.clock()))
  }

  start(): void {
    if (this.timer !== undefined) return
    this.timer = setInterval(() => {
      this.tick().catch((error: unknown) => console.error(`core: status check failed: ${errorText(error)}`))
    }, this.tickMs)
  }

  // One pass of the liveness check: a tab whose holder tab is gone becomes unknown.
  async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      const current = [...this.watches.values()]
      if (current.length === 0) return
      // A single failed holder call skips the gone check for this tick. A second in a row counts every tab as
      // gone, since nothing is confirmed alive.
      let alive: Set<string> | undefined
      try {
        alive = await this.options.alive()
        this.aliveFailures = 0
      } catch {
        this.aliveFailures += 1
        if (this.aliveFailures >= 2) alive = new Set()
      }
      for (const watch of current) {
        if (this.watches.get(watch.tabId) !== watch) continue
        if (alive !== undefined && !alive.has(watch.tabId)) {
          this.fallToUnknown(watch, this.clock())
          continue
        }
        // The holder's record differs from the last one seen: a push was lost, so apply it now.
        const record = alive !== undefined ? this.options.reports?.().get(watch.tabId) : undefined
        if (record && reportKey(record) !== watch.lastReport) this.report(watch.tabId, record)
      }
    } finally {
      this.ticking = false
    }
  }

  // Agents for the window's sidebar. A tab is resumable when its holder tab is gone and it has a session id.
  list(alive: Set<string>): AgentInfo[] {
    return [...this.watches.values()].map((watch) => {
      const { status } = watch
      const level = contextLevel(watch.context)
      return {
        tabId: watch.tabId,
        agent: watch.kind,
        state: status.state,
        ...(status.state === 'needs-you' ? { reason: status.reason } : {}),
        since: status.since,
        source: watch.kind,
        resumable: !alive.has(watch.tabId) && watch.resumeId !== undefined,
        ...(watch.context ? { context: watch.context } : {}),
        ...(level ? { level } : {}),
      }
    })
  }

  // The reader saw a finished tab: it is idle from now, so the next finish notifies again. Any other state is left alone.
  markSeen(tabId: string): void {
    const watch = this.watches.get(tabId)
    if (!watch || watch.status.state !== 'finished') return
    this.apply(watch, applyEvent(watch.status, { kind: 'idle' }, this.clock()))
  }

  // Drops a tab that was removed: its watch and adapter source go, and it is no longer listed.
  untrack(tabId: string): void {
    this.close(tabId)
  }

  close(tabId?: string): void {
    const ids = tabId === undefined ? [...this.watches.keys()] : [tabId]
    for (const id of ids) {
      const watch = this.watches.get(id)
      if (!watch) continue
      this.watches.delete(id)
      watch.source?.close()
    }
    if (tabId === undefined) {
      clearInterval(this.timer)
      this.timer = undefined
      this.listeners.clear()
      this.contextListeners.clear()
    }
  }

  private open(input: {
    tabId: string
    kind: AgentKind
    sessionId: string
    resumeId: string | undefined
    status: Status
    adopted?: boolean
    lastReport?: string
  }): Watch {
    const adapter = this.options.adapters[input.kind]
    if (adapter === undefined) throw new Error(`no adapter for agent ${input.kind}`)
    const watch: Watch = {
      tabId: input.tabId,
      kind: input.kind,
      resumeId: input.resumeId,
      status: input.status,
      source: undefined,
      adopted: input.adopted ?? false,
      context: undefined,
      lastReport: input.lastReport,
    }
    this.watches.set(input.tabId, watch)
    // An adapter that needs the id waits for it when the id is not known yet.
    if (adapter.needsSession === true && input.sessionId === '') return watch
    // The adapter may deliver events before it returns, so the watch is already registered.
    watch.source = this.startSource(watch, input.sessionId)
    return watch
  }

  private startSource(watch: Watch, sessionId: string): AgentWatch {
    const adapter = this.options.adapters[watch.kind]
    if (adapter === undefined) throw new Error(`no adapter for agent ${watch.kind}`)
    return adapter.watch({
      tabId: watch.tabId,
      sessionId,
      home: this.options.home,
      clock: this.clock,
      onEvent: (event) => this.onEvent(watch, event),
      onContext: (context) => this.onContext(watch, context),
    })
  }

  // A reading is not activity: it never changes the tab's status.
  private onContext(watch: Watch, context: ContextUsage): void {
    if (this.watches.get(watch.tabId) !== watch) return
    watch.context = context
    for (const listener of this.contextListeners) listener(watch.tabId, context)
  }

  private onEvent(watch: Watch, event: StatusEvent): void {
    if (this.watches.get(watch.tabId) !== watch) return
    if (event.kind !== 'session') return
    if (event.resumeId !== watch.resumeId) {
      watch.resumeId = event.resumeId
      this.saveSession(watch.tabId, event.resumeId)
      this.writeSnapshot(watch)
    }
  }

  private saveSession(tabId: string, sessionId: string): void {
    try {
      this.options.onSession?.(tabId, sessionId)
    } catch (error) {
      console.error(`core: could not save the session for tab ${tabId}: ${errorText(error)}`)
    }
  }

  // Sets unknown for a tab that is gone. A tab already unknown is left alone.
  private fallToUnknown(watch: Watch, now: number): void {
    if (watch.status.state !== 'unknown') this.apply(watch, unknownStatus(now))
  }

  private apply(watch: Watch, next: Status): void {
    if (next === watch.status) return
    watch.status = next
    this.writeSnapshot(watch)
    const change: StatusChange = {
      tabId: watch.tabId,
      agent: watch.kind,
      state: next.state as AgentStateName,
      since: next.since,
      source: watch.kind,
      ...(next.state === 'needs-you' ? { reason: next.reason } : {}),
    }
    for (const listener of this.listeners) listener(change)
  }

  private agentDir(kind: AgentKind): string {
    return path.join(this.options.home, 'agents', kind)
  }

  private snapshotFile(kind: AgentKind, tabId: string): string {
    return path.join(this.agentDir(kind), `${tabId}.status.json`)
  }

  private writeSnapshot(watch: Watch): void {
    const file = this.snapshotFile(watch.kind, watch.tabId)
    const body = { resumeId: watch.resumeId }
    try {
      fs.mkdirSync(this.agentDir(watch.kind), { recursive: true, mode: 0o700 })
      fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(body)}\n`, { mode: 0o600 })
      fs.renameSync(`${file}.tmp`, file)
    } catch (error) {
      console.error(`core: could not save status for tab ${watch.tabId}: ${errorText(error)}`)
    }
  }

}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isForegroundAgent(foreground: string | null, argv0: string | null, kind: AgentKind): boolean {
  return agentOfProgram(foreground) === kind || agentOfProgram(argv0) === kind
}

function statusFromHolderReport(report: StatusReport | null | undefined, now: number): Status {
  if (report === null || report === undefined) return unknownStatus(now)
  if (report.state === 'done') return { state: 'idle', since: now }
  return applyReport(unknownStatus(now), report, now)
}
