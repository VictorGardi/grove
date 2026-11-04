import fs from 'node:fs'
import path from 'node:path'
import type { AgentInfo, AgentStateName, NeedsYouReason, StatusChange } from '../../protocol/messages.ts'
import type { TabRecord } from '../store/state.ts'
import { applyEvent, GRACE_MS, unknownStatus, type Status, type StatusEvent } from './contract.ts'
import { createCrossCheck, normaliseScreen, type CrossCheck } from './cross-check.ts'
import { createWatchdog, type Watchdog } from './watchdog.ts'

// The launch and source shapes this service needs. They are structural, so the Claude adapter's
// functions are passed in as they are and the tests pass fakes.
export interface ClaudeLaunchInput {
  tabId: string
  cwd: string
  home: string
  resumeId?: string
}

export interface ClaudeLaunchResult {
  command: string
  args: string[]
  env: Record<string, string>
  sessionId: string
  spoolFile: string
}

export type LaunchClaude = (input: ClaudeLaunchInput) => ClaudeLaunchResult

export interface SourceOptions {
  spoolFile: string
  offsetFile: string
  clock: () => number
  // `at` is the time the event happened; a source that cannot tell passes the clock.
  onEvent: (event: StatusEvent, at: number) => void
}

// The Claude source delivers the spool from its saved offset as soon as it is created, so a restored
// watch is rebuilt before restore() returns.
export interface AgentSource {
  close: () => void
}

export type CreateSource = (options: SourceOptions) => AgentSource

export const AGENT_SOURCE = 'claude'

export interface StatusServiceOptions {
  home: string
  launchClaude: LaunchClaude
  createSource: CreateSource
  // The visible text of a tab's screen, read from the holder. Asked on each tick for a needs-you tab.
  screen: (tabId: string) => Promise<string>
  // The ids of the holder tabs that are alive. A tab not in this set is gone. One failed call is skipped, so a
  // blip cannot drop every tab; two in a row cannot confirm any tab alive, so every tab falls to unknown.
  alive: () => Promise<Set<string>>
  // Called when a tab reports its agent session id, on start and again after /clear.
  onSession?: (tabId: string, sessionId: string) => void
  clock?: () => number
  tickMs?: number
  graceMs?: number
  silenceMs?: number
}

export interface TrackInput {
  tabId: string
  spacePath: string
  spoolFile: string
  sessionId: string
}

interface Watch {
  tabId: string
  spoolFile: string
  resumeId: string | undefined
  status: Status
  check: CrossCheck
  watchdog: Watchdog
  // The last normalised screen read for a working tab; a change in it is real activity.
  screen: string | undefined
  source: AgentSource | undefined
}

const TICK_MS = 1000
const STATE_NAMES = new Set<string>(['working', 'needs-you', 'finished', 'idle', 'unknown'])
const REASONS = new Set<string>(['permission', 'question', 'error'])

// One watch per Claude tab. Each owns its spool source, cross-check and watchdog, and folds the
// source's events into a status. The status is written to a sidecar file on every change, and the
// spool offset is saved by the source, so a restarted core rebuilds each tab instead of resetting it.
export class StatusService {
  private readonly watches = new Map<string, Watch>()
  private readonly listeners = new Set<(change: StatusChange) => void>()
  private readonly clock: () => number
  private readonly tickMs: number
  private readonly graceMs: number
  private timer: ReturnType<typeof setInterval> | undefined
  private ticking = false
  // Consecutive failed holder calls; reset by a successful one.
  private aliveFailures = 0

  constructor(private readonly options: StatusServiceOptions) {
    this.clock = options.clock ?? Date.now
    this.tickMs = options.tickMs ?? TICK_MS
    this.graceMs = options.graceMs ?? GRACE_MS
  }

  // Returns a function that stops the listener.
  subscribe(listener: (change: StatusChange) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // Rebuilds each saved Claude tab from its sidecar status and its spool from the saved offset.
  // A tab whose holder tab is not in `alive` is gone, so it restores as unknown, never as a live state.
  // A tab that fails to rebuild is logged and skipped.
  restore(records: TabRecord[], alive: Set<string>): void {
    for (const record of records) {
      if (record.agent !== 'claude' || this.watches.has(record.id)) continue
      try {
        const launch = this.options.launchClaude({
          tabId: record.id,
          cwd: record.spacePath,
          home: this.options.home,
          resumeId: record.agentSessionId,
        })
        const now = this.clock()
        const saved = this.readSnapshot(record.id)
        const gone = !alive.has(record.id)
        const status = gone ? unknownStatus(now) : (saved ?? unknownStatus(now))
        const watch = this.open({ tabId: record.id, spoolFile: launch.spoolFile, resumeId: record.agentSessionId, status })
        // The replay above may have set a needs-you or working from the spool; a gone tab is never shown as live.
        if (gone) {
          this.fallToUnknown(watch, this.clock())
          this.writeSnapshot(watch)
        }
      } catch (error) {
        console.error(`core: could not restore status for tab ${record.id}: ${errorText(error)}`)
      }
    }
  }

  // A tab launched or resumed now starts idle: Claude is up and waiting for a prompt.
  track(input: TrackInput): void {
    this.close(input.tabId)
    const watch = this.open({
      tabId: input.tabId,
      spoolFile: input.spoolFile,
      resumeId: input.sessionId,
      status: { state: 'idle', since: this.clock() },
    })
    this.writeSnapshot(watch)
  }

  start(): void {
    if (this.timer !== undefined) return
    this.timer = setInterval(() => {
      this.tick().catch((error: unknown) => console.error(`core: status check failed: ${errorText(error)}`))
    }, this.tickMs)
  }

  // One pass of the timers, for every tab: a tab whose holder tab is gone is unknown. A working tab reads
  // its screen for real activity; then the watchdog checks silence, and each needs-you tab reads its screen
  // for the cross-check. Public so tests can drive it with an injected clock.
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
        if (watch.status.state === 'working') await this.readWorkingScreen(watch)
        if (this.watches.get(watch.tabId) !== watch) continue
        const silent = watch.watchdog.check(this.clock())
        if (silent) {
          this.apply(watch, silent)
          continue
        }
        if (watch.status.state !== 'needs-you') continue
        let screen: string
        try {
          screen = await this.options.screen(watch.tabId)
        } catch {
          this.fallToUnknown(watch, this.clock())
          continue
        }
        if (this.watches.get(watch.tabId) !== watch) continue
        const stuck = watch.check.check(screen, this.clock())
        if (stuck) this.apply(watch, stuck)
      }
    } finally {
      this.ticking = false
    }
  }

  // A change in the normalised screen is real activity for a working tab, so a moving spinner or a
  // ticking timer does not count. The first read is the baseline. A failed read is skipped: the watchdog decides.
  private async readWorkingScreen(watch: Watch): Promise<void> {
    let text: string
    try {
      text = normaliseScreen(await this.options.screen(watch.tabId))
    } catch {
      return
    }
    if (this.watches.get(watch.tabId) !== watch) return
    if (watch.screen !== undefined && text !== watch.screen) watch.watchdog.progress(this.clock())
    watch.screen = text
  }

  // Agents for the window's sidebar. A tab is resumable when its holder tab is gone and it has a session id.
  list(alive: Set<string>): AgentInfo[] {
    return [...this.watches.values()].map((watch) => {
      const { status } = watch
      return {
        tabId: watch.tabId,
        agent: 'claude',
        state: status.state,
        ...(status.state === 'needs-you' ? { reason: status.reason } : {}),
        since: status.since,
        source: AGENT_SOURCE,
        resumable: !alive.has(watch.tabId) && watch.resumeId !== undefined,
      }
    })
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

  private open(input: { tabId: string; spoolFile: string; resumeId: string | undefined; status: Status }): Watch {
    const now = this.clock()
    const watch: Watch = {
      tabId: input.tabId,
      spoolFile: input.spoolFile,
      resumeId: input.resumeId,
      status: input.status,
      check: createCrossCheck({ clock: this.clock, graceMs: this.graceMs }),
      watchdog: createWatchdog({ clock: this.clock, silenceMs: this.options.silenceMs }),
      screen: undefined,
      source: undefined,
    }
    watch.check.observe(input.status)
    watch.watchdog.observe(input.status)
    watch.watchdog.heartbeat(now)
    // Counted as progress from now; replayed records below then set it to their own times.
    watch.watchdog.progress(now)
    this.watches.set(input.tabId, watch)
    // The source may deliver events before it returns, so the watch is already registered.
    watch.source = this.options.createSource({
      spoolFile: input.spoolFile,
      offsetFile: path.join(this.agentDir(), `${input.tabId}.offset`),
      clock: this.clock,
      onEvent: (event, at) => this.onEvent(watch, event, at),
    })
    return watch
  }

  private onEvent(watch: Watch, event: StatusEvent, at: number): void {
    if (this.watches.get(watch.tabId) !== watch) return
    const now = Number.isFinite(at) ? at : this.clock()
    if (event.kind === 'heartbeat') {
      watch.watchdog.heartbeat(this.clock())
      return
    }
    // Every hook record is real activity, including one that changes no state.
    watch.watchdog.progress(now)
    if (event.kind === 'session') {
      if (event.resumeId !== watch.resumeId) {
        watch.resumeId = event.resumeId
        try {
          this.options.onSession?.(watch.tabId, event.resumeId)
        } catch (error) {
          console.error(`core: could not save the session for tab ${watch.tabId}: ${errorText(error)}`)
        }
      }
      return
    }
    this.apply(watch, applyEvent(watch.status, event, now))
  }

  // Sets unknown for a tab that is gone or whose reader or screen cannot be read. A tab already unknown is left alone.
  private fallToUnknown(watch: Watch, now: number): void {
    if (watch.status.state !== 'unknown') this.apply(watch, unknownStatus(now))
  }

  private apply(watch: Watch, next: Status): void {
    if (next === watch.status) return
    watch.status = next
    watch.check.observe(next)
    watch.watchdog.observe(next)
    this.writeSnapshot(watch)
    const change: StatusChange = {
      tabId: watch.tabId,
      state: next.state as AgentStateName,
      since: next.since,
      source: AGENT_SOURCE,
      ...(next.state === 'needs-you' ? { reason: next.reason } : {}),
    }
    for (const listener of this.listeners) listener(change)
  }

  private agentDir(): string {
    return path.join(this.options.home, 'agents', AGENT_SOURCE)
  }

  private snapshotFile(tabId: string): string {
    return path.join(this.agentDir(), `${tabId}.status.json`)
  }

  private writeSnapshot(watch: Watch): void {
    const file = this.snapshotFile(watch.tabId)
    const body = { status: watch.status, resumeId: watch.resumeId }
    try {
      fs.mkdirSync(this.agentDir(), { recursive: true, mode: 0o700 })
      fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(body)}\n`, { mode: 0o600 })
      fs.renameSync(`${file}.tmp`, file)
    } catch (error) {
      console.error(`core: could not save status for tab ${watch.tabId}: ${errorText(error)}`)
    }
  }

  // A missing or unreadable snapshot is no status at all; the caller then starts unknown.
  private readSnapshot(tabId: string): Status | null {
    let parsed: unknown
    try {
      parsed = JSON.parse(fs.readFileSync(this.snapshotFile(tabId), 'utf8'))
    } catch {
      return null
    }
    const status = (parsed as { status?: Partial<Status> & { reason?: unknown } } | null)?.status
    if (!status || typeof status.state !== 'string' || !STATE_NAMES.has(status.state)) return null
    if (typeof status.since !== 'number' || !Number.isFinite(status.since)) return null
    if (status.state === 'needs-you') {
      if (typeof status.reason !== 'string' || !REASONS.has(status.reason)) return null
      return { state: 'needs-you', reason: status.reason as NeedsYouReason, since: status.since }
    }
    return { state: status.state, since: status.since } as Status
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
