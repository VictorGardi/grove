// What the usage panel says when a day, a total or a bar is pointed at, and which of the other cells that points at. Pure: no DOM, no clock.
// The summary holds no repository or hour per day, so a day links to the weekday it fell on and to its own bar, not to a repository.
import { shiftDay } from '../protocol/days.ts'
import type { UsageAgent, UsageSummary } from '../protocol/messages.ts'
import { NO_RECORD, creditsOf, formatDay, group, modelLabel, requestsLabel } from './usage-model.ts'

export interface DayTipLine {
  agent: UsageAgent
  title: string
  requests: string
  // The model with most of that day's requests, when the day names any.
  top: string | null
  credits: string | null
}

export interface DayTip {
  title: string
  lines: DayTipLine[]
  note: string | null
}

const AGENT_TITLES: Record<UsageAgent, string> = { claude: 'Claude', copilot: 'Copilot CLI' }

// A day older than anything the agents' files hold is not "no activity": the tip says so and carries no lines.
export function dayTip(summary: UsageSummary, day: string): DayTip {
  if (summary.ready === null || day < summary.ready.from) return { title: formatDay(day), lines: [], note: NO_RECORD }
  const lines = summary.agents.flatMap((agent): DayTipLine[] => {
    const found = agent.days.find((d) => d.day === day)
    if (found === undefined || found.requests === 0) return []
    const top = [...found.models].sort((a, b) => b.requests - a.requests)[0]
    return [{ agent: agent.agent, title: AGENT_TITLES[agent.agent], requests: requestsLabel(found.requests), top: top === undefined ? null : modelLabel(top.model), credits: creditsOf(found, agent.hasCredits) }]
  })
  return { title: formatDay(day), lines, note: lines.length === 0 ? 'No requests' : null }
}

export type TotalLabel = 'Today' | '7 days' | '30 days'
const SPAN: Record<TotalLabel, number> = { Today: 1, '7 days': 7, '30 days': 30 }

// How an agent's total compares with the period before it of the same length ("Yesterday 9, 3 more"), or null when that period reaches back
// past what the files hold (the summary always carries the days of a matrix, which is more than 60).
export function totalDelta(summary: UsageSummary, agent: UsageAgent, label: TotalLabel): string | null {
  const found = summary.agents.find((a) => a.agent === agent)
  if (found === undefined || summary.ready === null) return null
  const span = SPAN[label]
  const sum = (from: string, to: string): number => found.days.filter((d) => d.day >= from && d.day <= to).reduce((n, d) => n + d.requests, 0)
  const currentFrom = shiftDay(summary.today, -(span - 1))
  const previousFrom = shiftDay(currentFrom, -span)
  if (previousFrom < summary.ready.from) return null
  const now = sum(currentFrom, summary.today)
  const before = sum(previousFrom, shiftDay(currentFrom, -1))
  const name = label === 'Today' ? 'yesterday' : `the ${span} days before`
  const diff = now - before
  return `${diff === 0 ? 'Same as' : `${group(Math.abs(diff))} ${diff > 0 ? 'more than' : 'fewer than'}`} ${name} (${group(before)})`
}

// The mean of the agents' progress while the first read runs, 0 to 1; null when no agent can say how far it has got.
export function buildingProgress(summary: UsageSummary): number | null {
  if (!summary.building || summary.progress.length === 0) return null
  return Math.min(1, Math.max(0, summary.progress.reduce((sum, p) => sum + p.fraction, 0) / summary.progress.length))
}

// '1,234 requests' as { count: 1234, rest: ' requests' }, so the panel can tick the number up and keep the words.
export function splitCount(text: string): { count: number; rest: string } | null {
  const match = /^(\d{1,3}(?:,\d{3})*|\d+)(\D.*)?$/.exec(text)
  return match === null ? null : { count: Number(match[1].replace(/,/g, '')), rest: match[2] ?? '' }
}
