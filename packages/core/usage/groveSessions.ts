import fs from 'node:fs'
import path from 'node:path'
import type { UsageAgent } from '../../protocol/messages.ts'
import { sliceLines } from './fileSlice.ts'
import type { UsageRequest } from './history.ts'

// Which sessions Grove ran, from Grove's own per-tab records: the files Grove keeps under <home>/agents/<agent>/ for every tab.
//  - <tab>.jsonl is the tab's hook stream (Claude: SessionStart and more, `{event, at, payload: {session_id}}`; Copilot:
//    `{t, e: {sessionId, timestamp}}`). Every line names a session and the time Grove saw it.
//  - <tab>.status.json holds the session the tab is in now (`resumeId`), <tab>.usage.json (Claude) the last context reading.
//    Neither says when the session began.
// Nothing in Grove deletes these files: closing or killing a tab only stops watching them. So a tab that is gone still counts.
// Sessions of the tabs open now (Grove's saved state) are added too, as `live`.

const AGENTS: readonly UsageAgent[] = ['claude', 'copilot']
const SCHEMA = 1
const CHUNK_BYTES = 1 << 20
// A hook record is written before the requests of its session and a refresh reads every file, so a request made before a refresh
// began is settled by it. The margin covers the agent's clock and Grove's disagreeing a little.
const FRESH_MARGIN_MS = 60_000

export interface GroveSessionsOptions {
  home: string
  // The sessions of the tabs open now, from Grove's saved state.
  live?: () => Array<{ agent: UsageAgent; sessionId: string }>
  chunkBytes?: number
  // The clock the freshness of Grove's records is measured by. Default Date.now.
  now?: () => number
}

const record = (value: unknown): Record<string, unknown> | undefined => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined)
const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)
const time = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined)
const keyOf = (agent: UsageAgent, sessionId: string): string => `${agent}:${sessionId}`

export class GroveSessions {
  // Where the reading of each hook stream stands, by `<agent>/<file name>`.
  private offsets = new Map<string, number>()
  // When Grove first had a record of the session, in ms; -Infinity when its records say a session is Grove's but not since when.
  private first = new Map<string, number>()
  // The earliest time Grove has a record for, per agent: when Grove began recording sessions.
  private began = new Map<UsageAgent, number>()
  // The small files already read, by size and time, so a pass reads only what changed.
  private stamps = new Map<string, string>()
  // Requests made after the last refresh began were tagged without that refresh being able to know their session, so a tag other than
  // "in Grove" on them is a guess. `provenTo` is the time the last refresh settled; `doubts` are the guesses made after it.
  private provenTo: number | undefined
  private doubts: Array<{ sessionId: string; request: UsageRequest }> = []

  constructor(private readonly options: GroveSessionsOptions) {}

  // When Grove first had a record of this session (-Infinity: from its start, when it began is not recorded), or undefined when
  // Grove has none: it did not run it, or its records are gone.
  firstAt(agent: UsageAgent, sessionId: string): number | undefined {
    return this.first.get(keyOf(agent, sessionId))
  }

  // When Grove began recording this agent's sessions: the earliest record on this machine, or undefined when there is none.
  trackedSince(agent: UsageAgent): number | undefined {
    return this.began.get(agent)
  }

  // Whether Grove ran the session a request at `at` belongs to: true when Grove had a record of the session by then (a session
  // resumed in Grove keeps its older requests out: they are before its first record), false when it had not, null for Claude Code
  // before Grove began recording Claude sessions, when there is nothing to tell by. Copilot is known back to its first session:
  // one Grove has no record of was not Grove's.
  ranInGrove(agent: UsageAgent, sessionId: string, at: number): boolean | null {
    const first = sessionId === '' ? undefined : this.first.get(keyOf(agent, sessionId))
    if (first !== undefined && at >= first) return true
    if (agent === 'copilot') return false
    const began = this.began.get(agent)
    return began !== undefined && at >= began ? false : null
  }

  // Notes a request tagged as not Grove's (or unknown) when Grove's records may not have caught up with its session yet.
  doubt(request: UsageRequest, sessionId: string): void {
    if (this.provenTo !== undefined && request.at > this.provenTo) this.doubts.push({ sessionId, request })
  }

  // The doubted requests of `agent` that Grove's records now prove were its own, to be recorded again as Grove's. The ones a refresh
  // has since settled are let go.
  corrections(agent: UsageAgent): UsageRequest[] {
    const proven: UsageRequest[] = []
    this.doubts = this.doubts.filter((doubt) => {
      if (doubt.request.agent !== agent) return true
      if (this.ranInGrove(agent, doubt.sessionId, doubt.request.at) === true) {
        proven.push({ ...doubt.request, inGrove: true })
        return false
      }
      return this.provenTo === undefined || doubt.request.at > this.provenTo
    })
    return proven
  }

  // A record with a time sets when the session was first seen. A record without one (a status file, a tab open now) says only that the
  // session is Grove's, from its start; it counts only while no record has a time, so it never widens a resumed session's Grove part.
  private see(agent: UsageAgent, sessionId: string, at: number | undefined): void {
    const key = keyOf(agent, sessionId)
    const before = this.first.get(key)
    if (at === undefined) {
      if (before === undefined) this.first.set(key, -Infinity)
      return
    }
    if (before === undefined || before === -Infinity || at < before) this.first.set(key, at)
    this.began.set(agent, Math.min(this.began.get(agent) ?? at, at))
  }

  // Reads what the per-tab files gained since the last time. A missing folder, an unreadable file or a line that is not what Grove
  // writes gives nothing and never stops the rest.
  async refresh(): Promise<void> {
    const started = (this.options.now ?? Date.now)()
    for (const agent of AGENTS) {
      let names: string[]
      try {
        names = await fs.promises.readdir(path.join(this.options.home, 'agents', agent))
      } catch {
        continue
      }
      for (const name of names) {
        const file = path.join(this.options.home, 'agents', agent, name)
        try {
          if (name.endsWith('.jsonl')) await this.stream(agent, name, file)
          else if (name.endsWith('.status.json') || name.endsWith('.usage.json')) await this.snapshot(agent, name, file)
        } catch {}
      }
    }
    for (const live of this.options.live?.() ?? []) if (live.sessionId !== '') this.see(live.agent, live.sessionId, undefined)
    this.provenTo = started - FRESH_MARGIN_MS
  }

  private async stream(agent: UsageAgent, name: string, file: string): Promise<void> {
    const stat = await fs.promises.stat(file)
    const id = `${agent}/${name}`
    let offset = this.offsets.get(id) ?? 0
    // A stream shorter than where the reading stood was replaced: it is read from the start (what was learnt stays).
    if (stat.size < offset) offset = 0
    while (offset < stat.size) {
      const { lines, next, more } = await sliceLines(file, offset, stat.size, this.options.chunkBytes ?? CHUNK_BYTES)
      for (const line of lines) this.streamLine(agent, line)
      if (next === offset) break
      offset = next
      if (!more) break
    }
    this.offsets.set(id, offset)
  }

  private streamLine(agent: UsageAgent, line: string): void {
    if (line === '') return
    let parsed: Record<string, unknown> | undefined
    try {
      parsed = record(JSON.parse(line))
    } catch {
      return
    }
    if (parsed === undefined) return
    if (agent === 'claude') {
      const sessionId = text(record(parsed.payload)?.session_id)
      const at = time(parsed.at)
      if (sessionId !== undefined && at !== undefined) this.see(agent, sessionId, at)
    } else {
      const event = record(parsed.e)
      const sessionId = text(event?.sessionId)
      const at = time(event?.timestamp) ?? (typeof parsed.t === 'string' ? time(Date.parse(parsed.t)) : undefined)
      if (sessionId !== undefined && at !== undefined) this.see(agent, sessionId, at)
    }
  }

  private async snapshot(agent: UsageAgent, name: string, file: string): Promise<void> {
    const stat = await fs.promises.stat(file)
    const stamp = `${stat.size}:${stat.mtimeMs}`
    const id = `${agent}/${name}`
    if (this.stamps.get(id) === stamp) return
    this.stamps.set(id, stamp)
    const body = record(JSON.parse(await fs.promises.readFile(file, 'utf8')))
    if (body === undefined) return
    if (name.endsWith('.status.json')) {
      const sessionId = text(body.resumeId)
      if (sessionId !== undefined) this.see(agent, sessionId, undefined)
    } else {
      const payload = record(body.payload)
      const sessionId = text(payload?.session_id)
      if (sessionId === undefined) return
      this.see(agent, sessionId, undefined)
      // The reading's time says Grove was recording by then, though not since when the session began.
      const at = time(body.at)
      if (at !== undefined) this.began.set(agent, Math.min(this.began.get(agent) ?? at, at))
    }
  }

  // What to save with the history, so a restart does not read every per-tab file again, and what Grove learnt survives a file
  // being removed.
  state(): unknown {
    return {
      schema: SCHEMA,
      files: Object.fromEntries(this.offsets),
      sessions: Object.fromEntries([...this.first].map(([key, at]) => [key, Number.isFinite(at) ? at : null])),
      began: Object.fromEntries(this.began),
    }
  }

  restore(state: unknown): void {
    const saved = record(state)
    this.offsets = new Map()
    this.first = new Map()
    this.began = new Map()
    this.stamps = new Map()
    if (saved === undefined || saved.schema !== SCHEMA) return
    for (const [id, offset] of Object.entries(record(saved.files) ?? {})) if (typeof offset === 'number' && offset >= 0) this.offsets.set(id, offset)
    for (const [key, at] of Object.entries(record(saved.sessions) ?? {})) {
      if (at === null) this.first.set(key, -Infinity)
      else if (time(at) !== undefined) this.first.set(key, at as number)
    }
    for (const agent of AGENTS) {
      const at = time(record(saved.began)?.[agent])
      if (at !== undefined) this.began.set(agent, at)
    }
  }
}
