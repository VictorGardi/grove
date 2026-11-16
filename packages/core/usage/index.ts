import { dayKey } from '../../protocol/days.ts'
import type { UsageAgent, UsageSplit, UsageTotals } from '../../protocol/messages.ts'
import { CLAUDE_DESKTOP, type UsageRequest } from './history.ts'

// The agents whose requests carry a credit figure; for the others no request is "without credits", there are none to count.
export const CREDIT_AGENTS: readonly UsageAgent[] = ['copilot']

// The order the splits are listed in.
export const SPLITS: readonly UsageSplit[] = ['desktop', 'grove', 'other', 'unknown']

// Where a request ran, as the panel splits it: Claude Desktop apart, the rest by whether Grove ran the session.
export const splitOf = (request: UsageRequest): UsageSplit =>
  request.source === CLAUDE_DESKTOP ? 'desktop' : request.inGrove === true ? 'grove' : request.inGrove === false ? 'other' : 'unknown'

export const emptyTotals = (): UsageTotals => ({ requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, credits: 0, withoutCredits: 0 })

// Credits are summed in nano AIU (see summary.ts), so the sums are exact and a request can be taken out again without drift.
function count(into: UsageTotals, request: UsageRequest, sign: 1 | -1): void {
  if (request.nanoAiu !== null) into.credits += sign * request.nanoAiu
  else if (CREDIT_AGENTS.includes(request.agent)) into.withoutCredits += sign
  into.requests += sign
  into.input += sign * request.input
  into.output += sign * request.output
  into.cacheRead += sign * request.cacheRead
  into.cacheWrite += sign * request.cacheWrite
}

export function plusTotals(into: UsageTotals, other: UsageTotals): void {
  into.requests += other.requests
  into.input += other.input
  into.output += other.output
  into.cacheRead += other.cacheRead
  into.cacheWrite += other.cacheWrite
  into.credits += other.credits
  into.withoutCredits += other.withoutCredits
}

// What one agent's requests of one local day add up to, split the ways the panel breaks them down.
export interface DayBucket {
  totals: UsageTotals
  helper: number
  // Requests per local hour of the day.
  hours: number[]
  models: Map<string, UsageTotals>
  folders: Map<string, UsageTotals>
  sources: Map<UsageSplit, UsageTotals>
}

const newBucket = (): DayBucket => ({ totals: emptyTotals(), helper: 0, hours: new Array<number>(24).fill(0), models: new Map(), folders: new Map(), sources: new Map() })

function bump<K>(map: Map<K, UsageTotals>, key: K, request: UsageRequest, sign: 1 | -1): void {
  let totals = map.get(key)
  if (totals === undefined) map.set(key, (totals = emptyTotals()))
  count(totals, request, sign)
  if (totals.requests === 0) map.delete(key)
}

// The usage history added up per agent and local day, kept in step with the history one request at a time: a request that
// arrives, or is merged into the one already kept, is a small change here, so a summary never rescans every request. Days are
// the local days of the clock's time zone when the request was applied.
export class UsageIndex {
  private readonly agents = new Map<UsageAgent, Map<string, DayBucket>>()

  // `before` is what the history held under the request's key until now, if anything.
  apply(before: UsageRequest | undefined, after: UsageRequest): void {
    if (before !== undefined) this.change(before, -1)
    this.change(after, 1)
  }

  clear(): void {
    this.agents.clear()
  }

  // The agent's days with at least one request.
  days(agent: UsageAgent): ReadonlyMap<string, DayBucket> | undefined {
    return this.agents.get(agent)
  }

  agentsSeen(): UsageAgent[] {
    return [...this.agents.keys()]
  }

  private change(request: UsageRequest, sign: 1 | -1): void {
    let days = this.agents.get(request.agent)
    if (days === undefined) this.agents.set(request.agent, (days = new Map()))
    const day = dayKey(request.at)
    let bucket = days.get(day)
    if (bucket === undefined) days.set(day, (bucket = newBucket()))
    count(bucket.totals, request, sign)
    if (request.helper) bucket.helper += sign
    bucket.hours[new Date(request.at).getHours()] += sign
    bump(bucket.models, request.model, request, sign)
    bump(bucket.folders, request.folder, request, sign)
    bump(bucket.sources, splitOf(request), request, sign)
    if (bucket.totals.requests === 0) days.delete(day)
    if (days.size === 0) this.agents.delete(request.agent)
  }
}
