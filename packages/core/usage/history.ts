import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { UsageAgent } from '../../protocol/messages.ts'
import { atomicWrite } from '../config/store.ts'

// One model call an agent made (GLOSSARY: Request). The usage history keeps exactly this per request and nothing else: no
// conversation text, no session name, no prompt. Tokens are carried as fresh input, output, cache read and cache write.
export interface UsageRequest {
  // Unique within its agent: what makes two lines of an agent's records the same request.
  key: string
  agent: UsageAgent
  // Where it ran, within the agent: Claude's is CLAUDE_CODE or CLAUDE_DESKTOP from the record's entrypoint (UNTAGGED in a history
  // written before the tag existed), Copilot's is 'copilot' or OPENCODE_SOURCE.
  source: string
  model: string
  // The working folder of the request, '' when the record named none.
  folder: string
  // When it was made, in ms since the epoch. The day is derived in local time wherever it is shown.
  at: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  // Made by a helper agent (a subagent) rather than the main session.
  helper: boolean
  // What the request cost in Copilot's own unit, nano AIU (1,000,000,000 per GitHub AI Credit), kept raw so sums stay exact.
  // null when the record carried no credit figure, and always null for an agent without credits (Claude).
  nanoAiu: number | null
  // Whether Grove ran the session the request belongs to, decided when the request was recorded: true it did, false it did not
  // (Not tracked by Grove), null Grove cannot tell. Claude Desktop is never run in Grove, so it is always false.
  inGrove: boolean | null
}

// Claude's sources. A history written before the tag existed holds UNTAGGED: a re-read replaces it with the real one.
export const CLAUDE_UNTAGGED = 'claude'
export const CLAUDE_CODE = 'claude-code'
export const CLAUDE_DESKTOP = 'claude-desktop'
// Copilot's other source: requests OpenCode made on Copilot's models. Copilot CLI's own are 'copilot'.
export const OPENCODE_SOURCE = 'opencode'

const AGENTS: readonly string[] = ['claude', 'copilot'] satisfies UsageAgent[]
const VERSION = 1
// How many requests are written before the event loop is given back: about 1 to 2 ms of work.
const SAVE_SLICE = 1500
const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

export interface HistoryFile {
  version: typeof VERSION
  since: number
  floor: number | null
  built: boolean
  readers: Record<string, unknown>
  // One row per request, keyed `<agent>:<key>`: [at, source, model, folder, input, output, cacheRead, cacheWrite, helper, nanoAiu, inGrove].
  // A row of 9 (no credit figure) or 10 (no Grove flag: Grove could not tell) is read too.
  requests: Record<string, unknown[]>
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

function decode(storedKey: string, row: unknown): UsageRequest | undefined {
  const split = storedKey.indexOf(':')
  const agent = storedKey.slice(0, split)
  if (split < 1 || !AGENTS.includes(agent) || !Array.isArray(row) || (row.length < 9 || row.length > 11)) return undefined
  const [at, source, model, folder, input, output, cacheRead, cacheWrite, helper, nanoAiu, inGrove] = row as unknown[]
  if (typeof at !== 'number' || !Number.isFinite(at) || typeof source !== 'string' || typeof model !== 'string' || typeof folder !== 'string') return undefined
  if (![input, output, cacheRead, cacheWrite].every(isCount) || (nanoAiu !== undefined && nanoAiu !== null && !isCount(nanoAiu))) return undefined
  return {
    key: storedKey.slice(split + 1),
    agent: agent as UsageAgent,
    source,
    model,
    folder,
    at,
    input: input as number,
    output: output as number,
    cacheRead: cacheRead as number,
    cacheWrite: cacheWrite as number,
    helper: helper === 1,
    nanoAiu: typeof nanoAiu === 'number' ? nanoAiu : null,
    inGrove: inGrove === 1 ? true : inGrove === 0 ? false : null,
  }
}

const encode = (r: UsageRequest): unknown[] => [r.at, r.source, r.model, r.folder, r.input, r.output, r.cacheRead, r.cacheWrite, r.helper ? 1 : 0, r.nanoAiu, r.inGrove === null ? null : r.inGrove ? 1 : 0]

// Grove's own saved record of usage (ADR 0003): one keyed entry per request, per machine, in the Grove home. A file Grove cannot
// read is set aside and a new history starts; the agents' files are never touched.
export class UsageHistory {
  private rows = new Map<string, UsageRequest>()
  // When the history was started, or last wiped.
  since: number
  // Set by a wipe: requests made before it are not recorded again.
  floor: number | null = null
  // True once the first read of the agents' files has finished.
  built = false
  readers: Record<string, unknown> = {}
  // Counts changes, so a summary can be reused while nothing changed.
  revision = 0
  // Counts the writes of the whole file and the wipes, so a slow write that something later overtook knows to give up.
  private writes = 0
  // Told of every request the history gains or changes: what it held under the key until now (undefined for a new one), and what it holds.
  observer: ((before: UsageRequest | undefined, after: UsageRequest) => void) | undefined

  constructor(
    private readonly file: string,
    now: number,
  ) {
    this.since = now
  }

  static load(file: string, now: number): UsageHistory {
    const history = new UsageHistory(file, now)
    history.sweep()
    let text: string
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') history.setAside(error)
      return history
    }
    try {
      const parsed = JSON.parse(text) as Partial<HistoryFile> | null
      if (parsed === null || typeof parsed !== 'object' || parsed.version !== VERSION || typeof parsed.since !== 'number' || typeof parsed.requests !== 'object' || parsed.requests === null) {
        throw new Error('not a usage history this core reads')
      }
      history.since = parsed.since
      history.floor = typeof parsed.floor === 'number' ? parsed.floor : null
      history.built = parsed.built === true
      history.readers = typeof parsed.readers === 'object' && parsed.readers !== null ? parsed.readers : {}
      for (const [key, row] of Object.entries(parsed.requests)) {
        const request = decode(key, row)
        if (request) history.rows.set(key, request)
      }
    } catch (error) {
      const fresh = new UsageHistory(file, now)
      fresh.setAside(error)
      return fresh
    }
    return history
  }

  // A write that was killed leaves its temp file behind. Nothing else writes next to the history, so every one found is stale.
  private sweep(): void {
    const base = path.basename(this.file)
    try {
      for (const name of fs.readdirSync(path.dirname(this.file))) if (name.startsWith(`${base}.`) && name.endsWith('.tmp')) fs.rmSync(path.join(path.dirname(this.file), name), { force: true })
    } catch {}
  }

  private setAside(error: unknown): void {
    console.error(`core: usage history unreadable, starting a new one: ${error instanceof Error ? error.message : String(error)}`)
    try {
      fs.renameSync(this.file, `${this.file}.corrupt-${Date.now()}`)
    } catch {}
  }

  get size(): number {
    return this.rows.size
  }

  requests(): IterableIterator<UsageRequest> {
    return this.rows.values()
  }

  // Records a request, or merges it into the one already kept under its key. Merging keeps the first occurrence (the earliest
  // time, and its folder: a resumed session copies old history under the old time) and the largest output count with the
  // token counts of that line (a streamed response writes the same request again with a growing count). True when it changed.
  add(request: UsageRequest): boolean {
    if (this.floor !== null && request.at < this.floor) return false
    const storedKey = `${request.agent}:${request.key}`
    const kept = this.rows.get(storedKey)
    if (kept === undefined) {
      this.rows.set(storedKey, request)
      this.revision++
      this.observer?.(undefined, request)
      return true
    }
    const first = request.at < kept.at ? request : kept
    const other = first === kept ? request : kept
    const counted = request.output > kept.output ? request : kept
    // A re-read can tell more than what was saved: a real source for the untagged one, a known Grove flag for an unknown one. What
    // is already specific or known stays, so a re-read never flips an answer, and the counts still come from one line, never both.
    const source = first.source === CLAUDE_UNTAGGED ? other.source : first.source
    const inGrove = first.inGrove ?? other.inGrove
    if (first === kept && counted === kept && source === kept.source && inGrove === kept.inGrove) return false
    const merged: UsageRequest = {
      ...first,
      source,
      inGrove,
      input: counted.input,
      output: counted.output,
      cacheRead: counted.cacheRead,
      cacheWrite: counted.cacheWrite,
      nanoAiu: counted.nanoAiu ?? first.nanoAiu,
    }
    this.rows.set(storedKey, merged)
    this.revision++
    this.observer?.(kept, merged)
    return true
  }

  // Forgets every request and starts again from `now`: nothing made before it is recorded again.
  wipe(now: number): void {
    this.rows.clear()
    this.since = now
    this.floor = now
    this.built = false
    this.readers = {}
    this.revision++
    this.writes++
  }

  // Writes the whole file atomically: a temp file renamed over, owner-only (atomicWrite). Holds the loop for the whole write, so the
  // service uses it only when the core is closing or the history is empty; a running core uses saveAsync.
  save(): void {
    this.writes++
    const requests: Record<string, unknown[]> = {}
    for (const [key, request] of this.rows) requests[key] = encode(request)
    const body: HistoryFile = { version: VERSION, since: this.since, floor: this.floor, built: this.built, readers: this.readers, requests }
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    atomicWrite(this.file, JSON.stringify(body))
  }

  // The same file, written in slices: `pause` gives the event loop back between them (default: one turn of the loop), so rewriting a
  // history of hundreds of thousands of requests never holds up the core. It is as crash-safe as `save`: the slices go to a temp file
  // that is renamed over the history only when whole, so a kill leaves the last good file, and the next load sweeps the temp file.
  // The place the readers had got to is taken before the first slice and the requests after it, so the file never knows a place its
  // requests do not reach: a restart from it reads a little again, and the keys keep that from counting twice. Resolves false, writing
  // nothing, when a wipe or a later save overtook it.
  async saveAsync(pause: () => Promise<void> = yieldToLoop): Promise<boolean> {
    const mine = ++this.writes
    const head = JSON.stringify({ version: VERSION, since: this.since, floor: this.floor, built: this.built, readers: this.readers }).slice(0, -1)
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${crypto.randomBytes(8).toString('hex')}.tmp`
    const handle = await fs.promises.open(tmp, 'wx', 0o600)
    let renamed = false
    try {
      await handle.write(`${head},"requests":{`)
      let slice: string[] = []
      let first = true
      for (const [key, request] of this.rows) {
        slice.push(`${first ? '' : ','}${JSON.stringify(key)}:${JSON.stringify(encode(request))}`)
        first = false
        if (slice.length >= SAVE_SLICE) {
          await handle.write(slice.join(''))
          slice = []
          await pause()
          if (this.writes !== mine) return false
        }
      }
      await handle.write(`${slice.join('')}}}`)
      await handle.close()
      if (this.writes !== mine) return false
      fs.renameSync(tmp, this.file)
      renamed = true
      return true
    } finally {
      await handle.close().catch(() => undefined)
      if (!renamed) fs.rmSync(tmp, { force: true })
    }
  }
}
