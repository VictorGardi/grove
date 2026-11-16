import type { UsageAgent } from '../../protocol/messages.ts'

// One model call an agent made (GLOSSARY: Request). The usage history holds exactly this per request and nothing else: no
// conversation text, no session name, no prompt. Tokens are carried as fresh input, output, cache read and cache write.
export interface UsageRequest {
  // Unique within its agent: what makes two lines of an agent's records the same request.
  key: string
  agent: UsageAgent
  // Where it ran, within the agent: Claude's is CLAUDE_CODE or CLAUDE_DESKTOP from the record's entrypoint Copilot's is 'copilot' or OPENCODE_SOURCE.
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

// Claude's sources.
export const CLAUDE_CODE = 'claude-code'
export const CLAUDE_DESKTOP = 'claude-desktop'
// Copilot's other source: requests OpenCode made on Copilot's models. Copilot CLI's own are 'copilot'.
export const OPENCODE_SOURCE = 'opencode'

// The usage history (GLOSSARY): one keyed entry per request, held in memory only and rebuilt from the agents' files at every core
// start (ADR 0004). Nothing is written to disk.
export class UsageHistory {
  // Per agent, keyed by the request's own key: the row and its map key are then the same string, not two copies of a long id.
  private rows = new Map<UsageAgent, Map<string, UsageRequest>>()
  private count = 0
  // One shared instance per distinct folder, model and source: hundreds of thousands of rows name a few hundred of each.
  private strings = new Map<string, string>()
  // Counts changes, so a summary can be reused while nothing changed.
  revision = 0
  // Told of every request the history gains or changes: what it held under the key until now (undefined for a new one), and what it holds.
  observer: ((before: UsageRequest | undefined, after: UsageRequest) => void) | undefined

  get size(): number {
    return this.count
  }

  *requests(): IterableIterator<UsageRequest> {
    for (const rows of this.rows.values()) yield* rows.values()
  }

  private intern(value: string): string {
    const shared = this.strings.get(value)
    if (shared !== undefined) return shared
    this.strings.set(value, value)
    return value
  }

  // Records a request, or merges it into the one already kept under its key. Merging keeps the first occurrence (the earliest
  // time, and its folder: a resumed session copies old history under the old time) and the largest output count with the
  // token counts of that line (a streamed response writes the same request again with a growing count). True when it changed.
  add(request: UsageRequest): boolean {
    request.source = this.intern(request.source)
    request.model = this.intern(request.model)
    request.folder = this.intern(request.folder)
    let rows = this.rows.get(request.agent)
    if (rows === undefined) this.rows.set(request.agent, (rows = new Map()))
    const kept = rows.get(request.key)
    if (kept === undefined) {
      rows.set(request.key, request)
      this.count++
      this.revision++
      this.observer?.(undefined, request)
      return true
    }
    const first = request.at < kept.at ? request : kept
    const other = first === kept ? request : kept
    const counted = request.output > kept.output ? request : kept
    // A later read can tell more than an earlier one: a known Grove flag for an unknown one, and "in Grove" for one tagged not
    // Grove's before Grove's record of its session was in (a missing record proves nothing, a record does). The counts still come
    // from one line, never both.
    const inGrove = first.inGrove === true || other.inGrove === true ? true : (first.inGrove ?? other.inGrove)
    if (first === kept && counted === kept && inGrove === kept.inGrove) return false
    const merged: UsageRequest = {
      ...first,
      inGrove,
      input: counted.input,
      output: counted.output,
      cacheRead: counted.cacheRead,
      cacheWrite: counted.cacheWrite,
      nanoAiu: counted.nanoAiu ?? first.nanoAiu,
    }
    rows.set(request.key, merged)
    this.revision++
    this.observer?.(kept, merged)
    return true
  }
}
