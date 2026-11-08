// The context circle: a pie on an agent's mark, filled by how much of the window is used. Hovering it shows the reading's
// headline and detail in one tooltip shared by every circle.
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

function badgeFor(view: ContextView): HTMLElement {
  const badge = document.createElement('span')
  badge.className = ['context-badge', view.full && 'full', view.last && 'last'].filter(Boolean).join(' ')
  const degrees = view.fraction * 360
  badge.style.background = `conic-gradient(var(--context-fill) 0deg ${degrees}deg, var(--context-track) ${degrees}deg 360deg)`
  badge.setAttribute('role', 'img')
  badge.setAttribute('aria-label', `${view.headline}. ${view.detail}`)
  badge.addEventListener('pointerenter', () => showTip(badge, view))
  badge.addEventListener('pointerleave', hideContextTip)
  return badge
}

// The agent's mark with its context circle on the corner, or the mark alone when there is no circle to draw. The wrapper
// is always there, so a row keeps its width whether or not a reading has arrived.
export function markWithContext(mark: HTMLElement, context: ContextUsage | undefined, kind: AgentKind | undefined): HTMLElement {
  const stack = document.createElement('span')
  stack.className = 'mark-stack'
  stack.append(mark)
  const view = kind === undefined ? null : contextView(context, kind)
  if (view) stack.append(badgeFor(view))
  return stack
}
