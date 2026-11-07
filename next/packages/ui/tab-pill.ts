// The tab's button in the strip: the agent mark, the name, the state indicator and a close button. The DOM is made once and
// updated in place. Every click re-paints the tab, and a rebuilt label would lose the second click of a double-click.
import type { AgentStateName } from '../protocol/messages.ts'
import type { AgentKind } from '../core/status/adapter.ts'
import { iconSvg } from './icons.ts'
import { indicatorClass, indicatorLabel } from './indicator.ts'

export interface TabPillHandlers {
  onActivate(): void
  onRename(): void
  onClose(): void
}

export interface TabPillView {
  name: string
  title: string
  state: AgentStateName
  agent?: AgentKind
  live?: boolean
  // Whether the tab is one of the grid's panes: it shows a grid glyph.
  inGrid?: boolean
}

export interface TabPill {
  root: HTMLDivElement
  update(view: TabPillView): void
}

export function createTabPill(mark: HTMLElement, handlers: TabPillHandlers): TabPill {
  const root = document.createElement('div')
  root.className = 'tab'
  root.setAttribute('role', 'tab')

  const main = document.createElement('button')
  main.type = 'button'
  main.className = 'tab-main'
  const label = document.createElement('span')
  label.className = 'tab-label'
  const indicator = document.createElement('span')
  let shownState: string | null = null
  let shownIndicatorLabel: string | null = null
  const grid = document.createElement('span')
  grid.className = 'tab-grid'
  grid.title = 'In the grid'
  grid.innerHTML = iconSvg('grid')
  grid.hidden = true
  main.append(mark, label, grid, indicator)
  main.addEventListener('click', handlers.onActivate)

  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'tab-close'
  close.title = 'Close tab'
  close.setAttribute('aria-label', 'Close tab')
  close.innerHTML = iconSvg('x')
  close.addEventListener('click', (event) => {
    event.stopPropagation()
    handlers.onClose()
  })
  // The close button is not part of the rename target: a double-click on it does nothing.
  close.addEventListener('dblclick', (event) => event.stopPropagation())

  // The whole pill is the target, the padding around the name included.
  root.addEventListener('dblclick', handlers.onRename)
  root.append(main, close)

  return {
    root,
    update({ name, title, state, agent, live = false, inGrid = false }) {
      grid.hidden = !inGrid
      root.classList.toggle('in-grid', inGrid)
      if (main.title !== title) main.title = title
      if (label.textContent !== name) label.textContent = name
      // Written only on a change: rewriting the class of a spinning indicator can restart its animation.
      if (shownState !== state) {
        shownState = state
        indicator.className = indicatorClass(state)
      }
      const labelText = indicatorLabel(state, agent, live)
      if (shownIndicatorLabel !== labelText) {
        shownIndicatorLabel = labelText
        indicator.title = labelText
        indicator.setAttribute('aria-label', labelText)
      }
    },
  }
}
