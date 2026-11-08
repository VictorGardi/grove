// The context ring: a thin ring around an agent's mark in the sidebar, filled by how much of the window is used, so agents
// can be compared at a glance. Hovering it shows the reading's headline and detail in one tooltip shared by every ring.
// The focused agent's full reading is the status bar's readout.
import type { AgentKind } from '../core/status/adapter.ts'
import type { ContextUsage } from '../protocol/messages.ts'
import { contextView, type ContextView } from './sidebar-model.ts'

let tip: HTMLElement | undefined

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

function showTip(badge: HTMLElement, view: ContextView): void {
  const el = tooltip()
  el.replaceChildren(line('context-tip-head', view.headline), line('context-tip-detail', view.detail))
  const rect = badge.getBoundingClientRect()
  el.style.left = `${rect.right + 8}px`
  el.style.top = `${rect.top + rect.height / 2}px`
  el.hidden = false
}

// Hides the tooltip. Called before the rows or header are rebuilt, since a badge removed under the pointer never sends its leave.
export function hideContextTip(): void {
  if (tip !== undefined) tip.hidden = true
}

function levelClasses(view: ContextView): string[] {
  return [view.full && 'full', view.warn && 'warn', view.last && 'last', view.fraction === null && 'unknown'].filter((name): name is string => Boolean(name))
}

function ringFor(view: ContextView): HTMLElement {
  const ring = document.createElement('span')
  ring.className = ['context-ring', ...levelClasses(view)].join(' ')
  if (view.fraction === null) {
    ring.style.background = 'var(--context-track)'
  } else {
    const degrees = view.fraction * 360
    ring.style.background = `conic-gradient(var(--context-fill) 0deg ${degrees}deg, var(--context-track) ${degrees}deg 360deg)`
  }
  ring.setAttribute('role', 'img')
  ring.setAttribute('aria-label', `${view.headline}. ${view.detail}`)
  ring.addEventListener('pointerenter', () => showTip(ring, view))
  ring.addEventListener('pointerleave', hideContextTip)
  return ring
}

// The status bar's readout for the focused agent: a bar, the headline and the detail. Null when there is nothing to show.
export function contextReadout(context: ContextUsage | undefined, kind: AgentKind | undefined): HTMLElement | null {
  const view = kind === undefined ? null : contextView(context, kind)
  if (!view) return null
  const readout = document.createElement('span')
  readout.className = ['context-readout', ...levelClasses(view)].join(' ')
  readout.setAttribute('aria-label', `Context: ${view.headline}. ${view.detail}`)
  const bar = document.createElement('span')
  bar.className = 'context-bar'
  if (view.fraction !== null) {
    const fill = document.createElement('i')
    fill.style.width = `${view.fraction * 100}%`
    bar.append(fill)
  }
  readout.append(bar, line('context-readout-head', view.headline), line('context-readout-detail', view.detail))
  return readout
}

// The agent's mark with its context ring around it, or the mark alone when there is no ring to draw. The wrapper
// is always there, so a row keeps its width whether or not a reading has arrived.
export function markWithContext(mark: HTMLElement, context: ContextUsage | undefined, kind: AgentKind | undefined): HTMLElement {
  const stack = document.createElement('span')
  stack.className = 'mark-stack'
  stack.append(mark)
  const view = kind === undefined ? null : contextView(context, kind)
  if (view) stack.append(ringFor(view))
  return stack
}
