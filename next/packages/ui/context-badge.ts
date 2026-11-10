// The context ring: a thin ring around an agent's mark in the sidebar, the pane headers and Go to, filled by how much of the window is used, so agents
// can be compared at a glance. Hovering it shows the reading's headline and detail in one tooltip shared by every ring.
import type { AgentKind } from '../core/status/adapter.ts'
import type { ContextUsage } from '../protocol/messages.ts'
import { contextView, type ContextView } from './sidebar-model.ts'

let tip: HTMLElement | undefined
const TIP_GAP = 8

function tooltip(): HTMLElement {
  if (tip === undefined) {
    tip = document.createElement('div')
    tip.className = 'context-tip'
    tip.setAttribute('role', 'tooltip')
    tip.hidden = true
    document.body.append(tip)
  }
  return tip
}

function line(className: string, text: string): HTMLElement {
  const node = document.createElement('span')
  node.className = className
  node.textContent = text
  return node
}

function displayHeadline(headline: string): string {
  return headline.replace(/ · last request \d{2}:\d{2}$/, '')
}

function displayDetail(detail: string, kind: AgentKind): string {
  if (kind !== 'copilot') return detail
  return detail.replace('no prompt budget', '').replace('prompt budget', '').replace(/^ · /, '').replace(/\s+·/, ' ·').trim()
}

function showTip(badge: HTMLElement, view: ContextView, kind: AgentKind): void {
  const el = tooltip()
  el.replaceChildren(line('context-tip-head', displayHeadline(view.headline)), line('context-tip-detail', displayDetail(view.detail, kind)))
  el.hidden = false
  const rect = badge.getBoundingClientRect()
  const width = el.offsetWidth
  // Beside the badge when there is room; a badge near the window's right edge (the pane header's meter) puts it below, ending at the badge's edge.
  const beside = rect.right + TIP_GAP + width <= window.innerWidth - TIP_GAP
  el.classList.toggle('below', !beside)
  el.style.left = `${beside ? rect.right + TIP_GAP : Math.max(TIP_GAP, rect.right - width)}px`
  el.style.top = `${beside ? rect.top + rect.height / 2 : rect.bottom + TIP_GAP}px`
}

// Hides the tooltip. Called before the rows or header are rebuilt, since a badge removed under the pointer never sends its leave.
export function hideContextTip(): void {
  if (tip !== undefined) tip.hidden = true
}

function levelClasses(view: ContextView): string[] {
  return [view.full && 'full', view.warn && 'warn', view.last && 'last', view.fraction === null && 'unknown'].filter((name): name is string => Boolean(name))
}

function ringFor(view: ContextView, kind: AgentKind): HTMLElement {
  const ring = document.createElement('span')
  ring.className = ['context-ring', ...levelClasses(view)].join(' ')
  if (view.fraction === null) {
    ring.style.background = 'var(--context-track)'
  } else {
    const degrees = view.fraction * 360
    ring.style.background = `conic-gradient(var(--context-fill) 0deg ${degrees}deg, var(--context-track) ${degrees}deg 360deg)`
  }
  ring.setAttribute('role', 'img')
  const detail = displayDetail(view.detail, kind)
  ring.setAttribute('aria-label', detail ? `${displayHeadline(view.headline)}. ${detail}` : displayHeadline(view.headline))
  ring.addEventListener('pointerenter', () => showTip(ring, view, kind))
  ring.addEventListener('pointerleave', hideContextTip)
  return ring
}

// The agent's mark with its context ring around it, or the mark alone when there is no ring to draw. The wrapper
// is always there, so a row keeps its width whether or not a reading has arrived.
export function markWithContext(mark: HTMLElement, context: ContextUsage | undefined, kind: AgentKind | undefined): HTMLElement {
  const stack = document.createElement('span')
  stack.className = 'mark-stack'
  stack.append(mark)
  const view = kind === undefined ? null : contextView(context, kind)
  if (view && kind !== undefined) stack.append(ringFor(view, kind))
  return stack
}

// The pane header's reading: a bar and a percent that are always drawn, so an empty session shows 0% instead of nothing. A reading with
// no percentage (Copilot without a prompt budget) draws the empty bar and a dash; hovering gives the same tooltip as the rings.
export function contextMeter(context: ContextUsage | undefined, kind: AgentKind): HTMLElement {
  const view = contextView(context, kind)
  const meter = document.createElement('span')
  meter.className = ['context-meter', ...(view ? levelClasses(view) : [])].join(' ')
  const bar = document.createElement('span')
  bar.className = 'context-meter-bar'
  const fill = document.createElement('i')
  fill.style.width = `${(view?.fraction ?? 0) * 100}%`
  bar.append(fill)
  const label = view === null ? '0%' : view.fraction === null ? '–' : `${Math.round(view.fraction * 100)}%`
  meter.append(bar, line('context-meter-pct', label))
  if (view === null) {
    meter.setAttribute('role', 'img')
    meter.setAttribute('aria-label', 'Context window: nothing used yet')
    return meter
  }
  const detail = displayDetail(view.detail, kind)
  meter.setAttribute('role', 'img')
  meter.setAttribute('aria-label', detail ? `${displayHeadline(view.headline)}. ${detail}` : displayHeadline(view.headline))
  meter.addEventListener('pointerenter', () => showTip(meter, view, kind))
  meter.addEventListener('pointerleave', hideContextTip)
  return meter
}
