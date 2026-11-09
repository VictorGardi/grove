// The Go to overlay: a filter box over the tabs of every space, grouped by space. Up and Down move the highlight, Enter goes to
// that tab, Esc and a click on the backdrop close it. The rules for what is listed are in goto-model.ts.
import type { AgentKind } from '../core/status/adapter.ts'
import type { AgentStateName } from '../protocol/messages.ts'
import { hideContextTip } from './context-badge.ts'
import { goToView, type GoToGroup, type GoToInput, type GoToRow, type GoToView } from './goto-model.ts'

export interface GoToElements {
  modal: HTMLElement
  input: HTMLInputElement
  list: HTMLElement
}

export interface GoToDeps {
  // The spaces and tabs as they are now; the overlay adds the query and the collapsed state.
  source(): Pick<GoToInput, 'spaces' | 'tabs' | 'recent' | 'activeSpaceId' | 'activeTabId'>
  tile(group: GoToGroup): HTMLElement
  indicator(state: AgentStateName, agent: AgentKind | null): HTMLElement
  // The row's agent icon with its context ring, as the agents list in the sidebar draws it.
  agentMark(row: GoToRow & { agent: AgentKind; agentName: string }): HTMLElement
  go(tabId: string): void
  // Called after the overlay closes, to give the focus back.
  closed(): void
}

export interface GoTo {
  open(): void
  close(): void
  isOpen(): boolean
}

function element(tag: string, className: string, text = ''): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  node.textContent = text
  return node
}

export function createGoTo(elements: GoToElements, deps: GoToDeps): GoTo {
  const { modal, input, list } = elements
  let expandQuiet = false
  let highlight: string | null = null
  let view: GoToView = { groups: [], highlight: null, quiet: null }

  const rows = (): GoToRow[] => view.groups.flatMap((group) => group.rows)

  function render(): void {
    view = goToView({ ...deps.source(), query: input.value, expandQuiet })
    if (!rows().some((row) => row.tabId === highlight)) highlight = view.highlight
    const nodes: HTMLElement[] = view.groups.map((group) => {
      const section = element('section', 'goto-group')
      const head = element('header', 'goto-space')
      head.append(deps.tile(group), element('span', 'goto-space-name', group.name))
      if (group.worktreeOf) head.append(element('span', 'goto-space-note', `worktree of ${group.worktreeOf}`))
      section.append(head, ...group.rows.map(rowNode))
      return section
    })
    if (view.quiet) {
      const { count, expanded } = view.quiet
      const toggle = element('button', 'goto-quiet', `earlier: ${count} quiet ${count === 1 ? 'space' : 'spaces'} ${expanded ? '▴' : '▾'}`) as HTMLButtonElement
      toggle.type = 'button'
      toggle.setAttribute('aria-expanded', String(expanded))
      toggle.addEventListener('click', () => {
        expandQuiet = !expandQuiet
        render()
        input.focus()
      })
      nodes.push(toggle)
    }
    // A ring replaced under the pointer never sends its leave, so its tooltip is put away first.
    hideContextTip()
    list.replaceChildren(...nodes)
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }

  function rowNode(row: GoToRow): HTMLElement {
    const node = element('button', 'goto-row') as HTMLButtonElement
    node.type = 'button'
    node.tabIndex = -1
    node.setAttribute('role', 'option')
    node.setAttribute('aria-selected', String(row.tabId === highlight))
    node.append(deps.indicator(row.state, row.agent), element('span', 'goto-row-name', row.name))
    if (row.stateLabel) node.append(element('span', `goto-row-state goto-state-${row.state}`, row.stateLabel))
    if (row.agent && row.agentName) node.append(deps.agentMark({ ...row, agent: row.agent, agentName: row.agentName }))
    node.addEventListener('click', () => choose(row.tabId))
    return node
  }

  function move(step: number): void {
    const all = rows()
    if (all.length === 0) return
    const at = all.findIndex((row) => row.tabId === highlight)
    highlight = all[(at + step + all.length) % all.length].tabId
    render()
  }

  function choose(tabId: string): void {
    close()
    deps.go(tabId)
  }

  function close(): void {
    if (modal.hidden) return
    modal.hidden = true
    input.value = ''
    hideContextTip()
    deps.closed()
  }

  // A new query starts on its top match, not on the row that was highlighted before.
  input.addEventListener('input', () => {
    highlight = null
    render()
  })
  modal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      move(event.key === 'ArrowDown' ? 1 : -1)
    } else if (event.key === 'Enter' && !event.isComposing && highlight !== null) {
      event.preventDefault()
      choose(highlight)
    }
  })
  modal.addEventListener('pointerdown', (event) => {
    if (event.target === modal) close()
    // A click elsewhere in the dialog must not take the focus off the filter box, or Esc and the arrows stop working.
    else if (event.target !== input) event.preventDefault()
  })

  return {
    open() {
      expandQuiet = false
      highlight = null
      input.value = ''
      modal.hidden = false
      render()
      input.focus()
    },
    close,
    isOpen: () => !modal.hidden,
  }
}
