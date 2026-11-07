import fs from 'node:fs'
import path from 'node:path'
import type { AgentInfo, AgentStateName, NeedsYouReason, StatusChange } from '../../protocol/messages.ts'
import type { TabRecord } from '../store/state.ts'
import type { AgentAdapter, AgentKind, AgentWatch } from './adapter.ts'
import { applyEvent, applyReport, unknownStatus, type Status, type StatusEvent, type StatusReport } from './contract.ts'

export interface StatusServiceOptions {
  home: string
  // One adapter per agent kind. A kind with no adapter cannot be tracked or restored.
  adapters: Partial<Record<AgentKind, AgentAdapter>>
  // The ids of the holder tabs that are alive. A tab not in this set is gone. One failed call is skipped, so a
  // blip cannot drop every tab; two in a row cannot confirm any tab alive, so every tab falls to unknown.
  alive: () => Promise<Set<string>>
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
}

const TICK_MS = 1000

// One watch per agent tab. Adapter events retain only the resume-id path; status comes from holder reports.
export class StatusService {
  private readonly watches = new Map<string, Watch>()
  private readonly listeners = new Set<(change: StatusChange) => void>()
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

  // Rebuilds each saved agent tab as unknown and its watch from the saved offset.
  // A tab whose holder tab is not in `alive` is gone.
  // A tab that fails to rebuild is logged and skipped.
  restore(records: TabRecord[], alive: Set<string>): void {
    for (const record of records) {
      if (record.agent === undefined || this.watches.has(record.id)) continue
      try {
        const now = this.clock()
        const gone = !alive.has(record.id)
        const status = unknownStatus(now)
        // A record with no session id gets '' here: the adapter then has nothing to resume, as before.
        const watch = this.open({
          tabId: record.id,
          kind: record.agent,
          sessionId: record.agentSessionId ?? '',
          resumeId: record.agentSessionId,
          status,
          // A tab found by hand is still released when its program ends, after a restart too.
          adopted: record.found === true,
        })
        this.writeSnapshot(watch)
        // A gone tab is never shown as live, even if an old source replays a status event.
        if (gone) {
          this.fallToUnknown(watch, this.clock())
        }
      } catch (error) {
        console.error(`core: could not restore status for tab ${record.id}: ${errorText(error)}`)
      }
    }
  }

  // An agent found running in a tab the app did not launch (typed into a shell). It starts unknown: nothing has
  // reported yet, and the agent's own hooks or log will say what it is doing. An empty session id is allowed
  // when the adapter can watch without one; otherwise there is no source until identify() gives the id.
  adopt(input: { tabId: string; kind: AgentKind; sessionId: string }): void {
    if (this.watches.has(input.tabId)) return
    const now = this.clock()
    const watch = this.open({
      tabId: input.tabId,
      kind: input.kind,
      sessionId: input.sessionId,
      resumeId: input.sessionId === '' ? undefined : input.sessionId,
      status: unknownStatus(now),
      adopted: true,
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
        }
      }
    } finally {
      this.ticking = false
    }
  }

  // Agents for the window's sidebar. A tab is resumable when its holder tab is gone and it has a session id.
  list(alive: Set<string>): AgentInfo[] {
    return [...this.watches.values()].map((watch) => {
      const { status } = watch
      return {
        tabId: watch.tabId,
        agent: watch.kind,
        state: status.state,
        ...(status.state === 'needs-you' ? { reason: status.reason } : {}),
        since: status.since,
        source: watch.kind,
        resumable: !alive.has(watch.tabId) && watch.resumeId !== undefined,
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
    }
  }

  private open(input: {
    tabId: string
    kind: AgentKind
    sessionId: string
    resumeId: string | undefined
    status: Status
    adopted?: boolean
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
    })
  }

  private onEvent(watch: Watch, event: StatusEvent): void {
    if (this.watches.get(watch.tabId) !== watch) return
    if (event.kind !== 'session') return
    if (event.kind === 'session') {
      if (event.resumeId !== watch.resumeId) {
        watch.resumeId = event.resumeId
        this.saveSession(watch.tabId, event.resumeId)
        this.writeSnapshot(watch)
      }
    }
  }

  // Sets unknown for a tab that is gone. A tab already unknown is left alone.
  private saveSession(tabId: string, sessionId: string): void {
    try {
      this.options.onSession?.(tabId, sessionId)
    } catch (error) {
      console.error(`core: could not save the session for tab ${tabId}: ${errorText(error)}`)
    }
  }

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
