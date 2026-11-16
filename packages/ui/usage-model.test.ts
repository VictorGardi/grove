import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { UsageAgentSummary, UsageDay, UsageSummary } from '../protocol/messages.ts'
import {
  EMPTY_MESSAGE,
  creditsLabel,
  creditsOf,
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
} from './usage-model.ts'

// 2026-11-16 is a Monday.
const day = (d: string, requests: number, more: Partial<UsageDay> = {}): UsageDay => ({ day: d, requests, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, credits: 0, withoutCredits: 0, ...more })

function summary(days: UsageDay[], more: Partial<UsageSummary> = {}, totals: Partial<UsageAgentSummary> = {}): UsageSummary {
  const sum = (n: number) => ({ requests: n, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, credits: 0, withoutCredits: 0 })
  return {
    today: '2026-11-16',
    historyFrom: '2026-05-01',
    building: false,
    ready: { from: '2026-05-01', to: '2026-11-16' },
    agents: [{ agent: 'claude', hasCredits: false, days, today: sum(0), last7: sum(0), last30: sum(days.length), ...totals }],
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

  it('says the history is still being built, and how far it has got', () => {
    expect(usageView(summary([]), { expanded: false }).building).toBeNull()
    expect(usageView(summary([], { building: true, ready: { from: '2026-10-01', to: '2026-11-16' } }), { expanded: false }).building).toBe('Still building the history: ready from 1 Oct to 16 Nov')
    expect(usageView(summary([], { building: true, ready: null }), { expanded: false }).building).toBe('Still building the history')
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
    expect(selected('2026-11-10')).toEqual({
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
    days: [{ day: '2026-11-10', ...totalsOf(4, 12.34) }, { day: '2026-11-11', ...totalsOf(9, 0.5, 2) }],
    today: totalsOf(0, 0),
    last7: totalsOf(13, 12.84, 2),
    last30: totalsOf(40, 1234.5),
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
