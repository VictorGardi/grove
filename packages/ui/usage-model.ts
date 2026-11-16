// What the usage panel draws, from the core's summary: the day matrix per agent (darker = more requests, in quartiles of the
// agent's own days), the Today / 7 days / 30 days totals, the labels and a day's detail. Pure: no DOM, no clock, no RPC.
import { shiftDay, weekdayOf, weekStart } from '../protocol/days.ts'
import type { UsageAgent, UsageAgentSummary, UsageDay, UsageSummary, UsageTotals } from '../protocol/messages.ts'

export const EMPTY_MESSAGE = 'No usage in the last 30 days'
export const SCOPE_NOTE = 'This machine only'

// The matrix is whole weeks, Monday to Sunday, the newest week last. The expanded dock has the room for a year.
export const MATRIX_WEEKS = 13
export const MATRIX_WEEKS_EXPANDED = 53

export type Shade = 0 | 1 | 2 | 3 | 4

// How much of the accent each shade 1 to 4 holds, mixed over the panel's surface. Zero requests is shade 0, a surface tone, not
// part of the ramp. The ramp differs in lightness, not only hue, and each step stands out from the surface by at least the
// 3:1 non-text contrast (WCAG 1.4.11): usage-model.test.ts checks it against every theme.
export const SHADE_MIX: Record<1 | 2 | 3 | 4, number> = { 1: 62, 2: 75, 3: 87, 4: 100 }

const AGENT_TITLES: Record<UsageAgent, string> = { claude: 'Claude', copilot: 'Copilot CLI' }

export const matrixWeeks = (expanded: boolean): number => (expanded ? MATRIX_WEEKS_EXPANDED : MATRIX_WEEKS)

// How many days back from today the matrix reaches, which is how many days of detail the panel asks the core for.
export const matrixSpan = (today: string, expanded: boolean): number => (matrixWeeks(expanded) - 1) * 7 + weekdayOf(today) + 1

// The agent's own days with requests, sorted: what the shades are ranked against. Days with none are not part of it.
export const rankedDays = (counts: readonly number[]): number[] => counts.filter((count) => count > 0).sort((a, b) => a - b)

// A day's shade is the quartile its request count falls in among the agent's own days: the share of those days with no more
// requests than it, in quarters. So one huge day does not wash out the rest, equal counts share a shade, the busiest day is
// always the darkest, and a lone day is the darkest too.
export function shadeOf(requests: number, ranked: readonly number[]): Shade {
  if (requests <= 0 || ranked.length === 0) return 0
  let low = 0
  let high = ranked.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (ranked[middle] <= requests) low = middle + 1
    else high = middle
  }
  return Math.min(4, Math.max(1, Math.ceil((low / ranked.length) * 4))) as Shade
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// 'Sun 15 Nov 2026'
export function formatDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  return `${WEEKDAYS[weekdayOf(day)]} ${date} ${MONTHS[month - 1]} ${year}`
}

const shortDay = (day: string): string => `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`

export const group = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
export const requestsLabel = (n: number): string => `${group(n)} ${n === 1 ? 'request' : 'requests'}`

// Token counts are detail and large: 950, 12k, 3.4M.
export function tokensLabel(n: number): string {
  const unit = (value: number, suffix: string): string => `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10}${suffix}`
  if (n < 1000) return String(n)
  if (n < 1e6) return unit(n / 1e3, 'k')
  if (n < 1e9) return unit(n / 1e6, 'M')
  return unit(n / 1e9, 'B')
}

// Copilot's credits: GitHub AI Credits, a unit of their own. Never a dollar figure, and never added to requests or tokens. Small
// amounts keep their decimals (one request is often a fraction of a credit), large ones are whole numbers.
export function creditsLabel(credits: number): string {
  const value = credits === 0 ? '0' : credits < 0.01 ? '<0.01' : credits < 10 ? credits.toFixed(2) : credits < 100 ? credits.toFixed(1) : group(Math.round(credits))
  return `${value} ${value === '1.00' ? 'credit' : 'credits'}`
}

// The credits of some requests, as a secondary line. When some of the requests carried no credit figure the total is partial and
// says so: "12.4 credits plus 3 requests without credits". null for an agent without credits.
export function creditsOf(totals: UsageTotals, hasCredits: boolean): string | null {
  if (!hasCredits) return null
  return totals.withoutCredits > 0 ? `${creditsLabel(totals.credits)} plus ${requestsLabel(totals.withoutCredits)} without credits` : creditsLabel(totals.credits)
}

export interface MatrixCell {
  day: string
  // The request count, or null for a day before the history starts: the agent's files were gone, which is not "no activity".
  requests: number | null
  shade: Shade | null
  label: string
  selected: boolean
}

export interface DayDetail {
  title: string
  requests: string
  // The day's credits, for an agent that has them; null otherwise.
  credits: string | null
  tokens: Array<{ label: string; value: string }>
}

export interface AgentView {
  agent: UsageAgent
  title: string
  // Weeks, oldest first, each Monday to Sunday; a day after today is null.
  weeks: Array<Array<MatrixCell | null>>
  // Each total is its request count, with the credits as a secondary line for an agent that has them.
  totals: Array<{ label: string; value: string; credits: string | null }>
  detail: DayDetail | null
}

export interface UsageView {
  // The one message when no agent made a request in the last 30 days.
  empty: string | null
  scope: string
  historyFrom: string
  // Says the first read is still running and how far it has got; null when the history is complete.
  building: string | null
  agents: AgentView[]
}

function detailOf(summary: UsageSummary, agent: UsageAgentSummary, day: string): DayDetail {
  if (day < summary.historyFrom) return { title: formatDay(day), requests: 'Before the history starts', credits: null, tokens: [] }
  const found: UsageDay | undefined = agent.days.find((d) => d.day === day)
  return {
    title: formatDay(day),
    requests: requestsLabel(found?.requests ?? 0),
    credits: creditsOf(found ?? { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, credits: 0, withoutCredits: 0 }, agent.hasCredits),
    tokens: [
      { label: 'Fresh input', value: tokensLabel(found?.input ?? 0) },
      { label: 'Output', value: tokensLabel(found?.output ?? 0) },
      { label: 'Cache read', value: tokensLabel(found?.cacheRead ?? 0) },
      { label: 'Cache write', value: tokensLabel(found?.cacheWrite ?? 0) },
    ],
  }
}

function agentView(summary: UsageSummary, agent: UsageAgentSummary, expanded: boolean, selected: string | null): AgentView {
  const perDay = new Map(agent.days.map((d) => [d.day, d.requests]))
  const ranked = rankedDays(agent.days.map((d) => d.requests))
  const first = shiftDay(weekStart(summary.today), -(matrixWeeks(expanded) - 1) * 7)
  const weeks: AgentView['weeks'] = []
  for (let w = 0; w < matrixWeeks(expanded); w++) {
    const week: Array<MatrixCell | null> = []
    for (let r = 0; r < 7; r++) {
      const day = shiftDay(first, w * 7 + r)
      if (day > summary.today) week.push(null)
      else if (day < summary.historyFrom) week.push({ day, requests: null, shade: null, label: `${formatDay(day)}: before the history starts`, selected: day === selected })
      else {
        const requests = perDay.get(day) ?? 0
        week.push({ day, requests, shade: shadeOf(requests, ranked), label: `${formatDay(day)}: ${requestsLabel(requests)}`, selected: day === selected })
      }
    }
    weeks.push(week)
  }
  return {
    agent: agent.agent,
    title: AGENT_TITLES[agent.agent],
    weeks,
    totals: [
      { label: 'Today', value: requestsLabel(agent.today.requests), credits: creditsOf(agent.today, agent.hasCredits) },
      { label: '7 days', value: requestsLabel(agent.last7.requests), credits: creditsOf(agent.last7, agent.hasCredits) },
      { label: '30 days', value: requestsLabel(agent.last30.requests), credits: creditsOf(agent.last30, agent.hasCredits) },
    ],
    detail: selected === null ? null : detailOf(summary, agent, selected),
  }
}

// `selected` is the clicked day, if any: its detail is shown under the agent that was clicked.
export function usageView(summary: UsageSummary, options: { expanded: boolean; selected?: { agent: UsageAgent; day: string } | null }): UsageView {
  const selected = options.selected ?? null
  return {
    empty: summary.agents.length === 0 ? EMPTY_MESSAGE : null,
    scope: SCOPE_NOTE,
    historyFrom: `History from ${formatDay(summary.historyFrom)}`,
    building:
      summary.building === false
        ? null
        : summary.ready === null
          ? 'Still building the history'
          : `Still building the history: ready from ${shortDay(summary.ready.from)} to ${shortDay(summary.ready.to)}`,
    agents: summary.agents.map((agent) => agentView(summary, agent, options.expanded, selected?.agent === agent.agent ? selected.day : null)),
  }
}
