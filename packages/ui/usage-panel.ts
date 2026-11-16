// The usage panel: each agent's requests per day as a matrix (darker = more), the Today / 7 days / 30 days totals and, for a clicked day,
// its detail. The numbers are the core's usage history (src/protocol UsageSummary); the panel asks for them when it opens, when the core says
// they changed, when the connection comes back, and when the dock is expanded or not (a longer matrix needs more days). What is drawn is
// decided by usage-model.ts.
import { dayKey } from '../protocol/days.ts'
import type { UsageAgent, UsageSummary } from '../protocol/messages.ts'
import type { DockContext, DockInstance, DockPanel } from './dock.ts'
import { SHADE_MIX, matrixSpan, usageView, type AgentView, type MatrixCell } from './usage-model.ts'

export interface UsageDeps {
  summary(days: number): Promise<UsageSummary>
  connected(): boolean
  // The window's clock, which says which day the matrix ends on.
  now(): number
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
  if (view.detail !== null) {
    const detail = el('div', 'usage-detail')
    detail.append(el('div', 'usage-detail-title', view.detail.title), el('div', 'usage-detail-requests', view.detail.requests))
    if (view.detail.credits !== null) detail.append(el('div', 'usage-detail-credits', view.detail.credits))
    if (view.detail.tokens.length > 0) {
      const tokens = el('dl', 'usage-detail-tokens')
      for (const token of view.detail.tokens) {
        const item = el('div', 'usage-token')
        item.append(el('dt', 'usage-token-label', token.label), el('dd', 'usage-token-value', token.value))
        tokens.append(item)
      }
      detail.append(tokens)
    }
    section.append(detail)
  }
  return section
}

function mountUsage(body: HTMLElement, context: DockContext, deps: UsageDeps): DockInstance & { reload(): void } {
  const root = el('div', 'usage')
  body.append(root)
  let summary: UsageSummary | null = null
  let selected: { agent: UsageAgent; day: string } | null = null
  let asked = 0
  let destroyed = false

  const expanded = (): boolean => context.expanded?.() ?? false

  function draw(): void {
    if (summary === null) return
    const view = usageView(summary, { expanded: expanded(), selected })
    const scrollLeft = new Map<string, number>()
    for (const matrix of root.querySelectorAll<HTMLElement>('.usage-agent')) scrollLeft.set(matrix.dataset.agent ?? '', matrix.querySelector<HTMLElement>('.usage-matrix')?.scrollLeft ?? 0)
    root.replaceChildren()
    if (view.empty !== null) root.append(el('p', 'usage-empty', view.empty))
    for (const agent of view.agents) root.append(agentSection(agent, choose))
    const foot = el('footer', 'usage-foot')
    foot.append(el('span', 'usage-from', view.historyFrom), el('span', 'usage-scope', view.scope))
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
      const next = await deps.summary(matrixSpan(dayKey(deps.now()), expanded()))
      if (destroyed || mine !== asked) return
      summary = next
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
