// What the usage panel draws, from the core's summary: the day matrix per agent (darker = more requests, in quartiles of the
// agent's own days), the Today / 7 days / 30 days totals, the labels and a day's detail. Pure: no DOM, no clock, no RPC.
import { shiftDay, weekdayOf, weekStart } from '../protocol/days.ts'
import type { UsageAgent, UsageAgentSummary, UsageDay, UsageSplit, UsageSplitTotals, UsageSummary, UsageTotals } from '../protocol/messages.ts'

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

// The colour an agent is drawn in, in the bars, the rows and the legend: the agent's own token. Copilot's violet alone is too dark on some
// themes' ground for the 3:1 non-text contrast, so it is lightened toward the ink: which also keeps it apart from Claude's orange in
// lightness and not only hue (usage-model.test.ts checks both in every theme).
export const COPILOT_MIX = 25
export const agentColour = (agent: UsageAgent): string => (agent === 'copilot' ? `color-mix(in srgb, var(--agent-copilot) ${COPILOT_MIX}%, var(--color-ink))` : `var(--agent-${agent})`)

// What the stacked bars, "When you work" and "Where it went" cover. The year needs the room of the expanded dock.
export type RangeId = '30d' | '18w' | '1y'
export const DEFAULT_RANGE: RangeId = '30d'
const RANGES: Array<{ id: RangeId; label: string; days: number }> = [
  { id: '30d', label: '30 days', days: 30 },
  { id: '18w', label: '18 weeks', days: 126 },
  { id: '1y', label: '1 year', days: 365 },
]

export const rangeOptions = (expanded: boolean): Array<{ id: RangeId; label: string }> => RANGES.filter((r) => r.id !== '1y' || expanded).map(({ id, label }) => ({ id, label }))
// A year chosen in the expanded dock is 18 weeks again once the dock is not expanded.
export const effectiveRange = (range: RangeId, expanded: boolean): RangeId => (range === '1y' && !expanded ? '18w' : range)
export const rangeDays = (range: RangeId): number => RANGES.find((r) => r.id === range)!.days
const rangeLabel = (range: RangeId): string => RANGES.find((r) => r.id === range)!.label

// How many days of per-day detail the panel asks the core for: the matrix and the stacked bars both need theirs.
export const detailDays = (today: string, expanded: boolean, range: RangeId): number => Math.max(matrixSpan(today, expanded), rangeDays(effectiveRange(range, expanded)))

// Where requests ran (GLOSSARY: Not tracked by Grove). Claude Desktop is its own slice, never run in Grove. Claude Code is run in Grove
// or not tracked by Grove, and "can't tell" before Grove began recording its sessions. Copilot is run in Grove or not tracked.
const SPLIT_LABELS: Record<UsageAgent, Record<UsageSplit, string>> = {
  claude: { desktop: 'Claude Desktop', grove: 'Claude Code run in Grove', other: 'Claude Code not tracked by Grove', unknown: 'Claude Code, can’t tell' },
  copilot: { desktop: 'Copilot CLI', grove: 'Copilot CLI run in Grove', other: 'Copilot CLI not tracked by Grove', unknown: 'Copilot CLI, can’t tell' },
}

// How much of the ink each split's colour holds over the agent's own colour (the rest is the agent's colour), so the splits differ in
// lightness and not only in hue. Mixing toward the ink only ever raises the contrast with the ground, so the agent colour's 3:1
// carries to every split; "can't tell" is not the agent's colour but a neutral, the ink over the ground (SPLIT_UNKNOWN_MIX), drawn
// hatched like the other marks that are not a plain count. Four steps between an agent's colour and the ink cannot all be told apart
// by lightness alone in every theme, so the places also carry their label, a gap between them and, for "can't tell", the hatch.
// usage-model.test.ts checks the contrast in every theme.
export const SPLIT_INK_MIX: Record<'grove' | 'other' | 'desktop', number> = { grove: 0, other: 40, desktop: 80 }
export const SPLIT_UNKNOWN_MIX = 50
export const splitColour = (agent: UsageAgent, split: UsageSplit): string =>
  split === 'unknown'
    ? `color-mix(in srgb, var(--color-ink) ${SPLIT_UNKNOWN_MIX}%, var(--color-ground))`
    : SPLIT_INK_MIX[split] === 0
      ? agentColour(agent)
      : `color-mix(in srgb, var(--color-ink) ${SPLIT_INK_MIX[split]}%, ${agentColour(agent)})`

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

export interface SourceSegment {
  split: UsageSplit
  label: string
  requests: string
  // Of the requests shown, as a whole percent, and how much of the bar it fills (a share too small for a percent still shows).
  share: string
  percent: number
  colour: string
  // Drawn hatched: "can't tell", which is no count of anything known.
  hatched: boolean
  // Copilot's credits for these requests with the "plus N requests without credits" note; null for an agent without credits.
  credits: string | null
  // What the segment says when hovered or read out.
  title: string
}

// Where some requests ran, as a labelled share bar. Only the places with a request are in it.
export interface SourcesView {
  segments: SourceSegment[]
  // One line, when some requests cannot be told: why.
  note: string | null
}

export interface DayDetail {
  title: string
  requests: string
  // The day's credits, for an agent that has them; null otherwise.
  credits: string | null
  // "of which helper agents": their share of the day's requests; null for a day without requests.
  helper: string | null
  tokens: Array<{ label: string; value: string }>
  // The day's requests and tokens per model, most requests first.
  models: Array<{ model: string; requests: string; tokens: string }>
  // Where the day's requests ran; null for a day without requests.
  sources: SourcesView | null
}

export interface AgentView {
  agent: UsageAgent
  title: string
  // Weeks, oldest first, each Monday to Sunday; a day after today is null.
  weeks: Array<Array<MatrixCell | null>>
  // Each total is its request count, with the credits as a secondary line for an agent that has them.
  totals: Array<{ label: string; value: string; credits: string | null }>
  // Where the requests of the selected range ran; null when none of them did.
  sources: SourcesView | null
  sourcesTitle: string
  detail: DayDetail | null
}

export interface BarSegment {
  agent: UsageAgent
  requests: number
  // Of the axis, which is the bar's height.
  percent: number
  // Room for slice 5: the part of Copilot's requests made through OpenCode, drawn hatched. Always false for now.
  hatched: boolean
}

export interface Bar {
  // The first day it covers.
  day: string
  requests: number
  segments: BarSegment[]
  label: string
}

export interface BarsView {
  title: string
  total: string
  unit: 'day' | 'week'
  bars: Bar[]
  // The y axis: its top is a round number above the busiest bar, then halfway and zero.
  ticks: Array<{ value: number; label: string }>
  legend: Array<{ agent: UsageAgent; title: string; hatched: boolean }>
}

export interface HourCell {
  hour: number
  requests: number
  shade: Shade
  label: string
}

export interface HoursView {
  title: string
  subtitle: string
  // Monday to Sunday, each with its 24 hours.
  rows: Array<{ weekday: string; cells: HourCell[] }>
  axis: string[]
}

export interface BreakdownRow {
  name: string
  // A repository that is a current Space.
  space: boolean
  // The "Other" row.
  other: boolean
  requests: string
  share: string
  // How the row's bar is filled, per agent, as a percent of the bar's track (the biggest row fills it).
  segments: Array<{ agent: UsageAgent; percent: number }>
  // Credits of the agents that have them, for the row's tooltip.
  detail: string
}

export interface BreakdownsView {
  title: string
  repositories: BreakdownRow[]
  models: BreakdownRow[]
}

export interface RangeOption {
  id: RangeId
  label: string
  selected: boolean
}

// The views over all the agents shown, for the selected range.
export interface ChartsView {
  range: RangeOption[]
  bars: BarsView
  hours: HoursView
  breakdowns: BreakdownsView
}

export interface UsageView {
  // The one message when no agent made a request in the last 30 days.
  empty: string | null
  scope: string
  historyFrom: string
  // Says the first read is still running and how far it has got; null when the history is complete.
  building: string | null
  agents: AgentView[]
  // Null when there is no agent to draw.
  charts: ChartsView | null
}

// The share of `part` in `whole`, as a whole percent; a share too small for one says so instead of "0%".
export const percentLabel = (part: number, whole: number): string => {
  if (whole <= 0 || part <= 0) return '0%'
  const percent = Math.round((part / whole) * 100)
  return percent === 0 ? '<1%' : `${percent}%`
}

// Cutting the date off a model's name: claude-haiku-4-5-20251001 is the model claude-haiku-4-5.
export const modelLabel = (model: string): string => (model === '' ? 'Unknown model' : model.replace(/-\d{8}$/, ''))

// The one line that says why some requests cannot be told from Grove's, when any of them is shown.
function cantTellNote(trackedSince: string | null): string {
  return trackedSince === null
    ? 'Grove has no record of your Claude sessions, so earlier Claude Code requests can’t be split.'
    : `Grove began recording Claude sessions on ${formatDay(trackedSince)}; Claude Code requests before it can’t be split.`
}

export function sourcesOf(agent: UsageAgentSummary, sources: readonly UsageSplitTotals[]): SourcesView | null {
  const shown = sources.filter((source) => source.requests > 0)
  const total = shown.reduce((sum, source) => sum + source.requests, 0)
  if (total === 0) return null
  return {
    segments: shown.map((source) => {
      const label = SPLIT_LABELS[agent.agent][source.split]
      const share = percentLabel(source.requests, total)
      const credits = creditsOf(source, agent.hasCredits)
      return {
        split: source.split,
        label,
        requests: requestsLabel(source.requests),
        share,
        percent: (source.requests / total) * 100,
        colour: splitColour(agent.agent, source.split),
        hatched: source.split === 'unknown',
        credits,
        title: [`${label}: ${requestsLabel(source.requests)}, ${share}`, ...(credits === null ? [] : [credits])].join('. '),
      }
    }),
    note: shown.some((source) => source.split === 'unknown') ? cantTellNote(agent.trackedSince) : null,
  }
}

function detailOf(summary: UsageSummary, agent: UsageAgentSummary, day: string): DayDetail {
  if (day < summary.historyFrom) return { title: formatDay(day), requests: 'Before the history starts', credits: null, helper: null, tokens: [], models: [], sources: null }
  const found: UsageDay | undefined = agent.days.find((d) => d.day === day)
  return {
    title: formatDay(day),
    requests: requestsLabel(found?.requests ?? 0),
    credits: creditsOf(found ?? { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, credits: 0, withoutCredits: 0 }, agent.hasCredits),
    sources: found === undefined ? null : sourcesOf(agent, found.sources),
    helper: found === undefined || found.requests === 0 ? null : `${percentLabel(found.helperRequests, found.requests)} (${group(found.helperRequests)})`,
    models: (found?.models ?? []).map((m) => ({
      model: modelLabel(m.model),
      requests: requestsLabel(m.requests),
      tokens: `${tokensLabel(m.input)} in · ${tokensLabel(m.output)} out · ${tokensLabel(m.cacheRead + m.cacheWrite)} cache`,
    })),
    tokens: [
      { label: 'Fresh input', value: tokensLabel(found?.input ?? 0) },
      { label: 'Output', value: tokensLabel(found?.output ?? 0) },
      { label: 'Cache read', value: tokensLabel(found?.cacheRead ?? 0) },
      { label: 'Cache write', value: tokensLabel(found?.cacheWrite ?? 0) },
    ],
  }
}

function agentView(summary: UsageSummary, agent: UsageAgentSummary, expanded: boolean, selected: string | null, range: RangeId): AgentView {
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
    sources: sourcesOf(agent, agent.sources),
    sourcesTitle: `Where it ran, ${rangeLabel(range)}`,
    detail: selected === null ? null : detailOf(summary, agent, selected),
  }
}

// The top of the bars' axis: the smallest 1, 2, 5 or 10 times a power of ten that holds the busiest bar.
export function niceMax(value: number): number {
  if (value <= 1) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  const fraction = value / power
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power
}

// The weeks of a year are bars of their own, the days of 18 weeks and 30 days are.
const barUnit = (range: RangeId): 'day' | 'week' => (range === '1y' ? 'week' : 'day')

function barsOf(summary: UsageSummary, range: RangeId): BarsView {
  const unit = barUnit(range)
  const first = shiftDay(summary.today, -(rangeDays(range) - 1))
  const perAgent = summary.agents.map((agent) => ({ agent: agent.agent, perDay: new Map(agent.days.map((d) => [d.day, d.requests])) }))
  const bars: Array<Omit<Bar, 'segments' | 'label'> & { counts: number[]; end: string }> = []
  for (let day = unit === 'week' ? weekStart(first) : first; day <= summary.today; day = shiftDay(day, unit === 'week' ? 7 : 1)) {
    const end = unit === 'week' ? shiftDay(day, 6) : day
    const counts = perAgent.map(({ perDay }) => {
      let sum = 0
      for (let d = day < first ? first : day; d <= end && d <= summary.today; d = shiftDay(d, 1)) sum += perDay.get(d) ?? 0
      return sum
    })
    bars.push({ day, end, requests: counts.reduce((a, b) => a + b, 0), counts })
  }
  const top = niceMax(Math.max(0, ...bars.map((b) => b.requests)))
  const drawn: Bar[] = bars.map(({ day, end, requests, counts }) => {
    const span = unit === 'week' ? `Week of ${shortDay(day)}` : formatDay(day)
    const split = perAgent.flatMap(({ agent }, i) => (counts[i] > 0 && perAgent.length > 1 ? [`${AGENT_TITLES[agent]} ${group(counts[i])}`] : []))
    const label = end < summary.historyFrom ? `${span}: before the history starts` : `${span}: ${requestsLabel(requests)}${split.length > 0 ? ` (${split.join(', ')})` : ''}`
    return {
      day,
      requests,
      label,
      segments: perAgent.flatMap(({ agent }, i) => (counts[i] > 0 ? [{ agent, requests: counts[i], percent: (counts[i] / top) * 100, hatched: false }] : [])),
    }
  })
  const total = drawn.reduce((sum, bar) => sum + bar.requests, 0)
  return {
    title: unit === 'week' ? 'Requests per week' : 'Requests per day',
    total: requestsLabel(total),
    unit,
    bars: drawn,
    ticks: [top, top / 2, 0].map((value) => ({ value, label: group(value) })),
    legend: summary.agents.map((agent) => ({ agent: agent.agent, title: AGENT_TITLES[agent.agent], hatched: false })),
  }
}

// Weekday by hour across the agents shown, shaded like the matrix: the quartile each cell's count falls in among the cells with requests.
function hoursOf(summary: UsageSummary, range: RangeId): HoursView {
  const counts = new Array<number>(168).fill(0)
  for (const agent of summary.agents) agent.hours.forEach((n, i) => (counts[i] += n))
  const ranked = rankedDays(counts)
  return {
    title: 'When you work',
    subtitle: `weekday by hour, ${rangeLabel(range)}`,
    rows: WEEKDAYS.map((weekday, row) => ({
      weekday,
      cells: Array.from({ length: 24 }, (_, hour) => {
        const requests = counts[row * 24 + hour]
        return { hour, requests, shade: shadeOf(requests, ranked), label: `${weekday} ${String(hour).padStart(2, '0')}:00: ${requestsLabel(requests)}` }
      }),
    })),
    axis: ['00', '06', '12', '18', '23'],
  }
}

// Under this share of all requests a group is too small to be a row of its own.
const TINY_SHARE = 0.01

interface Group {
  key: string
  name: string
  space: boolean
  other: boolean
  perAgent: Map<UsageAgent, UsageTotals>
}

const requestsOfGroup = (of: Group): number => [...of.perAgent.values()].reduce((sum, totals) => sum + totals.requests, 0)

const plus = (a: UsageTotals, b: UsageTotals): UsageTotals => ({
  requests: a.requests + b.requests,
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  credits: a.credits + b.credits,
  withoutCredits: a.withoutCredits + b.withoutCredits,
})
const NONE: UsageTotals = { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, credits: 0, withoutCredits: 0 }

// Rows for some groups, most requests first. With `fold`, the groups under 1% of the requests are folded into Other, the last row.
function rowsOf(groups: Group[], agents: UsageAgentSummary[], fold: boolean): BreakdownRow[] {
  const total = groups.reduce((sum, g) => sum + requestsOfGroup(g), 0)
  // Tiny groups fold into Other, which is always the last row.
  const kept: Group[] = []
  let other: Group | undefined
  const foldIn = (g: Group): void => {
    other ??= { key: '', name: 'Other', space: false, other: true, perAgent: new Map() }
    for (const [agent, totals] of g.perAgent) other.perAgent.set(agent, plus(other.perAgent.get(agent) ?? NONE, totals))
  }
  for (const g of groups) {
    // A Space keeps its row however small: the mark is what the human looks for.
    if (g.other || (fold && !g.space && requestsOfGroup(g) < total * TINY_SHARE)) foldIn(g)
    else kept.push(g)
  }
  kept.sort((a, b) => requestsOfGroup(b) - requestsOfGroup(a) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const all: Group[] = other === undefined ? kept : [...kept, other]
  const biggest = Math.max(1, ...all.map(requestsOfGroup))
  return all.map((g) => {
    const requests = requestsOfGroup(g)
    const credits = agents.flatMap((agent) => {
      const totals = g.perAgent.get(agent.agent)
      return agent.hasCredits && totals !== undefined ? [`${AGENT_TITLES[agent.agent]}: ${creditsOf(totals, true)}`] : []
    })
    return {
      name: g.name,
      space: g.space,
      other: g.other,
      requests: group(requests),
      share: percentLabel(requests, total),
      segments: agents.flatMap((agent) => {
        const part = g.perAgent.get(agent.agent)?.requests ?? 0
        return part > 0 ? [{ agent: agent.agent, percent: (part / biggest) * 100 }] : []
      }),
      detail: [`${requestsLabel(requests)}, ${percentLabel(requests, total)}`, ...credits].join('. '),
    }
  })
}

function breakdownsOf(summary: UsageSummary, range: RangeId): BreakdownsView {
  const repositories = new Map<string, Group>()
  for (const agent of summary.agents) {
    for (const row of agent.repositories) {
      const key = row.name === null ? '' : `${row.space ? 'space' : 'repo'}:${row.name}`
      let found = repositories.get(key)
      if (found === undefined) repositories.set(key, (found = { key, name: row.name ?? 'Other', space: row.space, other: row.name === null, perAgent: new Map() }))
      found.perAgent.set(agent.agent, row)
    }
  }
  // A model's name alone says enough, unless two agents run the same one: then the agent comes first.
  const owners = new Map<string, number>()
  for (const agent of summary.agents) for (const row of agent.models) owners.set(modelLabel(row.model), (owners.get(modelLabel(row.model)) ?? 0) + 1)
  const models = new Map<string, Group>()
  for (const agent of summary.agents) {
    for (const row of agent.models) {
      const name = modelLabel(row.model)
      const key = `${agent.agent}:${name}`
      let found = models.get(key)
      if (found === undefined) models.set(key, (found = { key, name: (owners.get(name) ?? 0) > 1 ? `${AGENT_TITLES[agent.agent]} · ${name}` : name, space: false, other: false, perAgent: new Map() }))
      found.perAgent.set(agent.agent, plus(found.perAgent.get(agent.agent) ?? NONE, row))
    }
  }
  return {
    title: `Where it went, ${rangeLabel(range)}`,
    repositories: rowsOf([...repositories.values()], summary.agents, true),
    // Models are not folded: a model with a share too small to see is still a model the human used.
    models: rowsOf([...models.values()], summary.agents, false),
  }
}

// `selected` is the clicked day, if any: its detail is shown under the agent that was clicked.
export function usageView(summary: UsageSummary, options: { expanded: boolean; selected?: { agent: UsageAgent; day: string } | null; range?: RangeId }): UsageView {
  const selected = options.selected ?? null
  const range = effectiveRange(options.range ?? DEFAULT_RANGE, options.expanded)
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
    agents: summary.agents.map((agent) => agentView(summary, agent, options.expanded, selected?.agent === agent.agent ? selected.day : null, range)),
    charts:
      summary.agents.length === 0
        ? null
        : {
            range: rangeOptions(options.expanded).map((option) => ({ ...option, selected: option.id === range })),
            bars: barsOf(summary, range),
            hours: hoursOf(summary, range),
            breakdowns: breakdownsOf(summary, range),
          },
  }
}
