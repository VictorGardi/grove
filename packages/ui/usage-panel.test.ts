// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UsageSummary } from '../protocol/messages.ts'
import type { DockContext } from './dock.ts'
import { createHostBus, type DockModule } from './modules.ts'
import { usageModule } from './dock-modules.ts'
import { EMPTY_MESSAGE, MATRIX_WEEKS, MATRIX_WEEKS_EXPANDED, SHADE_MIX } from './usage-model.ts'

const sum = (requests: number) => ({ requests, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, credits: 0, withoutCredits: 0 })
// 2026-11-16 is a Monday.
const NOW = new Date(2026, 10, 16, 12).getTime()

function summary(over: Partial<UsageSummary> = {}): UsageSummary {
  return {
    today: '2026-11-16',
    historyFrom: '2026-05-01',
    building: false,
    ready: { from: '2026-05-01', to: '2026-11-16' },
    agents: [
      {
        agent: 'claude',
        hasCredits: false,
        days: [
          { day: '2026-11-10', requests: 2, input: 40, output: 1200, cacheRead: 3_000_000, cacheWrite: 800, credits: 0, withoutCredits: 0, helperRequests: 0, models: [], sources: [] },
          { day: '2026-11-11', requests: 9, input: 1, output: 2, cacheRead: 3, cacheWrite: 4, credits: 0, withoutCredits: 0, helperRequests: 0, models: [], sources: [] },
        ],
        today: sum(0),
        last7: sum(11),
        last30: sum(11),
        hours: new Array<number>(168).fill(0),
        repositories: [],
        models: [],
        sources: [],
        trackedSince: null,
      },
    ],
    ...over,
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

function setup(first: UsageSummary = summary(), connected = true) {
  document.body.innerHTML = ''
  const body = document.body.appendChild(document.createElement('div'))
  const calls: number[] = []
  const ranges: number[] = []
  const state = { summary: first, connected, expanded: false, fail: null as Error | null }
  const spoken = { status: [] as string[], error: [] as Array<string | null> }
  const expandedListeners: Array<() => void> = []
  const context: DockContext = {
    status: (t) => void spoken.status.push(t),
    meta: () => undefined,
    error: (m) => void spoken.error.push(m),
    close: () => undefined,
    expanded: () => state.expanded,
    onExpanded: (l) => {
      expandedListeners.push(l)
      return () => void expandedListeners.splice(expandedListeners.indexOf(l), 1)
    },
  }
  const module: DockModule & { changed(): void } = usageModule({
    summary: async (days, range) => {
      calls.push(days)
      ranges.push(range)
      if (state.fail) throw state.fail
      return state.summary
    },
    connected: () => state.connected,
    now: () => NOW,
  })
  const bus = createHostBus((e) => {
    throw e
  })
  module.follow?.(bus)
  const instance = module.panel.mount(body, context)
  const expand = (on: boolean) => {
    state.expanded = on
    for (const l of [...expandedListeners]) l()
  }
  return { body, calls, ranges, state, spoken, module, bus, instance, expand }
}

const cell = (body: HTMLElement, day: string) => body.querySelector<HTMLButtonElement>(`.usage-cell[data-day="${day}"]`)!

describe('usage panel', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }))
  afterEach(() => vi.useRealTimers())

  it('draws a matrix of the agent’s days, darker for more requests, with its totals', async () => {
    const t = setup()
    await flush()
    expect(t.body.querySelector('.usage-agent-title')?.textContent).toBe('Claude')
    expect(t.body.querySelectorAll('.usage-week')).toHaveLength(MATRIX_WEEKS)
    expect(cell(t.body, '2026-11-10').dataset.shade).toBe('2')
    expect(cell(t.body, '2026-11-11').dataset.shade).toBe('4')
    expect(cell(t.body, '2026-11-11').style.getPropertyValue('--mix')).toBe(`${SHADE_MIX[4]}%`)
    expect(cell(t.body, '2026-11-12').dataset.shade).toBe('0')
    expect([...t.body.querySelectorAll('.usage-total')].map((n) => n.textContent)).toEqual(['Today0 requests', '7 days11 requests', '30 days11 requests'])
    expect(t.body.querySelector('.usage-from')?.textContent).toBe('History from Fri 1 May 2026')
    expect(t.body.querySelector('.usage-scope')?.textContent).toBe('This machine only')
  })

  it('draws where the range ran as a labelled share bar with the note, and the same in a clicked day', async () => {
    const base = summary()
    const part = (split: 'desktop' | 'grove' | 'other' | 'unknown', requests: number) => ({ split, requests, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, credits: 0, withoutCredits: 0 })
    const claude = base.agents[0]
    const t = setup({
      ...base,
      agents: [
        {
          ...claude,
          trackedSince: '2026-11-05',
          sources: [part('desktop', 6), part('grove', 3), part('unknown', 1)],
          days: claude.days.map((d) => (d.day === '2026-11-11' ? { ...d, sources: [part('desktop', 9)] } : d)),
        },
      ],
    })
    await flush()
    const block = t.body.querySelector('.usage-agent > .usage-sources')!
    expect(block.querySelector('.usage-sources-title')?.textContent).toBe('Where it ran, 30 days')
    expect([...block.querySelectorAll('.usage-sources-segment')].map((n) => (n as HTMLElement).style.width)).toEqual(['60%', '30%', '10%'])
    expect([...block.querySelectorAll('.usage-sources-segment')].map((n) => (n as HTMLElement).dataset.hatched)).toEqual(['false', 'false', 'true'])
    expect([...block.querySelectorAll('.usage-sources-item')].map((n) => n.querySelector('.usage-sources-label')?.textContent)).toEqual(['Claude Desktop', 'Claude Code run in Grove', 'Claude Code, can’t tell'])
    expect(block.querySelector('.usage-sources-note')?.textContent).toContain('Grove began recording Claude sessions on Thu 5 Nov 2026')
    cell(t.body, '2026-11-11').click()
    const detail = t.body.querySelector('.usage-detail .usage-sources')!
    expect([...detail.querySelectorAll('.usage-sources-label')].map((n) => n.textContent)).toEqual(['Claude Desktop'])
    expect(detail.querySelector('.usage-sources-note')).toBeNull()
  })

  it('draws Copilot beside Claude with its credits as a quieter number, no dollar sign', async () => {
    const base = summary()
    const t = setup({
      ...base,
      agents: [
        ...base.agents,
        {
          agent: 'copilot',
          hasCredits: true,
          days: [{ day: '2026-11-11', requests: 3, input: 5, output: 6, cacheRead: 7, cacheWrite: 8, credits: 2.5, withoutCredits: 1, helperRequests: 0, models: [], sources: [] }],
          today: { ...sum(0) },
          last7: { ...sum(3), credits: 2.5, withoutCredits: 1 },
          last30: { ...sum(3), credits: 2.5, withoutCredits: 1 },
          hours: new Array<number>(168).fill(0),
          repositories: [],
          models: [],
          sources: [],
          trackedSince: null,
        },
      ],
    })
    await flush()
    const sections = [...t.body.querySelectorAll('.usage-agent')]
    expect(sections.map((n) => n.querySelector('.usage-agent-title')?.textContent)).toEqual(['Claude', 'Copilot CLI'])
    expect(sections[0].querySelector('.usage-total-credits')).toBeNull()
    expect([...sections[1].querySelectorAll('.usage-total-credits')].map((n) => n.textContent)).toEqual(['0 credits', '2.50 credits plus 1 request without credits', '2.50 credits plus 1 request without credits'])
    sections[1].querySelector<HTMLButtonElement>('.usage-cell[data-day="2026-11-11"]')!.click()
    expect(t.body.querySelector('.usage-detail-credits')?.textContent).toBe('2.50 credits plus 1 request without credits')
    expect(t.body.textContent).not.toContain('$')
  })

  it('shows a clicked day’s detail, and hides it when the day is clicked again', async () => {
    const t = setup()
    await flush()
    expect(t.body.querySelector('.usage-detail')).toBeNull()
    cell(t.body, '2026-11-10').click()
    expect(t.body.querySelector('.usage-detail-title')?.textContent).toBe('Tue 10 Nov 2026')
    expect(t.body.querySelector('.usage-detail-requests')?.textContent).toBe('2 requests')
    expect([...t.body.querySelectorAll('.usage-token')].map((n) => n.textContent)).toEqual(['Fresh input40', 'Output1.2k', 'Cache read3M', 'Cache write800'])
    expect(cell(t.body, '2026-11-10').getAttribute('aria-pressed')).toBe('true')
    cell(t.body, '2026-11-10').click()
    expect(t.body.querySelector('.usage-detail')).toBeNull()
  })

  it('says there is no usage when no agent made a request in the last 30 days', async () => {
    const t = setup(summary({ agents: [] }))
    await flush()
    expect(t.body.querySelector('.usage-empty')?.textContent).toBe(EMPTY_MESSAGE)
    expect(t.body.querySelector('.usage-agent')).toBeNull()
  })

  it('says the history is still being built', async () => {
    const t = setup(summary({ building: true, ready: { from: '2026-11-01', to: '2026-11-16' } }))
    await flush()
    expect(t.spoken.status.at(-1)).toBe('Still building the history: ready from 1 Nov to 16 Nov')
  })

  it('asks for as many days as the matrix draws, and a year in the expanded dock', async () => {
    const t = setup()
    await flush()
    expect(t.calls).toEqual([12 * 7 + 1])
    t.expand(true)
    await flush()
    expect(t.calls.at(-1)).toBe(52 * 7 + 1)
    expect(t.body.querySelectorAll('.usage-week')).toHaveLength(MATRIX_WEEKS_EXPANDED)
    t.expand(false)
    await flush()
    expect(t.body.querySelectorAll('.usage-week')).toHaveLength(MATRIX_WEEKS)
  })

  it('asks again when the core says the numbers changed, when the connection returns and when an agent settles', async () => {
    const t = setup()
    await flush()
    t.module.changed()
    t.bus.emit('connectionChanged', { open: true })
    t.bus.emit('agentStateChanged', { tabId: 't', settled: true })
    t.bus.emit('agentStateChanged', { tabId: 't', settled: false })
    t.bus.emit('connectionChanged', { open: false })
    await flush()
    expect(t.calls).toHaveLength(4)
  })

  it('shows new numbers and keeps the clicked day', async () => {
    const t = setup()
    await flush()
    cell(t.body, '2026-11-10').click()
    t.state.summary = summary({ agents: [{ ...summary().agents[0], days: [{ day: '2026-11-10', requests: 7, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, credits: 0, withoutCredits: 0, helperRequests: 0, models: [], sources: [] }] }] })
    t.module.changed()
    await flush()
    expect(t.body.querySelector('.usage-detail-requests')?.textContent).toBe('7 requests')
  })

  it('does not ask while disconnected, and says why when the core fails', async () => {
    const off = setup(summary(), false)
    await flush()
    expect(off.calls).toEqual([])
    const t = setup()
    await flush()
    t.state.fail = new Error('core went away')
    t.module.changed()
    await flush()
    expect(t.spoken.error.at(-1)).toBe('Could not read the usage: core went away')
    // The last numbers stay on screen.
    expect(t.body.querySelector('.usage-agent')).not.toBeNull()
  })

  it('stops asking once closed', async () => {
    const t = setup()
    await flush()
    t.instance.destroy()
    t.module.changed()
    t.expand(true)
    await flush()
    expect(t.calls).toHaveLength(1)
  })

  it('is a dock module with a rail button and a key action', () => {
    const t = setup()
    expect(t.module).toMatchObject({ keyAction: 'usage', button: { icon: 'usage', label: null, tooltip: 'Usage' }, panel: { id: 'usage', title: 'Usage' } })
  })

  describe('the views over a range', () => {
    const withCharts = (): UsageSummary => {
      const base = summary()
      const hours = new Array<number>(168).fill(0)
      hours[9] = 5
      return {
        ...base,
        agents: [
          {
            ...base.agents[0],
            days: [{ ...base.agents[0].days[1], requests: 9, helperRequests: 3, models: [{ model: 'claude-opus-4-5-20251101', ...sum(9) }] }],
            hours,
            repositories: [
              { name: 'grove', space: true, ...sum(7) },
              { name: null, space: false, ...sum(2) },
            ],
            models: [{ model: 'claude-opus-4-5-20251101', ...sum(9) }],
          },
        ],
      }
    }
    const rangeButton = (body: HTMLElement, id: string) => body.querySelector<HTMLButtonElement>(`.usage-range [data-range="${id}"]`)

    it('draws the stacked bars with a legend and axis, the weekday by hour, and where it went', async () => {
      const t = setup(withCharts())
      await flush()
      expect(t.body.querySelectorAll('.usage-bar')).toHaveLength(30)
      const filled = t.body.querySelector<HTMLElement>('.usage-bar[data-day="2026-11-11"] .usage-segment')!
      expect(filled.dataset.agent).toBe('claude')
      expect(filled.style.height).toBe('90%')
      expect([...t.body.querySelectorAll('.usage-tick')].map((n) => n.textContent)).toEqual(['10', '5', '0'])
      expect(t.body.querySelector('.usage-legend')?.textContent).toBe('Claude')
      expect(t.body.querySelectorAll('.usage-hour')).toHaveLength(168)
      expect(t.body.querySelectorAll('.usage-hour')[9].getAttribute('aria-label')).toBe('Mon 09:00: 5 requests')
      expect([...t.body.querySelectorAll('.usage-row')].map((n) => n.querySelector('.usage-row-label')?.textContent)).toEqual(['grove', 'Other'])
      expect(t.body.querySelector('.usage-row-space')?.textContent).toBe('Space')
    })

    it('switches the second breakdown to models', async () => {
      const t = setup(withCharts())
      await flush()
      t.body.querySelector<HTMLButtonElement>('.usage-tab[data-tab="models"]')!.click()
      expect([...t.body.querySelectorAll('.usage-row .usage-row-label')].map((n) => n.textContent)).toEqual(['claude-opus-4-5'])
    })

    it('asks the core again for the range chosen, with the days of detail it needs, and draws it', async () => {
      const t = setup(withCharts())
      await flush()
      expect([rangeButton(t.body, '30d'), rangeButton(t.body, '18w'), rangeButton(t.body, '1y')].map((b) => b?.textContent ?? null)).toEqual(['30 days', '18 weeks', null])
      expect(t.ranges).toEqual([30])
      rangeButton(t.body, '18w')!.click()
      await flush()
      expect(t.ranges.at(-1)).toBe(126)
      expect(t.calls.at(-1)).toBe(126)
      expect(t.body.querySelectorAll('.usage-bar')).toHaveLength(126)
      expect(rangeButton(t.body, '18w')!.getAttribute('aria-pressed')).toBe('true')
    })

    it('offers a year only in the expanded dock, and falls back to 18 weeks when it is not expanded again', async () => {
      const t = setup(withCharts())
      await flush()
      t.expand(true)
      await flush()
      rangeButton(t.body, '1y')!.click()
      await flush()
      expect(t.ranges.at(-1)).toBe(365)
      expect(t.body.querySelector('.usage-columns')?.getAttribute('data-unit')).toBe('week')
      t.expand(false)
      await flush()
      expect(rangeButton(t.body, '1y')).toBeNull()
      expect(t.ranges.at(-1)).toBe(126)
    })

    it('shows the helper share and the model split in a clicked day', async () => {
      const t = setup(withCharts())
      await flush()
      cell(t.body, '2026-11-11').click()
      const detail = t.body.querySelector('.usage-detail')!
      expect(detail.querySelector('.usage-detail-helper')?.textContent).toBe('of which helper agents33% (3)')
      expect(detail.querySelector('.usage-detail-model')?.textContent).toContain('claude-opus-4-5')
    })

    it('has no charts when no agent made a request', async () => {
      const t = setup({ ...summary(), agents: [] })
      await flush()
      expect(t.body.querySelector('.usage-charts')).toBeNull()
    })
  })
})
