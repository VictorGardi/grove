// The usage panel: each agent's requests per day as a matrix (darker = more), the Today / 7 days / 30 days totals and, for a clicked day,
// its detail. The numbers are the core's usage history, read from the agents' files (src/protocol UsageSummary); the panel asks for them when it opens, when the core says
// they changed, when the connection comes back, and when the dock is expanded or not (a longer matrix needs more days). What is drawn is
// decided by usage-model.ts.
import { dayKey } from '../protocol/days.ts'
import type { UsageAgent, UsageSummary } from '../protocol/messages.ts'
import type { DockContext, DockInstance, DockPanel } from './dock.ts'
import type { KeyValueStore } from './persisted-pref.ts'
import {
  SHADE_MIX,
  agentColour,
  detailDays,
  effectiveRange,
  rangeDays,
  usageView,
  type AgentView,
  type BarsView,
  type BreakdownRow,
  type BreakdownsView,
  type ChartsView,
  type HoursView,
  type MatrixCell,
  type RangeId,
  type SourcesView,
} from './usage-model.ts'
import { readUsageBreakdown, readUsageRange, writeUsageBreakdown, writeUsageRange } from './usage-pref.ts'

export interface UsageDeps {
  // `days` of per-day detail, and the hour, repository and model breakdowns over the last `range` days.
  summary(days: number, range: number): Promise<UsageSummary>
  connected(): boolean
  // The window's clock, which says which day the matrix ends on.
  now(): number
  // Where the range and the breakdown the human chose are kept, or null when the window has no storage.
  store: KeyValueStore | null
}

export interface UsagePanel {
  panel: DockPanel
  // The core's numbers changed, or the window has a reason to think they did: ask again while the panel is open.
  refresh(): void
  connection(open: boolean): void
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export function createUsagePanel(deps: UsageDeps): UsagePanel {
  let open: { reload(): void } | null = null
  return {
    panel: {
      id: 'usage',
      title: 'Usage',
      mount: (body, context) => {
        const instance = mountUsage(body, context, deps)
        open = instance
        return {
          focus: () => instance.focus(),
          destroy: () => {
            if (open === instance) open = null
            instance.destroy()
          },
        }
      },
    },
    refresh: () => open?.reload(),
    connection: (isOpen) => {
      if (isOpen) open?.reload()
    },
  }
}

function cellButton(agent: UsageAgent, cell: MatrixCell, choose: (agent: UsageAgent, day: string) => void): HTMLButtonElement {
  const button = el('button', 'usage-cell')
  button.type = 'button'
  button.dataset.day = cell.day
  button.dataset.shade = cell.shade === null ? 'none' : String(cell.shade)
  if (cell.shade !== null && cell.shade > 0) button.style.setProperty('--mix', `${SHADE_MIX[cell.shade as 1 | 2 | 3 | 4]}%`)
  button.setAttribute('aria-label', cell.label)
  button.setAttribute('aria-pressed', String(cell.selected))
  button.title = cell.label
  button.addEventListener('click', () => choose(agent, cell.day))
  return button
}

// Where some requests ran: a labelled share bar (the places side by side, a gap between them), a line each with its count and share,
// and the one line that says why some cannot be told, when it applies.
function sourcesBlock(sources: SourcesView, title?: string): HTMLElement {
  const block = el('div', 'usage-sources')
  if (title !== undefined) block.append(el('div', 'usage-sources-title', title))
  const bar = el('div', 'usage-sources-bar')
  for (const part of sources.segments) {
    const segment = el('span', 'usage-sources-segment')
    segment.dataset.split = part.split
    segment.dataset.hatched = String(part.hatched)
    segment.style.width = `${part.percent}%`
    segment.style.setProperty('--agent', part.colour)
    segment.title = part.title
    bar.append(segment)
  }
  block.append(bar)
  const list = el('ul', 'usage-sources-list')
  for (const part of sources.segments) {
    const item = el('li', 'usage-sources-item')
    item.dataset.split = part.split
    const swatch = el('span', 'usage-swatch')
    swatch.dataset.hatched = String(part.hatched)
    swatch.style.setProperty('--agent', part.colour)
    item.append(swatch, el('span', 'usage-sources-label', part.label), el('span', 'usage-sources-requests', part.requests), el('span', 'usage-sources-share', part.share))
    if (part.credits !== null) item.append(el('span', 'usage-sources-credits', part.credits))
    list.append(item)
  }
  block.append(list)
  if (sources.note !== null) block.append(el('p', 'usage-sources-note', sources.note))
  return block
}

function agentSection(view: AgentView, choose: (agent: UsageAgent, day: string) => void): HTMLElement {
  const section = el('section', 'usage-agent')
  section.dataset.agent = view.agent
  section.append(el('h3', 'usage-agent-title', view.title))
  const matrix = el('div', 'usage-matrix')
  for (const week of view.weeks) {
    const column = el('div', 'usage-week')
    for (const cell of week) column.append(cell === null ? el('span', 'usage-cell usage-cell-blank') : cellButton(view.agent, cell, choose))
    matrix.append(column)
  }
  section.append(matrix)
  const totals = el('dl', 'usage-totals')
  for (const total of view.totals) {
    const item = el('div', 'usage-total')
    item.append(el('dt', 'usage-total-label', total.label), el('dd', 'usage-total-value', total.value))
    if (total.credits !== null) item.append(el('dd', 'usage-total-credits', total.credits))
    totals.append(item)
  }
  section.append(totals)
  if (view.sources !== null) section.append(sourcesBlock(view.sources, view.sourcesTitle))
  if (view.detail !== null) {
    const detail = el('div', 'usage-detail')
    detail.append(el('div', 'usage-detail-title', view.detail.title), el('div', 'usage-detail-requests', view.detail.requests))
    if (view.detail.credits !== null) detail.append(el('div', 'usage-detail-credits', view.detail.credits))
    if (view.detail.helper !== null) {
      const helper = el('div', 'usage-detail-helper')
      helper.append(el('span', 'usage-token-label', 'of which helper agents'), el('span', 'usage-token-value', view.detail.helper))
      detail.append(helper)
    }
    if (view.detail.sources !== null) detail.append(sourcesBlock(view.detail.sources))
    if (view.detail.tokens.length > 0) {
      const tokens = el('dl', 'usage-detail-tokens')
      for (const token of view.detail.tokens) {
        const item = el('div', 'usage-token')
        item.append(el('dt', 'usage-token-label', token.label), el('dd', 'usage-token-value', token.value))
        tokens.append(item)
      }
      detail.append(tokens)
    }
    if (view.detail.models.length > 0) {
      const models = el('ul', 'usage-detail-models')
      for (const model of view.detail.models) {
        const item = el('li', 'usage-detail-model')
        item.append(el('span', 'usage-model-name', model.model), el('span', 'usage-model-requests', model.requests), el('span', 'usage-model-tokens', model.tokens))
        models.append(item)
      }
      detail.append(models)
    }
    section.append(detail)
  }
  return section
}

function heading(title: string, side: string): HTMLElement {
  const head = el('div', 'usage-chart-head')
  head.append(el('h3', 'usage-chart-title', title), el('span', 'usage-chart-side', side))
  return head
}

function barsSection(bars: BarsView): HTMLElement {
  const section = el('section', 'usage-chart usage-bars')
  section.append(heading(bars.title, bars.total))
  const plot = el('div', 'usage-plot')
  const axis = el('div', 'usage-axis')
  for (const tick of bars.ticks) axis.append(el('span', 'usage-tick', tick.label))
  const columns = el('div', 'usage-columns')
  columns.dataset.unit = bars.unit
  for (const bar of bars.bars) {
    const column = el('div', 'usage-bar')
    column.title = bar.label
    column.setAttribute('aria-label', bar.label)
    column.dataset.day = bar.day
    for (const part of bar.segments) {
      const segment = el('span', 'usage-segment')
      segment.dataset.agent = part.agent
      segment.dataset.hatched = String(part.hatched)
      segment.style.height = `${part.percent}%`
      segment.style.setProperty('--agent', agentColour(part.agent))
      column.append(segment)
    }
    columns.append(column)
  }
  plot.append(axis, columns)
  section.append(plot)
  const legend = el('div', 'usage-legend')
  for (const item of bars.legend) {
    const entry = el('span', 'usage-legend-item')
    const swatch = el('span', 'usage-swatch')
    swatch.dataset.hatched = String(item.hatched)
    swatch.style.setProperty('--agent', agentColour(item.agent))
    entry.append(swatch, item.title)
    legend.append(entry)
  }
  section.append(legend)
  return section
}

function hoursSection(hours: HoursView): HTMLElement {
  const section = el('section', 'usage-chart usage-hours')
  section.append(heading(hours.title, hours.subtitle))
  const grid = el('div', 'usage-hours-grid')
  for (const row of hours.rows) {
    grid.append(el('span', 'usage-hours-weekday', row.weekday))
    for (const cell of row.cells) {
      const node = el('span', 'usage-hour')
      node.dataset.shade = String(cell.shade)
      if (cell.shade > 0) node.style.setProperty('--mix', `${SHADE_MIX[cell.shade as 1 | 2 | 3 | 4]}%`)
      node.title = cell.label
      node.setAttribute('aria-label', cell.label)
      grid.append(node)
    }
  }
  section.append(grid)
  const axis = el('div', 'usage-hours-axis')
  for (const label of hours.axis) axis.append(el('span', 'usage-hours-hour', label))
  section.append(axis)
  return section
}

function rowNode(row: BreakdownRow): HTMLElement {
  const node = el('li', 'usage-row')
  node.title = row.detail
  const name = el('span', 'usage-row-name')
  name.append(el('span', 'usage-row-label', row.name))
  if (row.space) name.append(el('span', 'usage-row-space', 'Space'))
  const track = el('span', 'usage-row-track')
  for (const part of row.segments) {
    const fill = el('span', 'usage-row-fill')
    fill.dataset.agent = part.agent
    fill.style.width = `${part.percent}%`
    fill.style.setProperty('--agent', agentColour(part.agent))
    track.append(fill)
  }
  node.append(name, track, el('span', 'usage-row-requests', row.requests), el('span', 'usage-row-share', row.share))
  if (row.other) node.dataset.other = 'true'
  return node
}

const BREAKDOWNS: Array<{ id: 'repositories' | 'models'; label: string }> = [
  { id: 'repositories', label: 'By repository' },
  { id: 'models', label: 'By model' },
]

function breakdownSection(breakdowns: BreakdownsView, which: 'repositories' | 'models', choose: (which: 'repositories' | 'models') => void): HTMLElement {
  const section = el('section', 'usage-chart usage-breakdown')
  const head = heading(breakdowns.title, '')
  const tabs = el('div', 'usage-tabs')
  for (const tab of BREAKDOWNS) {
    const button = el('button', 'usage-tab', tab.label)
    button.type = 'button'
    button.dataset.tab = tab.id
    button.setAttribute('aria-pressed', String(tab.id === which))
    button.addEventListener('click', () => choose(tab.id))
    tabs.append(button)
  }
  head.querySelector('.usage-chart-side')?.replaceWith(tabs)
  section.append(head)
  const list = el('ul', 'usage-rows')
  for (const row of breakdowns[which]) list.append(rowNode(row))
  section.append(list)
  return section
}

function buildingParagraph(text: string): HTMLElement {
  const note = el('p', 'usage-building', text)
  note.setAttribute('role', 'status')
  return note
}

function chartsSection(charts: ChartsView, which: 'repositories' | 'models', range: (id: RangeId) => void, choose: (which: 'repositories' | 'models') => void): HTMLElement {
  const root = el('div', 'usage-charts')
  const control = el('div', 'usage-range')
  control.setAttribute('role', 'group')
  control.setAttribute('aria-label', 'Range')
  for (const option of charts.range) {
    const button = el('button', 'usage-tab', option.label)
    button.type = 'button'
    button.dataset.range = option.id
    button.setAttribute('aria-pressed', String(option.selected))
    button.addEventListener('click', () => range(option.id))
    control.append(button)
  }
  root.append(control, barsSection(charts.bars), hoursSection(charts.hours), breakdownSection(charts.breakdowns, which, choose))
  return root
}

function mountUsage(body: HTMLElement, context: DockContext, deps: UsageDeps): DockInstance & { reload(): void } {
  const root = el('div', 'usage')
  body.append(root)
  let summary: UsageSummary | null = null
  let selected: { agent: UsageAgent; day: string } | null = null
  // The range the human chose, and the range the numbers on screen are for: they differ until the core has answered.
  let range: RangeId = readUsageRange(deps.store)
  let drawn: RangeId = range
  let breakdown = readUsageBreakdown(deps.store)
  let asked = 0
  let destroyed = false

  const expanded = (): boolean => context.expanded?.() ?? false

  function draw(): void {
    if (summary === null) return
    const view = usageView(summary, { expanded: expanded(), selected, range: drawn })
    const scrollLeft = new Map<string, number>()
    for (const matrix of root.querySelectorAll<HTMLElement>('.usage-agent')) scrollLeft.set(matrix.dataset.agent ?? '', matrix.querySelector<HTMLElement>('.usage-matrix')?.scrollLeft ?? 0)
    root.replaceChildren()
    if (view.building !== null) root.append(buildingParagraph(view.building))
    if (view.empty !== null) root.append(el('p', 'usage-empty', view.empty))
    for (const agent of view.agents) root.append(agentSection(agent, choose))
    if (view.charts !== null) {
      root.append(
        chartsSection(
          view.charts,
          breakdown,
          (id) => {
            range = id
            writeUsageRange(deps.store, id)
            void reload()
          },
          (which) => {
            breakdown = which
            writeUsageBreakdown(deps.store, which)
            draw()
          },
        ),
      )
    }
    const foot = el('footer', 'usage-foot')
    foot.append(el('span', 'usage-scope', view.scope))
    root.append(foot)
    context.status(view.building ?? '')
    context.meta('')
    // The newest weeks are at the right: a matrix wider than the dock shows them first, and keeps its place when redrawn.
    for (const section of root.querySelectorAll<HTMLElement>('.usage-agent')) {
      const matrix = section.querySelector<HTMLElement>('.usage-matrix')
      if (matrix) matrix.scrollLeft = scrollLeft.get(section.dataset.agent ?? '') ?? matrix.scrollWidth
    }
  }

  function choose(agent: UsageAgent, day: string): void {
    selected = selected?.agent === agent && selected.day === day ? null : { agent, day }
    draw()
  }

  async function reload(): Promise<void> {
    if (!deps.connected()) return
    const mine = ++asked
    try {
      const shown = effectiveRange(range, expanded())
      const next = await deps.summary(detailDays(dayKey(deps.now()), expanded(), shown), rangeDays(shown))
      if (destroyed || mine !== asked) return
      summary = next
      drawn = shown
      context.error(null)
      draw()
    } catch (error) {
      if (destroyed || mine !== asked) return
      context.error(`Could not read the usage: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const stopExpanded = context.onExpanded?.(() => void reload())
  void reload()

  return {
    focus: () => root.focus(),
    reload: () => void reload(),
    destroy: () => {
      destroyed = true
      stopExpanded?.()
      root.remove()
    },
  }
}
