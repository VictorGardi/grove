// The Go to overlay: a filter box over the tabs of every space, grouped by space and drawn as the sidebar's tree. Up and Down move the highlight, Enter goes to
// that tab (Cmd+Enter opens it in the grid), Esc and a click on the backdrop close it. The rules for what is listed are in goto-model.ts.
import type { AgentKind } from '../core/status/adapter.ts'
import type { AgentStateName } from '../protocol/messages.ts'
import { hideContextTip } from './context-badge.ts'
import { BUSY, quietLabel } from './quiet-spaces.ts'
import { goToView, marksOf, toggleMark, type GoToGroup, type GoToInput, type GoToRow, type GoToView } from './goto-model.ts'
import { iconSvg } from './icons.ts'
import { repoColor } from './sidebar-model.ts'

export interface GoToElements {
  modal: HTMLElement
  input: HTMLInputElement
  // The state filter buttons, each marked with `data-mark` ("!" or "~"), `data-state` and `data-label`; a click switches that
  // mark in the query, and the overlay draws the state's dot, the label and the count in it.
  chips: HTMLButtonElement[]
  // Inside the search field: how many results a query has.
  count: HTMLElement
  list: HTMLElement
}

export interface GoToDeps {
  // The spaces and tabs as they are now; the overlay adds the query and the collapsed state.
  source(): Pick<GoToInput, 'spaces' | 'tabs' | 'recent' | 'activeSpaceId' | 'activeTabId'>
  // The space's node, as the sidebar's row draws it.
  node(group: GoToGroup): HTMLElement
  indicator(state: AgentStateName, agent: AgentKind | null): HTMLElement
  // The small muted mark of what a tab is: its agent's glyph, or the terminal's `>_` for a plain shell.
  mark(agent: AgentKind | null): HTMLElement
  // A time as the sidebar shows it, from when the state began.
  age(since: number): string
  // `inGrid` is set when the human asked to open it in the grid (Cmd+Enter) instead of just going there.
  go(tabId: string, inGrid: boolean): void
  // Called after the overlay closes, to give the focus back.
  closed(): void
}

export interface GoTo {
  open(): void
  close(): void
  isOpen(): boolean
  // Draws the list again with what the source says now, when the overlay is open.
  refresh(): void
}

function element(tag: string, className: string, text = ''): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  node.textContent = text
  return node
}

// The mark on a pinned space's row. Go to only shows it: pinning is not done here.
function pinMark(): HTMLElement {
  const mark = element('span', 'goto-pin')
  mark.title = 'Pinned'
  mark.setAttribute('role', 'img')
  mark.setAttribute('aria-label', 'Pinned')
  mark.innerHTML = iconSvg('pin')
  return mark
}

// The name with the characters the query matched in a mark.
function highlighted(name: string, matched: number[]): HTMLElement {
  const label = element('span', 'goto-row-name')
  let run = ''
  let inMatch = false
  const flush = (): void => {
    if (run) label.append(inMatch ? element('mark', 'goto-match', run) : document.createTextNode(run))
    run = ''
  }
  ;[...name].forEach((char, at) => {
    if (matched.includes(at) !== inMatch) {
      flush()
      inMatch = !inMatch
    }
    run += char
  })
  flush()
  return label
}

// What a worktree result says of its state: "Finished 1h ago" or "Working 3m"; null when nothing is going on.
function statusText(row: GoToRow, age: (since: number) => string): string | null {
  if (!BUSY.includes(row.state) || !row.stateLabel) return null
  const label = row.stateLabel.charAt(0).toUpperCase() + row.stateLabel.slice(1)
  if (row.since === null) return label
  return row.state === 'working' ? `${label} ${age(row.since)}` : `${label} ${age(row.since)} ago`
}

export function createGoTo(elements: GoToElements, deps: GoToDeps): GoTo {
  const { modal, input, list, chips, count } = elements
  let expandQuiet = false
  let highlight: string | null = null
  let view: GoToView = { groups: [], results: null, rows: [], counts: { needsYou: 0, working: 0 }, highlight: null, quiet: null }

  function render(): void {
    view = goToView({ ...deps.source(), query: input.value, expandQuiet })
    const marks = marksOf(input.value)
    for (const chip of chips) {
      chip.setAttribute('aria-pressed', String(marks.has(chip.dataset.mark ?? '')))
      const state = chip.dataset.state === 'working' ? 'working' : 'needs-you'
      chip.replaceChildren(deps.indicator(state, null), element('span', 'goto-chip-label', chip.dataset.label ?? ''), element('span', 'goto-chip-count', String(state === 'working' ? view.counts.working : view.counts.needsYou)))
    }
    count.textContent = view.results ? `${view.rows.length} ${view.rows.length === 1 ? 'result' : 'results'}` : ''
    if (!view.rows.some((row) => row.key === highlight)) highlight = view.highlight
    const nodes = view.results ? resultNodes(view.results) : treeNodes()
    if (view.quiet) {
      const { count: quietCount, expanded } = view.quiet
      const toggle = element('button', 'goto-quiet', quietLabel(quietCount, expanded)) as HTMLButtonElement
      toggle.type = 'button'
      toggle.setAttribute('aria-expanded', String(expanded))
      toggle.addEventListener('click', () => {
        expandQuiet = !expandQuiet
        render()
        input.focus()
      })
      nodes.push(toggle)
    }
    list.replaceChildren(...nodes)
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }

  // The tree: a repo's spaces share one heading with the trunk and a branch to each space (see goToView). A space with one tab is
  // one row; a space with several is a muted header with its tabs on a second level of branches.
  function treeNodes(): HTMLElement[] {
    const nodes: HTMLElement[] = []
    let heading: HTMLElement | null = null
    let branches: HTMLElement | null = null
    for (const group of view.groups) {
      const space = spaceNode(group)
      if (group.repo === null) {
        heading = null
        nodes.push(space)
        continue
      }
      if (!heading || heading.dataset.repo !== group.repo) {
        heading = element('section', 'goto-heading')
        heading.dataset.repo = group.repo
        heading.dataset.repoColor = String(repoColor(group.repo))
        const name = element('h3', 'heading-name')
        name.append(element('span', 'heading-label', group.repo))
        branches = element('ul', 'spaces graph')
        heading.append(name, branches)
        nodes.push(heading)
      }
      const branch = document.createElement('li')
      branch.append(space)
      branches!.append(branch)
    }
    return nodes
  }

  function spaceNode(group: GoToGroup): HTMLElement {
    if (group.single && group.rows[0]) return tabRow(group.rows[0], deps.node(group), group.name, group.pinned)
    const section = element('section', `goto-group state-${group.empty ? 'none' : group.state}`)
    const head = element('header', 'goto-space')
    head.append(deps.node(group), element('span', 'goto-space-name', group.name), ...(group.pinned ? [pinMark()] : []), element('span', 'goto-space-note', group.tabCount === 0 ? 'No tabs open' : `${group.tabCount} tabs`))
    section.append(head)
    if (group.rows.length > 0) {
      const tabs = element('ul', 'spaces graph')
      for (const row of group.rows) {
        const branch = document.createElement('li')
        branch.append(tabRow(row, deps.indicator(row.state, row.agent), row.name))
        tabs.append(branch)
      }
      section.append(tabs)
    }
    return section
  }

  // A tab as one line: its node, name, what it is (agent or terminal) and, while something is going on, the time.
  function tabRow(row: GoToRow, node: HTMLElement, name: string, pinned = false): HTMLElement {
    const button = rowButton(row, `goto-row state-${row.state}`)
    button.append(node, element('span', 'goto-row-name', name), ...(pinned ? [pinMark()] : []), kindOf(row))
    if (BUSY.includes(row.state) && row.since !== null) button.append(element('span', 'goto-time', deps.age(row.since)))
    return button
  }

  function kindOf(row: GoToRow): HTMLElement {
    const kind = element('span', 'goto-kind')
    kind.title = row.agentName ?? 'Terminal'
    kind.append(deps.mark(row.agent))
    return kind
  }

  function rowButton(row: GoToRow, className: string): HTMLButtonElement {
    const button = element('button', className) as HTMLButtonElement
    button.type = 'button'
    button.tabIndex = -1
    button.setAttribute('role', 'option')
    button.setAttribute('aria-selected', String(row.key === highlight))
    button.dataset.key = row.key
    if (row.stateLabel) button.title = row.stateLabel
    button.addEventListener('click', () => choose(row.tabId))
    return button
  }

  // With a query: worktrees, then tabs, each hit with its match marked and a muted line under it.
  function resultNodes(results: NonNullable<GoToView['results']>): HTMLElement[] {
    const section = (title: string, rows: GoToRow[], worktree: boolean): HTMLElement[] => (rows.length === 0 ? [] : [element('h3', 'goto-section', title), ...rows.map((row) => hitRow(row, worktree))])
    const nodes = [...section('Worktrees', results.worktrees, true), ...section('Tabs', results.tabs, false)]
    return nodes.length > 0 ? nodes : [element('p', 'goto-none', 'No matches')]
  }

  function hitRow(row: GoToRow, worktree: boolean): HTMLElement {
    const button = rowButton(row, `goto-row goto-hit state-${row.state}`)
    const text = element('span', 'goto-hit-text')
    text.append(highlighted(row.name, row.matched), element('span', 'goto-hit-where', row.where))
    button.append(deps.indicator(row.state, worktree ? null : row.agent), text, ...(row.pinned ? [pinMark()] : []))
    const status = worktree ? statusText(row, deps.age) : null
    if (status) button.append(element('span', 'goto-status', status))
    else if (worktree && row.open) {
      const open = element('span', 'goto-open')
      const part = (n: number, mark: HTMLElement): void => {
        if (n === 0) return
        const item = element('span', 'goto-open-count', String(n))
        item.prepend(mark)
        open.append(item)
      }
      part(row.open.agents, deps.mark(row.open.agent ?? 'claude'))
      part(row.open.terminals, deps.mark(null))
      button.append(open)
    } else button.append(kindOf(row))
    return button
  }

  function move(step: number): void {
    const all = view.rows
    if (all.length === 0) return
    const at = all.findIndex((row) => row.key === highlight)
    highlight = all[(at + step + all.length) % all.length].key
    render()
  }

  function choose(tabId: string, inGrid = false): void {
    close()
    deps.go(tabId, inGrid)
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
  for (const chip of chips) {
    chip.addEventListener('click', () => {
      input.value = toggleMark(input.value, chip.dataset.mark ?? '')
      highlight = null
      render()
      input.focus()
    })
  }
  modal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      move(event.key === 'ArrowDown' ? 1 : -1)
    } else if (event.key === 'Enter' && !event.isComposing && highlight !== null) {
      event.preventDefault()
      const row = view.rows.find((item) => item.key === highlight)
      if (row) choose(row.tabId, event.metaKey || event.ctrlKey)
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
    refresh() {
      if (!modal.hidden) render()
    },
  }
}
