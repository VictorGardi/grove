import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { UsageAgent, UsageAgentSummary, UsageDay, UsageModelTotals, UsageRepositoryTotals, UsageSplit, UsageSplitTotals, UsageSummary, UsageTotals } from '../protocol/messages.ts'
import {
  EMPTY_MESSAGE,
  creditsLabel,
  creditsOf,
  detailDays,
  effectiveRange,
  modelLabel,
  niceMax,
  percentLabel,
  rangeOptions,
  MATRIX_WEEKS,
  MATRIX_WEEKS_EXPANDED,
  SHADE_MIX,
  formatDay,
  matrixSpan,
  requestsLabel,
  rankedDays,
  shadeOf,
  tokensLabel,
  usageView,
  wipePrompt,
  type RangeId,
  COPILOT_MIX,
  SPLIT_INK_MIX,
  SPLIT_UNKNOWN_MIX,
  agentColour,
  splitColour,
} from './usage-model.ts'

// 2026-11-16 is a Monday.
const day = (d: string, requests: number, more: Partial<UsageDay> = {}): UsageDay => ({ day: d, requests, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, credits: 0, withoutCredits: 0, helperRequests: 0, models: [], sources: [], ...more })

function summary(days: UsageDay[], more: Partial<UsageSummary> = {}, totals: Partial<UsageAgentSummary> = {}): UsageSummary {
  const sum = (n: number) => ({ requests: n, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, credits: 0, withoutCredits: 0 })
  return {
    today: '2026-11-16',
    historyFrom: '2026-05-01',
    building: false,
    ready: { from: '2026-05-01', to: '2026-11-16' },
    progress: [],
    agents: [{ agent: 'claude', hasCredits: false, days, today: sum(0), last7: sum(0), last30: sum(days.length), hours: new Array<number>(168).fill(0), repositories: [], models: [], sources: [], trackedSince: null, ...totals }],
    ...more,
  }
}

const cells = (view: ReturnType<typeof usageView>) => view.agents[0].weeks.flat().filter((cell) => cell !== null)
const shadeOn = (view: ReturnType<typeof usageView>, d: string) => cells(view).find((cell) => cell.day === d)?.shade

describe('shades', () => {
  const shades = (counts: number[]) => counts.map((n) => shadeOf(n, rankedDays(counts)))

  it('are quartiles of the days with requests, so one huge day does not wash out the others', () => {
    expect(shades([1, 2, 3, 1000])).toEqual([1, 2, 3, 4])
    // On a linear scale 1, 2 and 3 would all be pale next to 1000; here they are three different shades.
    const many = Array.from({ length: 40 }, (_, i) => i + 1)
    expect(shades([...many, 100000]).slice(0, 40)).toEqual([...many.map((n) => Math.ceil((n / 41) * 4))])
    expect(shades([...many, 100000]).at(-1)).toBe(4)
  })

  it('give a day with no requests shade 0, and ignore such days when ranking', () => {
    expect(rankedDays([0, 0, 4, 8])).toEqual([4, 8])
    expect(shades([0, 4, 0, 8])).toEqual([0, 2, 0, 4])
  })

  it('have nothing to rank for no days, and a lone day is the darkest shade', () => {
    expect(shadeOf(3, rankedDays([]))).toBe(0)
    expect(shades([7])).toEqual([4])
  })

  it('give equal counts the same shade, whatever their order', () => {
    expect(shades([5, 5, 5, 5, 9, 9, 20, 20])).toEqual([2, 2, 2, 2, 3, 3, 4, 4])
    expect(shades([20, 5, 9, 5, 20, 5, 9, 5])).toEqual([4, 2, 3, 2, 4, 2, 3, 2])
    expect(new Set(shades([6, 6, 6])).size).toBe(1)
  })

  it('are drawn per agent from that agent’s own days', () => {
    const view = usageView(summary([day('2026-11-10', 1), day('2026-11-11', 100)]), { expanded: false })
    expect(shadeOn(view, '2026-11-10')).toBe(2)
    expect(shadeOn(view, '2026-11-11')).toBe(4)
  })
})

describe('the matrix', () => {
  it('is whole weeks from Monday, the newest week last, with no cell after today', () => {
    const view = usageView(summary([day('2026-11-16', 3)]), { expanded: false })
    const weeks = view.agents[0].weeks
    expect(weeks).toHaveLength(MATRIX_WEEKS)
    expect(weeks.every((week) => week.length === 7)).toBe(true)
    expect(weeks[0][0]?.day).toBe('2026-08-24')
    // Today is a Monday: the last week holds only today.
    expect(weeks.at(-1)?.map((cell) => cell?.day ?? null)).toEqual(['2026-11-16', null, null, null, null, null, null])
  })

  it('is longer in the expanded dock', () => {
    const wide = usageView(summary([]), { expanded: true })
    expect(wide.agents[0].weeks).toHaveLength(MATRIX_WEEKS_EXPANDED)
    expect(MATRIX_WEEKS_EXPANDED).toBeGreaterThan(MATRIX_WEEKS)
  })

  it('asks the core for as many days as it draws', () => {
    expect(matrixSpan('2026-11-16', false)).toBe(12 * 7 + 1)
    expect(matrixSpan('2026-11-22', false)).toBe(13 * 7)
    expect(matrixSpan('2026-11-22', true)).toBe(53 * 7)
  })

  it('shows days before the history starts as unknown, not as zero activity', () => {
    const view = usageView(summary([day('2026-11-10', 2)], { historyFrom: '2026-11-03' }), { expanded: false })
    expect(cells(view).find((cell) => cell.day === '2026-11-02')).toMatchObject({ requests: null, shade: null })
    expect(cells(view).find((cell) => cell.day === '2026-11-03')).toMatchObject({ requests: 0, shade: 0 })
  })

  it('labels each day for a screen reader and marks the selected one', () => {
    const view = usageView(summary([day('2026-11-10', 1), day('2026-11-11', 4)]), { expanded: false, selected: { agent: 'claude', day: '2026-11-11' } })
    expect(cells(view).find((cell) => cell.day === '2026-11-10')?.label).toBe('Tue 10 Nov 2026: 1 request')
    expect(cells(view).find((cell) => cell.day === '2026-11-11')).toMatchObject({ label: 'Wed 11 Nov 2026: 4 requests', selected: true })
    expect(cells(view).filter((cell) => cell.selected)).toHaveLength(1)
  })
})

describe('labels', () => {
  it('says the message for no usage, and nothing else when there is some', () => {
    expect(usageView(summary([]), { expanded: false }).empty).toBeNull()
    const none = usageView({ ...summary([]), agents: [] }, { expanded: false })
    expect(none.empty).toBe(EMPTY_MESSAGE)
    expect(none.agents).toEqual([])
  })

  it('says where the history starts, and that it is this machine', () => {
    const view = usageView(summary([], { historyFrom: '2026-11-03' }), { expanded: false })
    expect(view.historyFrom).toBe('History from Tue 3 Nov 2026')
    expect(view.scope).toBe('This machine only')
  })

  describe('the note that the history is still being built', () => {
    const building = (more: Partial<UsageSummary>) => usageView(summary([], { building: true, ...more }), { expanded: false }).building

    it('is absent when the history is complete', () => {
      expect(usageView(summary([]), { expanded: false }).building).toBeNull()
      expect(usageView(summary([], { progress: [{ agent: 'claude', fraction: 0.5 }] }), { expanded: false }).building).toBeNull()
    })

    it('says how far each agent has got and what is ready so far', () => {
      expect(
        building({
          ready: { from: '2026-10-01', to: '2026-11-16' },
          progress: [
            { agent: 'claude', fraction: 0.62 },
            { agent: 'copilot', fraction: 1 },
          ],
        }),
      ).toBe('Still building the history: Claude 62%, Copilot CLI done. Ready so far: 1 Oct to 16 Nov')
    })

    it('never says 100% of an agent that is not done, nor 0% of one that has begun', () => {
      expect(building({ ready: null, progress: [{ agent: 'claude', fraction: 0.996 }] })).toBe('Still building the history: Claude 99%')
      expect(building({ ready: null, progress: [{ agent: 'claude', fraction: 0.001 }] })).toBe('Still building the history: Claude 1%')
    })

    it('says only that it is building when nothing is known yet', () => {
      expect(building({ ready: null, progress: [] })).toBe('Still building the history')
      expect(building({ ready: { from: '2026-10-01', to: '2026-11-16' }, progress: [] })).toBe('Still building the history. Ready so far: 1 Oct to 16 Nov')
    })

    it('follows the agents in their usual order whatever order the core listed them', () => {
      expect(
        building({
          ready: null,
          progress: [
            { agent: 'copilot', fraction: 0.5 },
            { agent: 'claude', fraction: 0.25 },
          ],
        }),
      ).toBe('Still building the history: Claude 25%, Copilot CLI 50%')
    })

    it('is not the empty message: an agent with nothing to show yet is not “no usage”', () => {
      const view = usageView({ ...summary([]), agents: [], building: true, ready: null }, { expanded: false })
      expect(view.empty).toBeNull()
      expect(view.building).toBe('Still building the history')
    })
  })

  describe('after a wipe, or on a history younger than the window', () => {
    it('says honestly that nothing is recorded since the history started, and not that nothing was used', () => {
      const wiped = usageView({ ...summary([]), agents: [], historyFrom: '2026-11-16', ready: null }, { expanded: false })
      expect(wiped.empty).toBe('No usage recorded since Mon 16 Nov 2026')
      expect(wiped.historyFrom).toBe('History from Mon 16 Nov 2026')
      expect(wiped.building).toBeNull()
      const thirtyDaysAgo = usageView({ ...summary([]), agents: [], historyFrom: '2026-10-18' }, { expanded: false })
      expect(thirtyDaysAgo.empty).toBe('No usage recorded since Sun 18 Oct 2026')
      expect(usageView({ ...summary([]), agents: [], historyFrom: '2026-10-17' }, { expanded: false }).empty).toBe(EMPTY_MESSAGE)
    })
  })

  describe('the wipe confirmation', () => {
    it('says what is deleted, what is not, that the date resets, and that deleted days cannot come back', () => {
      const prompt = wipePrompt(summary([], { historyFrom: '2026-05-01' }))
      expect(prompt.title).toBe('Wipe the saved usage history?')
      expect(prompt.confirm).toBe('Wipe history')
      expect(prompt.cancel).toBe('Cancel')
      expect(prompt.text).toContain('Grove’s saved record')
      expect(prompt.text).toContain('Fri 1 May 2026')
      expect(prompt.text).toContain('never touched')
      expect(prompt.text).toContain('Mon 16 Nov 2026')
      expect(prompt.text).toContain('cannot come back')
      expect(prompt.text).not.toMatch(/\$/)
    })

    it('does not claim to rebuild what was wiped', () => {
      const text = wipePrompt(summary([])).text
      expect(text).toContain('not read again')
      expect(text).toContain('from now on')
    })
  })

  it('gives Today, 7 days and 30 days totals', () => {
    const sum = (n: number) => ({ requests: n, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, credits: 0, withoutCredits: 0 })
    const view = usageView(summary([], {}, { today: sum(1), last7: sum(12), last30: sum(1234) }), { expanded: false })
    expect(view.agents[0].totals).toEqual([
      { label: 'Today', value: '1 request', credits: null },
      { label: '7 days', value: '12 requests', credits: null },
      { label: '30 days', value: '1,234 requests', credits: null },
    ])
  })

  it('formats days, counts and tokens', () => {
    expect(formatDay('2026-11-15')).toBe('Sun 15 Nov 2026')
    expect(requestsLabel(0)).toBe('0 requests')
    expect([0, 950, 1000, 12345, 345678, 3_400_000, 2_100_000_000].map(tokensLabel)).toEqual(['0', '950', '1k', '12.3k', '346k', '3.4M', '2.1B'])
  })
})

describe('a day’s detail', () => {
  const selected = (d: string, s = summary([day('2026-11-10', 5, { input: 40, output: 1200, cacheRead: 3_000_000, cacheWrite: 800, credits: 0, withoutCredits: 0 })])) =>
    usageView(s, { expanded: false, selected: { agent: 'claude', day: d } }).agents[0].detail

  it('shows requests and the four token counts apart', () => {
    expect(selected('2026-11-10')).toMatchObject({
      title: 'Tue 10 Nov 2026',
      requests: '5 requests',
      credits: null,
      tokens: [
        { label: 'Fresh input', value: '40' },
        { label: 'Output', value: '1.2k' },
        { label: 'Cache read', value: '3M' },
        { label: 'Cache write', value: '800' },
      ],
    })
  })

  it('shows zero for a day with no requests, and says so for a day before the history', () => {
    expect(selected('2026-11-11')?.requests).toBe('0 requests')
    expect(selected('2026-04-01')).toMatchObject({ requests: 'Before the history starts', tokens: [] })
  })

  it('is absent until a day is clicked', () => {
    expect(usageView(summary([]), { expanded: false }).agents[0].detail).toBeNull()
  })
})

// The shade ramp against the surface it is drawn on, in every theme: the accent mixed over the dock's ground colour.
describe('the shade ramp contrast', () => {
  const UI = fileURLToPath(new URL('.', import.meta.url))
  const css = readFileSync(`${UI}src/tokens.css`, 'utf8') + '\n' + readFileSync(`${UI}src/themes.css`, 'utf8')
  // [name, accent, ground] of the default tokens and of every theme preset.
  const themes: Array<[string, string, string]> = []
  for (const block of css.matchAll(/:root(?:\[data-theme='([\w-]+)'\])?\s*\{([^}]*)\}/g)) {
    const accent = block[2].match(/--accent:\s*(#[0-9a-f]{6})/i)?.[1]
    const ground = block[2].match(/--color-ground:\s*(#[0-9a-f]{6})/i)?.[1]
    if (accent && ground) themes.push([block[1] ?? 'default', accent, ground])
  }
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const luminance = (c: number[]) => {
    const [r, g, b] = c.map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const contrast = (a: number[], b: number[]) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }
  // color-mix(in srgb, accent N%, ground)
  const mix = (accent: string, ground: string, percent: number) => rgb(accent).map((c, i) => c * (percent / 100) + rgb(ground)[i] * (1 - percent / 100))

  it('covers the default tokens and every theme preset', () => {
    expect(themes.length).toBeGreaterThan(5)
    expect(themes[0][0]).toBe('default')
  })

  it.each(themes)('%s: every shade stands out from the surface by 3:1, and each is lighter than the one before', (_name, accent, ground) => {
    const shades = ([1, 2, 3, 4] as const).map((shade) => mix(accent, ground, SHADE_MIX[shade]))
    for (const shade of shades) expect(contrast(shade, rgb(ground))).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < shades.length; i++) expect(contrast(shades[i], shades[i - 1])).toBeGreaterThanOrEqual(1.15)
  })
})

// A Copilot agent: credits per request in Copilot's own unit, with some requests possibly lacking a figure.
const totalsOf = (requests: number, credits: number, withoutCredits = 0) => ({ requests, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, credits, withoutCredits })
function copilotAgent(over: Partial<UsageAgentSummary> = {}): UsageAgentSummary {
  return {
    agent: 'copilot',
    hasCredits: true,
    days: [
      { day: '2026-11-10', helperRequests: 0, models: [], sources: [], ...totalsOf(4, 12.34) },
      { day: '2026-11-11', helperRequests: 0, models: [], sources: [], ...totalsOf(9, 0.5, 2) },
    ],
    today: totalsOf(0, 0),
    last7: totalsOf(13, 12.84, 2),
    last30: totalsOf(40, 1234.5),
    hours: new Array<number>(168).fill(0),
    repositories: [],
    models: [],
    sources: [],
    trackedSince: null,
    ...over,
  }
}

describe('the Copilot section', () => {
  const both = (copilot = copilotAgent()): UsageSummary => {
    const base = summary([day('2026-11-10', 3)])
    return { ...base, agents: [...base.agents, copilot] }
  }

  it('is titled "Copilot CLI", after Claude, with its own matrix shaded from its own days', () => {
    const view = usageView(both(), { expanded: false })
    expect(view.agents.map((a) => a.title)).toEqual(['Claude', 'Copilot CLI'])
    const shade = (d: string) => view.agents[1].weeks.flat().find((c) => c?.day === d)?.shade
    expect([shade('2026-11-10'), shade('2026-11-11'), shade('2026-11-12')]).toEqual([2, 4, 0])
  })

  it('shows credits as a secondary number beside each total, labelled "credits", and Claude none', () => {
    const view = usageView(both(), { expanded: false })
    expect(view.agents[0].totals.map((t) => t.credits)).toEqual([null, null, null])
    expect(view.agents[1].totals).toEqual([
      { label: 'Today', value: '0 requests', credits: '0 credits' },
      { label: '7 days', value: '13 requests', credits: '12.8 credits plus 2 requests without credits' },
      { label: '30 days', value: '40 requests', credits: '1,235 credits' },
    ])
  })

  it('never writes a dollar sign, and never folds credits into the request or token labels', () => {
    const view = usageView(both(), { expanded: false, selected: { agent: 'copilot', day: '2026-11-11' } })
    const text = JSON.stringify(view)
    expect(text).not.toMatch(/[$€£]|dollar|usd/i)
    expect(view.agents[1].totals.map((t) => t.value)).toEqual(['0 requests', '13 requests', '40 requests'])
  })

  it('says the total is partial when some requests carry no credit figure, and only then', () => {
    expect(creditsOf(totalsOf(5, 2.5, 3), true)).toBe('2.50 credits plus 3 requests without credits')
    expect(creditsOf(totalsOf(5, 2.5, 1), true)).toBe('2.50 credits plus 1 request without credits')
    expect(creditsOf(totalsOf(5, 2.5, 0), true)).toBe('2.50 credits')
    // Nothing but credit-less requests: no credits, and the count says so.
    expect(creditsOf(totalsOf(2, 0, 2), true)).toBe('0 credits plus 2 requests without credits')
  })

  it('has no credit label for an agent without credits, whatever its totals hold', () => {
    expect(creditsOf(totalsOf(5, 2.5, 3), false)).toBeNull()
  })

  it('labels credits by size: fractions kept, large amounts whole', () => {
    expect([0, 0.004, 0.0987, 1, 9.999, 12.34, 99.94, 1234.5, 56789].map(creditsLabel)).toEqual([
      '0 credits',
      '<0.01 credits',
      '0.10 credits',
      '1.00 credit',
      '10.00 credits',
      '12.3 credits',
      '99.9 credits',
      '1,235 credits',
      '56,789 credits',
    ])
  })

  it('adds the day’s credits to its detail, partial when some requests lack a figure', () => {
    const detail = (d: string) => usageView(both(), { expanded: false, selected: { agent: 'copilot', day: d } }).agents[1].detail
    expect(detail('2026-11-10')).toMatchObject({ requests: '4 requests', credits: '12.3 credits' })
    expect(detail('2026-11-11')?.credits).toBe('0.50 credits plus 2 requests without credits')
    expect(detail('2026-11-12')).toMatchObject({ requests: '0 requests', credits: '0 credits' })
    expect(detail('2026-04-01')?.credits).toBeNull()
    expect(usageView(both(), { expanded: false, selected: { agent: 'claude', day: '2026-11-10' } }).agents[0].detail?.credits).toBeNull()
  })

  it('appears only when it made a request in the last 30 days: the core leaves it out, and the view shows what it is given', () => {
    const only = usageView({ ...summary([day('2026-11-10', 3)]), agents: [summary([day('2026-11-10', 3)]).agents[0]] }, { expanded: false })
    expect(only.agents.map((a) => a.agent)).toEqual(['claude'])
    expect(usageView(both(), { expanded: false }).agents.map((a) => a.agent)).toEqual(['claude', 'copilot'])
    expect(usageView({ ...summary([]), agents: [] }, { expanded: false }).empty).toBe(EMPTY_MESSAGE)
  })
})

// A summary of two agents with the breakdowns filled in.
const zeros = () => new Array<number>(168).fill(0)
const t = (requests: number, more: Partial<UsageTotals> = {}): UsageTotals => ({ requests, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, credits: 0, withoutCredits: 0, ...more })
function agent(name: 'claude' | 'copilot', over: Partial<UsageAgentSummary> = {}): UsageAgentSummary {
  return { agent: name, hasCredits: name === 'copilot', days: [], today: t(0), last7: t(0), last30: t(1), hours: zeros(), repositories: [], models: [], sources: [], trackedSince: null, ...over }
}
const two = (claude: Partial<UsageAgentSummary>, copilot: Partial<UsageAgentSummary> = {}): UsageSummary => ({ ...summary([]), agents: [agent('claude', claude), agent('copilot', copilot)] })
const charts = (s: UsageSummary, options: { expanded?: boolean; range?: RangeId } = {}) => usageView(s, { expanded: options.expanded ?? false, range: options.range }).charts!

describe('the range', () => {
  it('offers 30 days and 18 weeks, and a year only in the expanded dock', () => {
    expect(rangeOptions(false).map((r) => r.label)).toEqual(['30 days', '18 weeks'])
    expect(rangeOptions(true).map((r) => r.label)).toEqual(['30 days', '18 weeks', '1 year'])
  })

  it('marks the selected one, and has a year fall back to 18 weeks when the dock is not expanded', () => {
    expect(charts(two({}), { range: '18w' }).range.filter((r) => r.selected).map((r) => r.id)).toEqual(['18w'])
    expect(charts(two({}), { range: '1y', expanded: true }).range.filter((r) => r.selected).map((r) => r.id)).toEqual(['1y'])
    expect(effectiveRange('1y', false)).toBe('18w')
    expect(charts(two({}), { range: '1y' }).range.filter((r) => r.selected).map((r) => r.id)).toEqual(['18w'])
  })

  it('asks for the days of detail the matrix or the bars need, whichever is more', () => {
    expect(detailDays('2026-11-16', false, '30d')).toBe(matrixSpan('2026-11-16', false))
    expect(detailDays('2026-11-16', false, '18w')).toBe(126)
    expect(detailDays('2026-11-16', true, '1y')).toBe(matrixSpan('2026-11-16', true) < 365 ? 365 : matrixSpan('2026-11-16', true))
    // A year chosen in an expanded dock is not asked for once the dock is not expanded.
    expect(detailDays('2026-11-16', false, '1y')).toBe(126)
  })

  it('names the range in the titles', () => {
    expect(charts(two({}), { range: '18w' }).breakdowns.title).toBe('Where it went, 18 weeks')
    expect(charts(two({}), { range: '18w' }).hours.subtitle).toBe('weekday by hour, 18 weeks')
  })
})

describe('the stacked bars', () => {
  const days = (counts: Array<[string, number]>) => counts.map(([d, n]) => day(d, n))

  it('is one bar per day of the range, oldest first, ending today', () => {
    const bars = charts(two({ days: days([['2026-11-16', 4]]) })).bars
    expect(bars.unit).toBe('day')
    expect(bars.bars).toHaveLength(30)
    expect(bars.bars[0].day).toBe('2026-10-18')
    expect(bars.bars.at(-1)?.day).toBe('2026-11-16')
    expect(charts(two({}), { range: '18w' }).bars.bars).toHaveLength(126)
  })

  it('is one bar per week for a year, Monday first, counting only the days of the range', () => {
    const bars = charts(two({ days: days([['2026-11-16', 4], ['2026-11-15', 2], ['2026-11-09', 5], ['2025-11-17', 1], ['2025-11-16', 7]]) }), { range: '1y', expanded: true }).bars
    expect(bars.unit).toBe('week')
    expect(bars.bars.at(-1)).toMatchObject({ day: '2026-11-16', requests: 4 })
    expect(bars.bars.at(-2)).toMatchObject({ day: '2026-11-09', requests: 7 })
    // The range starts on Monday 2025-11-17: the Sunday before it is not in it.
    expect(bars.bars[0]).toMatchObject({ day: '2025-11-17', requests: 1 })
    expect(bars.bars.length).toBe(53)
  })

  it('draws the height as a share of a round axis top, and the agents stacked in colour order with their requests', () => {
    const bars = charts(two({ days: days([['2026-11-16', 30]]) }, { days: days([['2026-11-16', 25]]) })).bars
    const last = bars.bars.at(-1)!
    expect(bars.ticks.map((tick) => tick.value)).toEqual([100, 50, 0])
    expect(last.requests).toBe(55)
    expect(last.segments).toEqual([
      { agent: 'claude', requests: 30, percent: 30, hatched: false },
      { agent: 'copilot', requests: 25, percent: 25, hatched: false },
    ])
    expect(bars.bars[0].segments).toEqual([])
    expect(last.label).toBe('Mon 16 Nov 2026: 55 requests (Claude 30, Copilot CLI 25)')
  })

  describe('the part of Copilot’s requests made through OpenCode', () => {
    const via = (n: number): UsageSplitTotals => ({ split: 'opencode', ...t(n) })
    const viaDay = (d: string, requests: number, through: number) => day(d, requests, { sources: [{ split: 'other' as const, ...t(requests - through) }, via(through)].filter((x) => x.requests > 0) })

    it('is its own hatched segment on top of Copilot’s own, with its own count in the label', () => {
      const bars = charts(two({ days: days([['2026-11-16', 30]]) }, { days: [viaDay('2026-11-16', 25, 5)] })).bars
      const last = bars.bars.at(-1)!
      expect(last.requests).toBe(55)
      expect(last.segments).toEqual([
        { agent: 'claude', requests: 30, percent: 30, hatched: false },
        { agent: 'copilot', requests: 20, percent: 20, hatched: false },
        { agent: 'copilot', requests: 5, percent: 5, hatched: true },
      ])
      expect(last.label).toBe('Mon 16 Nov 2026: 55 requests (Claude 30, Copilot CLI 20, Copilot via OpenCode 5)')
    })

    it('is the whole of Copilot’s bar on a day when only OpenCode made requests, and a legend entry of its own', () => {
      const bars = charts(two({ days: days([['2026-11-15', 2]]) }, { days: [viaDay('2026-11-16', 4, 4)] })).bars
      expect(bars.bars.at(-1)?.segments).toEqual([{ agent: 'copilot', requests: 4, percent: 80, hatched: true }])
      expect(bars.bars.at(-1)?.label).toBe('Mon 16 Nov 2026: 4 requests (Copilot via OpenCode 4)')
      // Copilot CLI made no request in the range: only the hatched entry stands for Copilot.
      expect(bars.legend).toEqual([
        { agent: 'claude', title: 'Claude', hatched: false },
        { agent: 'copilot', title: 'Copilot via OpenCode', hatched: true },
      ])
    })

    it('has both legend entries when Copilot CLI made requests too, and none of it for a range without OpenCode', () => {
      const mixed = charts(two({}, { days: [viaDay('2026-11-16', 6, 1)] })).bars
      expect(mixed.legend).toEqual([
        { agent: 'claude', title: 'Claude', hatched: false },
        { agent: 'copilot', title: 'Copilot CLI', hatched: false },
        { agent: 'copilot', title: 'Copilot via OpenCode', hatched: true },
      ])
      // Only requests inside the bars' range count: a day before it is not drawn.
      const old = charts(two({}, { days: [viaDay('2026-09-01', 3, 3), day('2026-11-16', 2)] })).bars
      expect(old.legend.map((item) => item.hatched)).toEqual([false, false])
    })

    it('adds up in a week bar like the others', () => {
      const bars = charts(two({}, { days: [viaDay('2026-11-16', 4, 3), viaDay('2026-11-15', 2, 2)] }), { range: '1y', expanded: true }).bars
      expect(bars.bars.at(-1)?.segments).toEqual([{ agent: 'copilot', requests: 1, percent: 20, hatched: false }, { agent: 'copilot', requests: 3, percent: 60, hatched: true }])
    })
  })

  it('has a legend of the agents shown, and says when a bar is from before the history', () => {
    const s = { ...two({ days: days([['2026-11-16', 3]]) }), historyFrom: '2026-11-01' }
    const bars = charts(s).bars
    expect(bars.legend).toEqual([
      { agent: 'claude', title: 'Claude', hatched: false },
      { agent: 'copilot', title: 'Copilot CLI', hatched: false },
    ])
    expect(bars.bars[0].label).toBe('Sun 18 Oct 2026: before the history starts')
    expect(bars.bars[20].label).toMatch(/: 0 requests$/)
    expect(bars.total).toBe('3 requests')
  })

  it('rounds the axis top up to 1, 2 or 5 times a power of ten', () => {
    expect([0, 1, 3, 7, 12, 20, 21, 55, 101, 5400].map(niceMax)).toEqual([1, 1, 5, 10, 20, 20, 50, 100, 200, 10000])
    expect(charts(two({ days: days([['2026-11-16', 7]]) })).bars.ticks.map((tick) => tick.label)).toEqual(['10', '5', '0'])
    expect(charts(two({ days: days([['2026-11-16', 5400]]) })).bars.ticks.map((tick) => tick.label)).toEqual(['10,000', '5,000', '0'])
  })
})

describe('"When you work"', () => {
  const cell = (s: UsageSummary, row: number, hour: number) => charts(s).hours.rows[row].cells[hour]

  it('has Monday to Sunday with 24 hours each, and adds the agents shown', () => {
    const a = zeros()
    a[0 * 24 + 9] = 4
    const b = zeros()
    b[0 * 24 + 9] = 3
    b[6 * 24 + 23] = 1
    const hours = charts(two({ hours: a }, { hours: b })).hours
    expect(hours.rows.map((r) => r.weekday)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(hours.rows.every((r) => r.cells.length === 24)).toBe(true)
    expect(hours.rows[0].cells[9]).toMatchObject({ hour: 9, requests: 7, label: 'Mon 09:00: 7 requests' })
    expect(hours.rows[6].cells[23]).toMatchObject({ requests: 1, label: 'Sun 23:00: 1 request' })
    expect(hours.axis).toEqual(['00', '06', '12', '18', '23'])
  })

  it('shades by rank among the hours with requests, as the matrix does: an empty hour is 0 and one huge hour does not wash out the rest', () => {
    const h = zeros()
    ;[1, 2, 3, 1000].forEach((n, i) => (h[i] = n))
    const s = two({ hours: h })
    expect([0, 1, 2, 3, 4].map((i) => cell(s, 0, i).shade)).toEqual([1, 2, 3, 4, 0])
  })
})

describe('"Where it went"', () => {
  const repo = (name: string | null, requests: number, more: Partial<UsageRepositoryTotals> = {}): UsageRepositoryTotals => ({ name, space: false, ...t(requests), ...more })
  const rows = (s: UsageSummary) => charts(s).breakdowns.repositories.map((r) => [r.name, r.requests, r.space])

  it('lists the repositories by requests, Other last however big it is, and marks the Spaces', () => {
    const s = two({ repositories: [repo(null, 500), repo('grove', 300, { space: true }), repo('api', 200)] })
    expect(rows(s)).toEqual([
      ['grove', '300', true],
      ['api', '200', false],
      ['Other', '500', false],
    ])
    expect(charts(s).breakdowns.repositories.map((r) => r.other)).toEqual([false, false, true])
  })

  it('adds the agents, and fills each row’s bar with the agents’ parts, the biggest row filling it', () => {
    const s = two({ repositories: [repo('grove', 60), repo('api', 20)] }, { repositories: [repo('grove', 40)] })
    const found = charts(s).breakdowns.repositories
    expect(found.map((r) => [r.name, r.requests, r.share])).toEqual([
      ['grove', '100', '83%'],
      ['api', '20', '17%'],
    ])
    expect(found[0].segments).toEqual([
      { agent: 'claude', percent: 60 },
      { agent: 'copilot', percent: 40 },
    ])
    expect(found[1].segments).toEqual([{ agent: 'claude', percent: 20 }])
  })

  it('folds groups under 1% into Other, and leaves no Other when there is nothing for it', () => {
    const tiny = two({ repositories: [repo('big', 995), repo('speck', 3), repo(null, 2)] })
    expect(rows(tiny)).toEqual([
      ['big', '995', false],
      ['Other', '5', false],
    ])
    expect(rows(two({ repositories: [repo('a', 60), repo('b', 40)] })).map((r) => r[0])).toEqual(['a', 'b'])
    // Exactly 1% stays.
    expect(rows(two({ repositories: [repo('big', 99), repo('one', 1)] })).map((r) => r[0])).toEqual(['big', 'one'])
  })

  it('keeps a Space’s row however small', () => {
    const s = two({ repositories: [repo('big', 995), repo('tiny', 3, { space: true })] })
    expect(rows(s)).toEqual([
      ['big', '995', false],
      ['tiny', '3', true],
    ])
  })

  it('keeps a Space apart from a plain repository of the same name', () => {
    expect(rows(two({ repositories: [repo('app', 60, { space: true })] }, { repositories: [repo('app', 40)] })).map((r) => [r[0], r[2]])).toEqual([
      ['app', true],
      ['app', false],
    ])
  })

  it('shows credits of the agents that have them in the row’s detail, and never a dollar sign', () => {
    const s = two({ repositories: [repo('app', 60)] }, { repositories: [repo('app', 40, { credits: 12.4, withoutCredits: 3 })] })
    const detail = charts(s).breakdowns.repositories[0].detail
    expect(detail).toBe('100 requests, 100%. Copilot CLI: 12.4 credits plus 3 requests without credits')
    expect(detail).not.toContain('$')
  })

  it('lists the models by requests with the date cut off their names, and does not fold small ones', () => {
    const model = (name: string, requests: number): UsageModelTotals => ({ model: name, ...t(requests) })
    const s = two({ models: [model('claude-opus-4-5-20251101', 900), model('claude-haiku', 99), model('', 1)] }, { models: [model('gpt-5', 5)] })
    expect(charts(s).breakdowns.models.map((r) => [r.name, r.requests])).toEqual([
      ['claude-opus-4-5', '900'],
      ['claude-haiku', '99'],
      ['gpt-5', '5'],
      ['Unknown model', '1'],
    ])
  })

  it('puts the agent in front of a model name both agents run', () => {
    const s = two({ models: [{ model: 'sonnet', ...t(10) }] }, { models: [{ model: 'sonnet', ...t(5) }, { model: 'gpt', ...t(1) }] })
    expect(charts(s).breakdowns.models.map((r) => r.name)).toEqual(['Claude · sonnet', 'Copilot CLI · sonnet', 'gpt'])
  })

  it('has no charts when no agent is shown', () => {
    expect(usageView({ ...summary([]), agents: [] }, { expanded: false }).charts).toBeNull()
  })
})

describe('a day’s helper agents and models', () => {
  const view = (d: UsageDay) => usageView({ ...summary([d]) }, { expanded: false, selected: { agent: 'claude', day: d.day } }).agents[0].detail!

  it('shows the share of the day’s requests that helper agents made', () => {
    expect(view(day('2026-11-10', 8, { helperRequests: 2 })).helper).toBe('25% (2)')
    expect(view(day('2026-11-10', 8, { helperRequests: 0 })).helper).toBe('0% (0)')
    expect(view(day('2026-11-10', 1000, { helperRequests: 1 })).helper).toBe('<1% (1)')
    expect(view(day('2026-11-10', 0)).helper).toBeNull()
  })

  it('splits the day by model, with requests and tokens', () => {
    const models: UsageModelTotals[] = [
      { model: 'claude-opus-4-5-20251101', ...t(3, { input: 40, output: 1200, cacheRead: 3_000_000, cacheWrite: 800 }) },
      { model: 'claude-haiku', ...t(1) },
    ]
    expect(view(day('2026-11-10', 4, { models })).models).toEqual([
      { model: 'claude-opus-4-5', requests: '3 requests', tokens: '40 in · 1.2k out · 3M cache' },
      { model: 'claude-haiku', requests: '1 request', tokens: '0 in · 0 out · 0 cache' },
    ])
  })

  it('has neither for a day before the history', () => {
    const detail = usageView(summary([]), { expanded: false, selected: { agent: 'claude', day: '2026-04-01' } }).agents[0].detail!
    expect(detail).toMatchObject({ helper: null, models: [] })
  })
})

describe('small labels', () => {
  it('writes shares as whole percents, <1% for a tiny one', () => {
    expect([percentLabel(1, 3), percentLabel(1, 1000), percentLabel(0, 5), percentLabel(5, 0), percentLabel(1, 1)]).toEqual(['33%', '<1%', '0%', '0%', '100%'])
  })

  it('cuts a date off a model name only when it is the whole suffix', () => {
    expect([modelLabel('claude-haiku-4-5-20251001'), modelLabel('gpt-5.1'), modelLabel('claude-3-5-sonnet-20241022'), modelLabel('')]).toEqual(['claude-haiku-4-5', 'gpt-5.1', 'claude-3-5-sonnet', 'Unknown model'])
  })
})

// The agents' colours in the bars and rows, against the surface they are drawn on, in every theme.
describe('the agent colours contrast', () => {
  const UI = fileURLToPath(new URL('.', import.meta.url))
  const tokens = readFileSync(`${UI}src/tokens.css`, 'utf8')
  const themesCss = readFileSync(`${UI}src/themes.css`, 'utf8')
  const token = (name: string) => tokens.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'))![1]
  // [name, ground, ink] of the default tokens and of every theme preset.
  const themes: Array<[string, string, string]> = []
  for (const block of (tokens + '\n' + themesCss).matchAll(/:root(?:\[data-theme='([\w-]+)'\])?\s*\{([^}]*)\}/g)) {
    const ground = block[2].match(/--color-ground:\s*(#[0-9a-f]{6})/i)?.[1]
    if (ground) themes.push([block[1] ?? 'default', ground, block[2].match(/--color-ink:\s*(#[0-9a-f]{6})/i)?.[1] ?? token('color-ink')])
  }
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const luminance = (c: number[]) => {
    const [r, g, b] = c.map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const contrast = (a: number[], b: number[]) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }
  const mix = (a: string, b: string, percent: number) => rgb(a).map((c, i) => c * (percent / 100) + rgb(b)[i] * (1 - percent / 100))
  // The colours as the CSS makes them: Claude's token as it is, Copilot's mixed toward the ink.
  const claude = () => rgb(token('agent-claude'))
  const copilot = (ink: string) => mix(token('agent-copilot'), ink, COPILOT_MIX)

  it('are the tokens, and Copilot’s a mix of its token over the ink', () => {
    expect(agentColour('claude')).toBe('var(--agent-claude)')
    expect(agentColour('copilot')).toBe(`color-mix(in srgb, var(--agent-copilot) ${COPILOT_MIX}%, var(--color-ink))`)
    expect(themes.length).toBeGreaterThan(5)
  })

  it.each(themes)('%s: each agent stands out from the surface by 3:1', (_name, ground, ink) => {
    expect(contrast(claude(), rgb(ground))).toBeGreaterThanOrEqual(3)
    expect(contrast(copilot(ink), rgb(ground))).toBeGreaterThanOrEqual(3)
  })

  it.each(themes)('%s: the two differ in lightness, not only in hue', (_name, _ground, ink) => {
    expect(contrast(claude(), copilot(ink))).toBeGreaterThanOrEqual(1.4)
  })
})

// Where requests ran: the share bar per agent for the range and in a day's detail, its labels and its colours.
describe('where requests ran', () => {
  const split = (kind: UsageSplit, requests: number, more: Partial<UsageTotals> = {}): UsageSplitTotals => ({ split: kind, ...t(requests, more) })
  const claude = (sources: UsageSplitTotals[], over: Partial<UsageAgentSummary> = {}) => agent('claude', { sources, trackedSince: '2026-11-05', ...over })
  const bar = (view: ReturnType<typeof usageView>, name: UsageAgent = 'claude') => view.agents.find((a) => a.agent === name)!.sources

  it('splits Claude into Claude Desktop, Claude Code run in Grove and Claude Code not tracked by Grove, with their shares', () => {
    const view = usageView(two({ sources: [split('desktop', 50), split('grove', 30), split('other', 20)], trackedSince: '2026-11-05' }), { expanded: false })
    expect(bar(view)?.segments.map((s) => [s.label, s.requests, s.share, s.percent])).toEqual([
      ['Claude Desktop', '50 requests', '50%', 50],
      ['Claude Code run in Grove', '30 requests', '30%', 30],
      ['Claude Code not tracked by Grove', '20 requests', '20%', 20],
    ])
    expect(bar(view)?.note).toBeNull()
    expect(view.agents[0].sourcesTitle).toBe('Where it ran, 30 days')
  })

  it('labels Copilot’s two places, and keeps the agent labelled Copilot CLI', () => {
    const view = usageView(two({}, { sources: [split('grove', 3), split('other', 1)] }), { expanded: false })
    expect(view.agents[1].title).toBe('Copilot CLI')
    expect(bar(view, 'copilot')?.segments.map((s) => [s.label, s.share])).toEqual([
      ['Copilot CLI run in Grove', '75%'],
      ['Copilot CLI not tracked by Grove', '25%'],
    ])
  })

  it('draws only what cannot be told hatched', () => {
    const view = usageView(two({ sources: [split('desktop', 1), split('grove', 1), split('other', 1), split('unknown', 1)] }), { expanded: false })
    expect(bar(view)?.segments.map((s) => [s.split, s.hatched])).toEqual([
      ['desktop', false],
      ['grove', false],
      ['other', false],
      ['unknown', true],
    ])
  })

  it('hides a place with no requests, and has no bar at all when none ran', () => {
    const view = usageView(two({ sources: [split('desktop', 0), split('grove', 4), split('other', 0)] }, { sources: [] }), { expanded: false })
    expect(bar(view)?.segments.map((s) => s.label)).toEqual(['Claude Code run in Grove'])
    expect(bar(view, 'copilot')).toBeNull()
  })

  it('says in one line when Claude Code cannot be told, with the day Grove began recording', () => {
    const view = usageView(two({ sources: [split('unknown', 40), split('grove', 10)], trackedSince: '2026-11-05' }), { expanded: false })
    expect(bar(view)?.segments.map((s) => s.label)).toEqual(['Claude Code, can’t tell', 'Claude Code run in Grove'])
    expect(bar(view)?.note).toBe('Grove began recording Claude sessions on Thu 5 Nov 2026; Claude Code requests before it can’t be split.')
    expect(bar(view)?.note).not.toContain('\n')
  })

  it('shows the requests OpenCode made on Copilot’s models as their own hatched place, with no Grove split and no credits', () => {
    const view = usageView(two({}, { hasCredits: true, sources: [split('grove', 3, { credits: 2.5 }), split('other', 1, { credits: 0.5 }), split('opencode', 4, { withoutCredits: 4 })] }), { expanded: false })
    const segments = bar(view, 'copilot')?.segments
    expect(segments?.map((s) => [s.split, s.label, s.share, s.hatched])).toEqual([
      ['grove', 'Copilot CLI run in Grove', '38%', false],
      ['other', 'Copilot CLI not tracked by Grove', '13%', false],
      ['opencode', 'Copilot via OpenCode', '50%', true],
    ])
    expect(segments?.[2].credits).toBe('4 requests without credits')
    expect(segments?.[2].title).toBe('Copilot via OpenCode: 4 requests, 50%. 4 requests without credits')
    expect(segments?.[2].colour).toBe(splitColour('copilot', 'opencode'))
    expect(bar(view, 'copilot')?.note).toBeNull()
  })

  it('has it in the day’s detail with the credit note on the day’s total', () => {
    const days = [day('2026-11-11', 4, { credits: 2.5, withoutCredits: 2, sources: [{ split: 'other', ...t(2, { credits: 2.5 }) }, { split: 'opencode', ...t(2, { withoutCredits: 2 }) }] })]
    const s = { ...summary([]), agents: [agent('copilot', { days, hasCredits: true })] }
    const detail = usageView(s, { expanded: false, selected: { agent: 'copilot', day: '2026-11-11' } }).agents[0].detail
    expect(detail?.credits).toBe('2.50 credits plus 2 requests without credits')
    expect(detail?.sources?.segments.map((x) => [x.label, x.requests])).toEqual([
      ['Copilot CLI not tracked by Grove', '2 requests'],
      ['Copilot via OpenCode', '2 requests'],
    ])
  })

  it('says so when Grove has no record of Claude sessions at all', () => {
    const view = usageView(two({ sources: [split('unknown', 5)], trackedSince: null }), { expanded: false })
    expect(bar(view)?.note).toBe('Grove has no record of your Claude sessions, so earlier Claude Code requests can’t be split.')
  })

  it('gives no note when nothing is unknown, and shows a share too small for a percent as under 1%', () => {
    const view = usageView(two({ sources: [split('desktop', 1000), split('grove', 1)] }), { expanded: false })
    expect(bar(view)?.note).toBeNull()
    expect(bar(view)?.segments.map((s) => s.share)).toEqual(['100%', '<1%'])
  })

  it('carries Copilot’s credits per place, partial totals included, and none for Claude', () => {
    const view = usageView(two({ sources: [split('desktop', 2)] }, { sources: [split('grove', 3, { credits: 2.5, withoutCredits: 1 }), split('other', 1, { credits: 0.5 })] }), { expanded: false })
    expect(bar(view, 'copilot')?.segments.map((s) => s.credits)).toEqual(['2.50 credits plus 1 request without credits', '0.50 credits'])
    expect(bar(view, 'copilot')?.segments[0].title).toBe('Copilot CLI run in Grove: 3 requests, 75%. 2.50 credits plus 1 request without credits')
    expect(bar(view)?.segments[0].credits).toBeNull()
    expect(JSON.stringify(view)).not.toContain('$')
  })

  it('is in the day’s detail too, with the note where it applies, and not for a day without requests or before the history', () => {
    const days = [day('2026-11-10', 5, { sources: [split('unknown', 5)] }), day('2026-11-11', 4, { sources: [split('desktop', 3), split('grove', 1)] }), day('2026-11-12', 0)]
    const s = { ...summary([]), agents: [claude([], { days })] }
    const detailOf = (d: string) => usageView(s, { expanded: false, selected: { agent: 'claude', day: d } }).agents[0].detail
    expect(detailOf('2026-11-10')?.sources?.segments.map((x) => x.label)).toEqual(['Claude Code, can’t tell'])
    expect(detailOf('2026-11-10')?.sources?.note).toContain('5 Nov 2026')
    expect(detailOf('2026-11-11')?.sources?.segments.map((x) => [x.label, x.share])).toEqual([
      ['Claude Desktop', '75%'],
      ['Claude Code run in Grove', '25%'],
    ])
    expect(detailOf('2026-11-11')?.sources?.note).toBeNull()
    expect(detailOf('2026-11-12')?.sources).toBeNull()
    expect(detailOf('2026-11-09')?.sources).toBeNull()
    expect(detailOf('2026-04-30')?.sources).toBeNull()
  })

  it('follows the range the bars cover in its title', () => {
    const view = usageView(two({ sources: [split('grove', 1)] }), { expanded: true, range: '1y' })
    expect(view.agents[0].sourcesTitle).toBe('Where it ran, 1 year')
  })

  it('keeps the machine-only note', () => {
    expect(usageView(two({ sources: [split('grove', 1)] }), { expanded: false }).scope).toBe('This machine only')
  })
})

// The colours of the places, against the surface they are drawn on, in every theme.
describe('the colours of where requests ran', () => {
  const UI = fileURLToPath(new URL('.', import.meta.url))
  const tokens = readFileSync(`${UI}src/tokens.css`, 'utf8')
  const themesCss = readFileSync(`${UI}src/themes.css`, 'utf8')
  const token = (name: string) => tokens.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'))![1]
  const themes: Array<[string, string, string]> = []
  for (const block of (tokens + '\n' + themesCss).matchAll(/:root(?:\[data-theme='([\w-]+)'\])?\s*\{([^}]*)\}/g)) {
    const ground = block[2].match(/--color-ground:\s*(#[0-9a-f]{6})/i)?.[1]
    if (ground) themes.push([block[1] ?? 'default', ground, block[2].match(/--color-ink:\s*(#[0-9a-f]{6})/i)?.[1] ?? token('color-ink')])
  }
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const luminance = (c: number[]) => {
    const [r, g, b] = c.map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const contrast = (a: number[], b: number[]) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }
  const mix = (a: number[], b: number[], percent: number) => a.map((c, i) => c * (percent / 100) + b[i] * (1 - percent / 100))
  // The colours as the CSS makes them, for one agent: its own colour mixed toward the ink, "can't tell" the ink over the ground.
  const colours = (agent: UsageAgent, ground: string, ink: string): Record<UsageSplit, number[]> => {
    const base = agent === 'copilot' ? mix(rgb(token('agent-copilot')), rgb(ink), COPILOT_MIX) : rgb(token('agent-claude'))
    return {
      grove: base,
      other: mix(rgb(ink), base, SPLIT_INK_MIX.other),
      desktop: mix(rgb(ink), base, SPLIT_INK_MIX.desktop),
      unknown: mix(rgb(ink), rgb(ground), SPLIT_UNKNOWN_MIX),
      opencode: mix(rgb(ink), base, SPLIT_INK_MIX.opencode),
    }
  }

  it('are the agent’s colour, mixed toward the ink, and the ink over the ground for what cannot be told', () => {
    expect(splitColour('claude', 'grove')).toBe('var(--agent-claude)')
    expect(splitColour('claude', 'desktop')).toBe(`color-mix(in srgb, var(--color-ink) ${SPLIT_INK_MIX.desktop}%, var(--agent-claude))`)
    expect(splitColour('copilot', 'other')).toBe(`color-mix(in srgb, var(--color-ink) ${SPLIT_INK_MIX.other}%, ${agentColour('copilot')})`)
    expect(splitColour('claude', 'unknown')).toBe(`color-mix(in srgb, var(--color-ink) ${SPLIT_UNKNOWN_MIX}%, var(--color-ground))`)
    expect(splitColour('copilot', 'opencode')).toBe(`color-mix(in srgb, var(--color-ink) ${SPLIT_INK_MIX.opencode}%, ${agentColour('copilot')})`)
    expect(themes.length).toBeGreaterThan(5)
  })

  it.each(themes)('%s: every place stands out from the surface by 3:1', (_name, ground, ink) => {
    for (const agent of ['claude', 'copilot'] as const) for (const colour of Object.values(colours(agent, ground, ink))) expect(contrast(colour, rgb(ground))).toBeGreaterThanOrEqual(3)
  })

  // The three places that are the agent's colour step apart in lightness; "can't tell" is hatched, so it needs no step of its own.
  it.each(themes)('%s: the places of an agent differ from each other in lightness, not only in hue', (_name, ground, ink) => {
    for (const agent of ['claude', 'copilot'] as const) {
      const { grove, other, desktop } = colours(agent, ground, ink)
      for (const [a, b] of [[grove, other], [other, desktop], [grove, desktop]]) expect(contrast(a, b)).toBeGreaterThanOrEqual(1.1)
    }
  })

  // Copilot's places are Copilot CLI run in Grove, not tracked by Grove, and via OpenCode (which is hatched too, but also has its own step).
  it.each(themes)('%s: via OpenCode differs in lightness from both of Copilot CLI’s places', (_name, ground, ink) => {
    const { grove, other, opencode } = colours('copilot', ground, ink)
    for (const [a, b] of [[grove, opencode], [other, opencode]]) expect(contrast(a, b)).toBeGreaterThanOrEqual(1.1)
  })
})
