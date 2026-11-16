// The usage panel: each agent's requests per day as a matrix (darker = more), the Today / 7 days / 30 days totals and, for a clicked day,
// its detail. The numbers are the core's usage history, read from the agents' files (src/protocol UsageSummary); the panel asks for them when it opens, when the core says
// they changed, when the connection comes back, and when the dock is expanded or not (a longer matrix needs more days). What is drawn is
// decided by usage-model.ts.
import { dayKey, shiftDay, weekdayOf } from '../protocol/days.ts'
import type { UsageAgent, UsageSummary } from '../protocol/messages.ts'
import type { DockContext, DockInstance, DockPanel } from './dock.ts'
import type { KeyValueStore } from './persisted-pref.ts'
import {
  SHADE_MIX,
  agentColour,
  group,
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
import { buildingProgress, dayTip, splitCount, totalDelta, type TotalLabel } from './usage-hover.ts'
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

// `stop` is the one cell of a matrix the Tab key lands on; the arrow keys move between the others (see mountUsage).
function cellButton(agent: UsageAgent, cell: MatrixCell, stop: boolean, week: number, choose: (agent: UsageAgent, day: string) => void): HTMLButtonElement {
  const button = el('button', 'usage-cell')
  button.type = 'button'
  button.tabIndex = stop ? 0 : -1
  button.dataset.day = cell.day
  button.dataset.weekday = String(weekdayOf(cell.day))
  button.style.setProperty('--week', String(week))
  button.dataset.shade = cell.shade === null ? 'none' : String(cell.shade)
  if (cell.shade !== null && cell.shade > 0) button.style.setProperty('--mix', `${SHADE_MIX[cell.shade as 1 | 2 | 3 | 4]}%`)
  button.setAttribute('aria-label', cell.label)
  button.setAttribute('aria-pressed', String(cell.selected))
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
  const cells = view.weeks.flat().filter((cell): cell is MatrixCell => cell !== null)
  const stop = (cells.find((cell) => cell.selected) ?? cells[cells.length - 1])?.day
  view.weeks.forEach((week, w) => {
    const column = el('div', 'usage-week')
    for (const cell of week) column.append(cell === null ? el('span', 'usage-cell usage-cell-blank') : cellButton(view.agent, cell, cell.day === stop, w, choose))
    matrix.append(column)
  })
  section.append(matrix)
  const totals = el('dl', 'usage-totals')
  for (const total of view.totals) {
    const item = el('div', 'usage-total')
    item.tabIndex = 0
    item.dataset.agent = view.agent
    item.dataset.total = total.label
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
  bars.bars.forEach((bar, index) => {
    const column = el('div', 'usage-bar')
    column.setAttribute('aria-label', bar.label)
    column.dataset.day = bar.day
    column.dataset.unit = bars.unit
    if (bars.unit === 'day') column.dataset.weekday = String(weekdayOf(bar.day))
    column.style.setProperty('--bar', String(index))
    for (const part of bar.segments) {
      const segment = el('span', 'usage-segment')
      segment.dataset.agent = part.agent
      segment.dataset.hatched = String(part.hatched)
      segment.style.height = `${part.percent}%`
      segment.style.setProperty('--agent', agentColour(part.agent))
      column.append(segment)
    }
    columns.append(column)
  })
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
  hours.rows.forEach((row, rowIndex) => {
    const label = el('span', 'usage-hours-weekday', row.weekday)
    label.dataset.weekday = String(rowIndex)
    grid.append(label)
    for (const cell of row.cells) {
      const node = el('span', 'usage-hour')
      node.dataset.shade = String(cell.shade)
      if (cell.shade > 0) node.style.setProperty('--mix', `${SHADE_MIX[cell.shade as 1 | 2 | 3 | 4]}%`)
      node.dataset.weekday = String(rowIndex)
      node.setAttribute('aria-label', cell.label)
      grid.append(node)
    }
  })
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

// The note and, when the agents can say how far they have got, a thin bar under it. The bar starts where the last one stopped and is then set to
// where it is now, so the one width transition carries it across redraws.
function buildingParagraph(text: string, from: number | null, to: number | null): HTMLElement {
  const note = el('p', 'usage-building', text)
  note.setAttribute('role', 'status')
  if (to !== null) {
    const track = el('span', 'usage-building-track')
    track.setAttribute('aria-hidden', 'true')
    const fill = el('span', 'usage-building-fill')
    fill.style.width = `${(from ?? to) * 100}%`
    if (from !== null && from !== to) requestAnimationFrame(() => (fill.style.width = `${to * 100}%`))
    track.append(fill)
    note.append(track)
  }
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

const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

// Counts the numbers of some elements up from zero to what they say, once, in about 180 ms. The text is the real one until the first frame.
function tick(targets: HTMLElement[]): void {
  const parts = targets.flatMap((node) => {
    const split = splitCount(node.textContent ?? '')
    return split !== null && split.count > 1 ? [{ node, ...split, text: node.textContent ?? '' }] : []
  })
  if (parts.length === 0 || reducedMotion()) return
  const start = performance.now()
  const frame = (now: number): void => {
    const t = Math.min(1, (now - start) / TICK_MS)
    const eased = 1 - (1 - t) ** 3
    for (const part of parts) part.node.textContent = t >= 1 ? part.text : `${group(Math.round(part.count * eased))}${part.rest}`
    if (t < 1) requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}
const TICK_MS = 180

// The tooltip: one element for the whole panel, filled when the pointer or the keyboard lands on something new, never on every move.
function tooltip(): { node: HTMLElement; show(anchor: HTMLElement, lines: Array<{ text: string; quiet?: boolean; strong?: boolean }>): void; hide(): void } {
  const node = el('div', 'usage-tip')
  node.setAttribute('aria-hidden', 'true')
  return {
    node,
    show: (anchor, lines) => {
      node.replaceChildren(...lines.map((line) => el('div', line.strong ? 'usage-tip-title' : line.quiet ? 'usage-tip-quiet' : 'usage-tip-line', line.text)))
      const a = anchor.getBoundingClientRect()
      const w = node.offsetWidth
      const h = node.offsetHeight
      const left = Math.min(Math.max(4, a.left + a.width / 2 - w / 2), Math.max(4, window.innerWidth - w - 4))
      const top = a.top - h - 6 >= 4 ? a.top - h - 6 : a.bottom + 6
      node.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
      node.dataset.show = 'true'
    },
    hide: () => delete node.dataset.show,
  }
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
  // The first drawing reveals itself (cells fade in, bars grow, numbers count up); the later ones, on every change, only replace what is there.
  let entered = false
  let progress: number | null = null
  const tip = tooltip()
  body.append(tip.node)
  // What the pointer or the keyboard is on, by selector, so a redraw can put the highlight back on the new elements.
  let active: { selector: string; agent: string | null } | null = null
  let linked: HTMLElement[] = []

  const expanded = (): boolean => context.expanded?.() ?? false

  function draw(): void {
    if (summary === null) return
    const view = usageView(summary, { expanded: expanded(), selected, range: drawn })
    const scrollLeft = new Map<string, number>()
    for (const matrix of root.querySelectorAll<HTMLElement>('.usage-agent')) scrollLeft.set(matrix.dataset.agent ?? '', matrix.querySelector<HTMLElement>('.usage-matrix')?.scrollLeft ?? 0)
    const focusedCell = root.contains(document.activeElement) ? document.activeElement?.closest<HTMLElement>('.usage-cell[data-day]') : null
    const focusedKey = focusedCell === null || focusedCell === undefined ? null : { agent: focusedCell.closest<HTMLElement>('.usage-agent')?.dataset.agent ?? '', day: focusedCell.dataset.day ?? '' }
    root.replaceChildren()
    linked = []
    if (view.building !== null) root.append(buildingParagraph(view.building, progress, buildingProgress(summary)))
    progress = buildingProgress(summary)
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
    if (!entered) {
      entered = true
      if (!reducedMotion()) {
        root.dataset.enter = 'true'
        tick([...root.querySelectorAll<HTMLElement>('.usage-total-value')])
      }
    } else delete root.dataset.enter
    // The pointer or the focus was on something that has just been replaced: find it again.
    if (focusedKey !== null) {
      const again = [...root.querySelectorAll<HTMLElement>('.usage-agent')].find((n) => n.dataset.agent === focusedKey.agent)?.querySelector<HTMLElement>(`.usage-cell[data-day="${focusedKey.day}"]`)
      again?.focus({ preventScroll: true })
    }
    const kept = active === null ? null : root.querySelector<HTMLElement>(active.selector)
    if (kept === null) leave()
    else enter(kept)
  }

  // Which elements a hover or focus points at, and what the tooltip says.
  function dayTarget(node: HTMLElement): string | null {
    return node.matches('.usage-cell[data-day]') || node.matches('.usage-bar[data-unit="day"]') ? (node.dataset.day ?? null) : null
  }

  function selectorOf(node: HTMLElement): string | null {
    const agent = node.closest<HTMLElement>('.usage-agent')?.dataset.agent
    if (node.matches('.usage-cell[data-day]')) return agent === undefined ? null : `.usage-agent[data-agent="${agent}"] .usage-cell[data-day="${node.dataset.day}"]`
    if (node.matches('.usage-bar[data-day]')) return `.usage-bar[data-day="${node.dataset.day}"]`
    if (node.matches('.usage-hour')) return `.usage-hours-grid .usage-hour[data-weekday="${node.dataset.weekday}"][aria-label="${node.getAttribute('aria-label')}"]`
    if (node.matches('.usage-total')) return `.usage-agent[data-agent="${node.dataset.agent}"] .usage-total[data-total="${node.dataset.total}"]`
    return null
  }

  function link(day: string | null, weekday: string | null, own: HTMLElement): void {
    for (const node of linked) node.classList.remove('is-linked')
    const found: HTMLElement[] = [own]
    if (day !== null) {
      found.push(...root.querySelectorAll<HTMLElement>(`.usage-cell[data-day="${day}"], .usage-bar[data-unit="day"][data-day="${day}"]`))
      if (weekday !== null) found.push(...root.querySelectorAll<HTMLElement>(`.usage-hour[data-weekday="${weekday}"], .usage-hours-weekday[data-weekday="${weekday}"]`))
    } else if (weekday !== null) {
      found.push(...root.querySelectorAll<HTMLElement>(`.usage-cell[data-weekday="${weekday}"], .usage-bar[data-weekday="${weekday}"], .usage-hours-weekday[data-weekday="${weekday}"]`))
    }
    linked = found
    for (const node of linked) node.classList.add('is-linked')
    root.dataset.linking = 'true'
  }

  function enter(node: HTMLElement): void {
    const selector = selectorOf(node)
    if (selector === null || summary === null) return leave()
    active = { selector, agent: node.closest<HTMLElement>('.usage-agent')?.dataset.agent ?? null }
    const day = dayTarget(node)
    if (day !== null) {
      link(day, node.dataset.weekday ?? null, node)
      const info = dayTip(summary, day)
      tip.show(node, [
        { text: info.title, strong: true },
        ...info.lines.flatMap((line) => [{ text: `${line.title}  ${line.requests}${line.top === null ? '' : `  ${line.top}`}` }, ...(line.credits === null ? [] : [{ text: line.credits, quiet: true }])]),
        ...(info.note === null ? [] : [{ text: info.note, quiet: true }]),
      ])
    } else if (node.matches('.usage-hour')) {
      link(null, node.dataset.weekday ?? null, node)
      tip.show(node, [{ text: node.getAttribute('aria-label') ?? '' }])
    } else if (node.matches('.usage-bar')) {
      link(null, null, node)
      tip.show(node, [{ text: node.getAttribute('aria-label') ?? '' }])
    } else if (node.matches('.usage-total')) {
      const delta = totalDelta(summary, node.dataset.agent as UsageAgent, node.dataset.total as TotalLabel)
      for (const old of linked) old.classList.remove('is-linked')
      linked = []
      delete root.dataset.linking
      if (delta === null) tip.hide()
      else tip.show(node, [{ text: delta }])
    }
  }

  function leave(): void {
    active = null
    for (const node of linked) node.classList.remove('is-linked')
    linked = []
    delete root.dataset.linking
    tip.hide()
  }

  const pointable = '.usage-cell[data-day], .usage-bar[data-day], .usage-hour, .usage-total'
  const onOver = (event: Event): void => {
    const node = (event.target as HTMLElement).closest<HTMLElement>(pointable)
    if (node === null) return active === null ? undefined : leave()
    if (selectorOf(node) !== active?.selector) enter(node)
  }
  const onFocusIn = (event: Event): void => {
    const node = (event.target as HTMLElement).closest<HTMLElement>(pointable)
    let visible = true
    try {
      visible = node?.matches(':focus-visible') ?? false
    } catch {}
    if (node !== null && visible) enter(node)
  }
  const onKey = (event: KeyboardEvent): void => {
    const step = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[event.key]
    const from = (event.target as HTMLElement).closest<HTMLElement>('.usage-cell[data-day]')
    if (step === undefined || from === null || event.altKey || event.ctrlKey || event.metaKey) return
    event.preventDefault()
    const next = from.closest('.usage-agent')?.querySelector<HTMLElement>(`.usage-cell[data-day="${shiftDay(from.dataset.day ?? '', step)}"]`)
    if (!next) return
    from.tabIndex = -1
    next.tabIndex = 0
    next.focus()
  }
  root.addEventListener('pointerover', onOver)
  root.addEventListener('pointerleave', leave)
  root.addEventListener('focusin', onFocusIn)
  root.addEventListener('focusout', (event) => {
    if (!root.contains((event as FocusEvent).relatedTarget as Node | null)) leave()
  })
  root.addEventListener('keydown', onKey)
  root.addEventListener('scroll', leave, { passive: true })

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
      tip.node.remove()
      root.remove()
    },
  }
}
