import { dayKey, shiftDay } from '../../protocol/days.ts'
import type { UsageAgent, UsageAgentSummary, UsageDay, UsageTotals } from '../../protocol/messages.ts'
import type { UsageRequest } from './history.ts'

export const DEFAULT_DAYS = 30
export const MAX_DAYS = 400
// An agent shows only if it made a request within this many days, today included.
const QUALIFYING_DAYS = 30

// GitHub AI Credits are what Copilot's records count in nano AIU: 1 credit = 1,000,000,000 nano AIU = $0.01. Confirmed against
// GitHub's pricing page (GPT-6 Luna, $0.10 per million input tokens) and the `costPerBatch` of 10,000,000,000 in Copilot's own records.
export const NANO_AIU_PER_CREDIT = 1e9

// The agents whose requests carry a credit figure; for the others no request is "without credits", there are none to count.
const CREDIT_AGENTS: readonly UsageAgent[] = ['copilot']

const empty = (): UsageTotals => ({ requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, credits: 0, withoutCredits: 0 })

// Totals are summed in nano AIU, so the sums are exact, and turned into credits once, when the summary is done.
function add(into: UsageTotals, request: UsageRequest): void {
  if (request.nanoAiu !== null) into.credits += request.nanoAiu
  else if (CREDIT_AGENTS.includes(request.agent)) into.withoutCredits++
  into.requests++
  into.input += request.input
  into.output += request.output
  into.cacheRead += request.cacheRead
  into.cacheWrite += request.cacheWrite
}

const inCredits = <T extends UsageTotals>(totals: T): T => ({ ...totals, credits: totals.credits / NANO_AIU_PER_CREDIT })

export const clampDays = (days: unknown): number => (typeof days === 'number' && Number.isInteger(days) ? Math.min(MAX_DAYS, Math.max(1, days)) : DEFAULT_DAYS)

// What the usage panel shows per agent: per-day totals for the last `days` days, and the Today / 7 days / 30 days totals. Days are
// the human's local days. An agent with no request in the last 30 days is left out.
export function summarizeAgents(requests: Iterable<UsageRequest>, now: number, days: number): UsageAgentSummary[] {
  const today = dayKey(now)
  const rangeStart = shiftDay(today, -(days - 1))
  const week = shiftDay(today, -6)
  const month = shiftDay(today, -(QUALIFYING_DAYS - 1))
  const agents = new Map<UsageAgent, { perDay: Map<string, UsageDay>; today: UsageTotals; last7: UsageTotals; last30: UsageTotals }>()
  for (const request of requests) {
    const day = dayKey(request.at)
    // A request stamped after today (a clock that moved back) belongs to no window yet.
    if (day > today) continue
    let agent = agents.get(request.agent)
    if (agent === undefined) agents.set(request.agent, (agent = { perDay: new Map(), today: empty(), last7: empty(), last30: empty() }))
    if (day >= month) add(agent.last30, request)
    if (day >= week) add(agent.last7, request)
    if (day === today) add(agent.today, request)
    if (day >= rangeStart) {
      let total = agent.perDay.get(day)
      if (total === undefined) agent.perDay.set(day, (total = { day, ...empty() }))
      add(total, request)
    }
  }
  return [...agents]
    .filter(([, agent]) => agent.last30.requests > 0)
    .map(([agent, found]) => ({
      agent,
      hasCredits: CREDIT_AGENTS.includes(agent),
      days: [...found.perDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1)).map(inCredits),
      today: inCredits(found.today),
      last7: inCredits(found.last7),
      last30: inCredits(found.last30),
    }))
    .sort((a, b) => (a.agent < b.agent ? -1 : 1))
}
