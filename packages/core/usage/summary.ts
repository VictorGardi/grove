import { dayKey, shiftDay, weekdayOf } from '../../protocol/days.ts'
import type { UsageAgentSummary, UsageDay, UsageModelTotals, UsageRepositoryTotals, UsageTotals } from '../../protocol/messages.ts'
import { CREDIT_AGENTS, emptyTotals, plusTotals, type UsageIndex } from './index.ts'
import type { RepositoryRef } from './repositories.ts'

export const DEFAULT_DAYS = 30
export const MAX_DAYS = 400
// An agent shows only if it made a request within this many days, today included.
const QUALIFYING_DAYS = 30

// GitHub AI Credits are what Copilot's records count in nano AIU: 1 credit = 1,000,000,000 nano AIU = $0.01. Confirmed against
// GitHub's pricing page (GPT-6 Luna, $0.10 per million input tokens) and the `costPerBatch` of 10,000,000,000 in Copilot's own records.
export const NANO_AIU_PER_CREDIT = 1e9

// Totals are summed in nano AIU, so the sums are exact, and turned into credits once, when the summary is done.
const inCredits = <T extends UsageTotals>(totals: T): T => ({ ...totals, credits: totals.credits / NANO_AIU_PER_CREDIT })

export const clampDays = (days: unknown): number => (typeof days === 'number' && Number.isInteger(days) ? Math.min(MAX_DAYS, Math.max(1, days)) : DEFAULT_DAYS)

const byRequests = (a: UsageTotals, b: UsageTotals): number => b.requests - a.requests

function merged<K extends string>(into: Map<K, UsageTotals>, key: K, totals: UsageTotals): void {
  let sum = into.get(key)
  if (sum === undefined) into.set(key, (sum = emptyTotals()))
  plusTotals(sum, totals)
}

const modelsOf = (models: Map<string, UsageTotals>): UsageModelTotals[] =>
  [...models].map(([model, totals]) => ({ model, ...inCredits(totals) })).sort((a, b) => byRequests(a, b) || (a.model < b.model ? -1 : 1))

// What the usage panel shows per agent, from the index of the history: per-day detail for the last `days` days, the Today / 7 days /
// 30 days totals, and the hour, repository and model breakdowns over the last `range` days. Days are the human's local days. An agent
// with no request in the last 30 days is left out. `repositoryOf` says which repository a working folder belongs to.
export function summarizeAgents(index: UsageIndex, repositoryOf: (folder: string) => RepositoryRef, now: number, days: number, range: number): UsageAgentSummary[] {
  const today = dayKey(now)
  const detailStart = shiftDay(today, -(days - 1))
  const rangeStart = shiftDay(today, -(range - 1))
  const week = shiftDay(today, -6)
  const month = shiftDay(today, -(QUALIFYING_DAYS - 1))
  const found: UsageAgentSummary[] = []
  for (const agent of index.agentsSeen()) {
    const last30 = emptyTotals()
    const last7 = emptyTotals()
    const todays = emptyTotals()
    const perDay: UsageDay[] = []
    const hours = new Array<number>(168).fill(0)
    const models = new Map<string, UsageTotals>()
    const repositories = new Map<string, UsageRepositoryTotals>()
    for (const [day, bucket] of index.days(agent) ?? []) {
      // A request stamped after today (a clock that moved back) belongs to no window yet.
      if (day > today) continue
      if (day >= month) plusTotals(last30, bucket.totals)
      if (day >= week) plusTotals(last7, bucket.totals)
      if (day === today) plusTotals(todays, bucket.totals)
      if (day >= detailStart) perDay.push({ day, ...inCredits(bucket.totals), helperRequests: bucket.helper, models: modelsOf(bucket.models) })
      if (day >= rangeStart) {
        const row = weekdayOf(day) * 24
        for (let hour = 0; hour < 24; hour++) hours[row + hour] += bucket.hours[hour]
        for (const [model, totals] of bucket.models) merged(models, model, totals)
        for (const [folder, totals] of bucket.folders) {
          const repository = repositoryOf(folder)
          let sum = repositories.get(repository.id)
          if (sum === undefined) repositories.set(repository.id, (sum = { name: repository.name, space: repository.space, ...emptyTotals() }))
          plusTotals(sum, totals)
        }
      }
    }
    if (last30.requests === 0) continue
    found.push({
      agent,
      hasCredits: CREDIT_AGENTS.includes(agent),
      days: perDay.sort((a, b) => (a.day < b.day ? -1 : 1)),
      today: inCredits(todays),
      last7: inCredits(last7),
      last30: inCredits(last30),
      hours,
      repositories: [...repositories.values()].map(inCredits).sort((a, b) => byRequests(a, b) || ((a.name ?? '') < (b.name ?? '') ? -1 : 1)),
      models: modelsOf(models),
    })
  }
  return found.sort((a, b) => (a.agent < b.agent ? -1 : 1))
}
