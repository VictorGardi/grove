// The diff panel: the changes in the active tab's folder, read only. It names a tab and never a path, and the core finds the folder. It
// asks again when it opens, when the active tab changes, when the mode or base changes, when that tab's agent stops working, and on the
// refresh button; the core does not push, and nothing watches files. The mode and base are kept by the core per folder.
import type { DiffBases, DiffFile, DiffHunk, DiffMode, DiffPrefs, DiffResult } from '../protocol/messages.ts'
import type { DockContext, DockInstance, DockPanel } from './dock.ts'
import { baseChoices, branchNote, emptyMessage, MODE_LABEL, MODES, STATUS_LETTER, treeRows, type BaseChoice, type TreeRow } from './diff-model.ts'

export interface DiffDeps {
  // The active tab's id; null with no tab open.
  tab(): string | null
  // False while the window has no connection to the core.
  connected(): boolean
  get(tabId: string, mode: DiffMode, base: string | null, showUntracked: boolean): Promise<DiffResult>
  bases(tabId: string): Promise<DiffBases>
  prefs(tabId: string): Promise<DiffPrefs>
  setPrefs(tabId: string, prefs: { mode?: DiffMode; base?: string | null }): Promise<DiffPrefs>
}

// What the window tells the open panel.
export interface DiffController {
  panel: DockPanel
  // The active tab may have changed: look at its folder.
  retarget(): void
  // The tab's agent changed state: look again if it just stopped working in the active tab.
  agentChanged(tabId: string, settledNow: boolean): void
  // The connection to the core opened or closed.
  connection(open: boolean): void
}

export function createDiffPanel(deps: DiffDeps): DiffController {
  let open: { retarget(): void; refresh(): void; connection(): void; tab(): string | null } | null = null
  // Whether untracked files show: kept across the panel closing, not across a restart.
  const untracked = { show: true }
  return {
    panel: {
      id: 'diff',
      title: 'Changes',
      mount(body, context) {
        const view = mountDiff(body, context, deps, untracked)
        open = view
        return {
          focus: view.focus,
          destroy() {
            if (open === view) open = null
            view.destroy()
          },
        }
      },
    },
    retarget: () => open?.retarget(),
    agentChanged: (tabId, settledNow) => {
      if (settledNow && open?.tab() === tabId) open.refresh()
    },
    connection: () => open?.connection(),
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

function mountDiff(
  body: HTMLElement,
  context: DockContext,
  deps: DiffDeps,
  untracked: { show: boolean },
): DockInstance & { retarget(): void; refresh(): void; connection(): void; tab(): string | null } {
  const root = el('div', 'diff')
  const bar = el('div', 'diff-bar')
  const refreshButton = el('button', 'icon-button diff-refresh', '↻')
  refreshButton.type = 'button'
  refreshButton.title = 'Look at the folder again'
  refreshButton.setAttribute('aria-label', 'Refresh the changes')
  const untrackedButton = el('button', 'diff-toggle', 'Untracked')
  untrackedButton.type = 'button'
  untrackedButton.title = 'Show untracked files'
  const baseButton = el('button', 'diff-base')
  baseButton.type = 'button'
  baseButton.setAttribute('aria-haspopup', 'listbox')
  baseButton.hidden = true
  bar.append(refreshButton, untrackedButton, baseButton)
  const tabsEl = el('div', 'diff-modes')
  tabsEl.setAttribute('role', 'tablist')
  const filterInput = el('input', 'diff-filter')
  filterInput.type = 'search'
  filterInput.placeholder = 'Filter files…'
  filterInput.setAttribute('aria-label', 'Filter files')
  const message = el('div', 'diff-message')
  const noteEl = el('div', 'diff-note')
  noteEl.hidden = true
  const treeEl = el('div', 'diff-tree')
  treeEl.setAttribute('role', 'tree')
  treeEl.tabIndex = 0
  const fileEl = el('div', 'diff-file')
  const picker = el('div', 'diff-picker')
  picker.hidden = true
  root.append(bar, tabsEl, filterInput, noteEl, message, treeEl, fileEl, picker)
  body.append(root)

  let tabId: string | null = null
  let prefs: DiffPrefs | null = null
  let result: DiffResult | null = null
  let selected: string | null = null // a row's path: a file's or a folder's
  let shownFile: string | null = null // the file whose diff is drawn
  const collapsed = new Set<string>()
  let filter = ''
  let rows: TreeRow[] = []
  let sequence = 0
  let destroyed = false
  let refs: DiffBases | null = null
  let choices: BaseChoice[] = []
  let choice = 0

  const mode = (): DiffMode => prefs?.mode ?? 'branch'

  function say(text: string | null, action?: { label: string; run(): void }): void {
    message.replaceChildren()
    message.hidden = text === null
    if (text === null) return
    message.append(document.createTextNode(text))
    if (action) {
      const link = el('button', 'diff-link', action.label)
      link.type = 'button'
      link.addEventListener('click', action.run)
      message.append(document.createTextNode(' '), link)
    }
  }

  // Which of the parts shows: the files and the diff, or one message instead of them.
  function layout(files: boolean): void {
    treeEl.hidden = !files
    fileEl.hidden = !files
    filterInput.disabled = !files
  }

  function paintModes(): void {
    tabsEl.replaceChildren(
      ...MODES.map((m) => {
        const tab = el('button', 'diff-mode')
        tab.type = 'button'
        tab.setAttribute('role', 'tab')
        tab.setAttribute('aria-selected', String(m === mode()))
        tab.append(MODE_LABEL[m])
        if (result?.state === 'ok') tab.append(' ', el('span', 'diff-count', String(result.counts[m])))
        tab.addEventListener('click', () => void pickMode(m))
        return tab
      }),
    )
  }

  function paintBase(): void {
    const inBranch = mode() === 'branch' && result?.state === 'ok'
    baseButton.hidden = !inBranch
    if (!inBranch) return
    const target = result?.compared.base ?? result?.compared.defaultBase
    baseButton.textContent = target ? `Branch · vs ${target} ▾` : 'Branch · pick a base ▾'
    baseButton.title = 'Choose the branch to compare against'
  }

  function paintUntracked(): void {
    untrackedButton.setAttribute('aria-pressed', String(untracked.show))
    untrackedButton.hidden = mode() === 'last-commit'
  }

  function showFileCount(): void {
    context.meta(result?.state === 'ok' ? String(result.counts[mode()]) : '')
  }

  function paintTree(): void {
    const files = result?.files ?? []
    rows = treeRows(files, filter, collapsed)
    if (!rows.some((row) => row.path === selected)) selected = rows.find((row) => row.kind === 'file')?.path ?? rows[0]?.path ?? null
    treeEl.replaceChildren(
      ...rows.map((row) => {
        const item = el('div', `diff-row ${row.kind === 'dir' ? 'diff-dir' : 'diff-item'}`)
        item.setAttribute('role', 'treeitem')
        item.setAttribute('aria-selected', String(row.path === selected))
        item.classList.toggle('selected', row.path === selected)
        item.style.setProperty('--depth', String(row.depth))
        item.dataset.path = row.path
        if (row.kind === 'dir') {
          item.setAttribute('aria-expanded', String(!row.collapsed))
          item.append(el('span', 'diff-caret', row.collapsed ? '▸' : '▾'), el('span', 'diff-name', row.name))
          if (row.collapsed) item.append(el('span', 'diff-sub', `· ${row.files} ${row.files === 1 ? 'file' : 'files'}`))
        } else {
          const file = row.file
          const letter = el('span', `diff-status diff-${file.status}`, STATUS_LETTER[file.status])
          letter.title = file.status
          const name = el('span', 'diff-name')
          name.title = file.path
          name.append(el('span', 'diff-dirname', row.dir), el('span', 'diff-basename', row.name))
          item.append(letter, name)
          if (!file.binary && !file.truncated) item.append(el('span', 'diff-add-n', `+${file.additions}`), el('span', 'diff-del-n', `−${file.deletions}`))
        }
        item.addEventListener('click', () => select(row.path, true))
        return item
      }),
    )
    if (rows.length === 0 && files.length > 0) say('No file matches the filter.')
    else if (result?.state === 'ok' && files.length > 0) say(null)
    paintFile()
  }

  function fileLine(kind: string, oldN: number | null, newN: number | null, text: string): HTMLElement {
    const line = el('div', `diff-line diff-line-${kind}`)
    line.append(el('span', 'diff-ln', oldN === null ? '' : String(oldN)), el('span', 'diff-ln', newN === null ? '' : String(newN)))
    line.append(el('span', 'diff-sign', kind === 'add' ? '+' : kind === 'del' ? '−' : ' '), el('span', 'diff-text', text))
    return line
  }

  function paintHunk(hunk: DiffHunk): HTMLElement {
    const box = el('div', 'diff-hunk')
    box.append(el('div', 'diff-hunk-head', hunk.header))
    for (const line of hunk.lines) box.append(fileLine(line.kind, line.old, line.new, line.text))
    return box
  }

  function paintFile(): void {
    const row = rows.find((r) => r.kind === 'file' && r.path === selected)
    if (row?.kind === 'file') shownFile = row.path
    else if (!rows.some((r) => r.kind === 'file' && r.path === shownFile)) shownFile = null
    const file: DiffFile | undefined = result?.files.find((f) => f.path === shownFile)
    if (!file) {
      fileEl.replaceChildren()
      return
    }
    const head = el('div', 'diff-file-head')
    const path = el('span', 'diff-file-path', file.path)
    path.title = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path
    head.append(path)
    const content = el('div', 'diff-file-body')
    if (file.binary || file.truncated || file.hunks.length === 0) {
      content.append(el('p', 'diff-cannot', 'Cannot preview this file (binary, too large, or unreadable)'))
    } else {
      content.append(...file.hunks.map(paintHunk))
    }
    fileEl.replaceChildren(head, content)
  }

  function select(path: string, byClick: boolean): void {
    const row = rows.find((r) => r.path === path)
    if (!row) return
    if (row.kind === 'dir' && byClick) {
      if (collapsed.has(row.path)) collapsed.delete(row.path)
      else collapsed.add(row.path)
    }
    selected = path
    paintTree()
    treeEl.querySelector('.selected')?.scrollIntoView?.({ block: 'nearest' })
    if (byClick) treeEl.focus()
  }

  function paintAll(): void {
    paintModes()
    paintBase()
    paintUntracked()
    showFileCount()
    const note = branchNote(result?.state === 'ok' ? result.compared : null)
    noteEl.hidden = note === null
    noteEl.textContent = note ?? ''
    if (!result || result.state !== 'ok') return
    if (result.files.length === 0) {
      layout(false)
      const empty = emptyMessage(result.compared, mode())
      say(empty.text, { label: empty.switchTo.label, run: () => void pickMode(empty.switchTo.mode) })
      return
    }
    layout(true)
    say(null)
    paintTree()
  }

  // The whole panel as one state with a message: not connected, no tab, not in git, an error. Nothing of an earlier diff stays in view.
  function blank(text: string, status = ''): void {
    result = null
    rows = []
    treeEl.replaceChildren()
    fileEl.replaceChildren()
    layout(false)
    say(text)
    paintModes()
    paintBase()
    paintUntracked()
    showFileCount()
    context.status(status)
  }

  async function load(): Promise<void> {
    const mine = ++sequence
    const tab = deps.tab()
    if (tab !== tabId) {
      tabId = tab
      prefs = null
      refs = null
      selected = null
      shownFile = null
      collapsed.clear()
      closePicker()
    }
    context.error(null)
    if (!deps.connected()) return blank('Core not connected', 'Reconnecting…')
    if (tab === null) return blank('No tab open')
    context.status('Loading…')
    try {
      if (prefs === null) prefs = await deps.prefs(tab)
      if (mine !== sequence || destroyed) return
      const next = await deps.get(tab, prefs.mode, prefs.base, untracked.show)
      if (mine !== sequence || destroyed) return
      if (next.state === 'not-git') return blank('This folder is not in a git repository.')
      if (next.state === 'error') return blank(`Could not read the changes: ${next.error ?? 'git failed'}`)
      result = next
      context.status('')
      paintAll()
    } catch (failure) {
      if (mine !== sequence || destroyed) return
      blank(deps.connected() ? `Could not read the changes: ${failure instanceof Error ? failure.message : String(failure)}` : 'Core not connected')
    }
  }

  async function pickMode(next: DiffMode): Promise<void> {
    if (!tabId || next === mode()) return
    const tab = tabId
    try {
      prefs = await deps.setPrefs(tab, { mode: next })
    } catch (failure) {
      return context.error(`Could not save the mode: ${failure instanceof Error ? failure.message : String(failure)}`)
    }
    if (tab === tabId) void load()
  }

  async function pickBase(ref: string | null): Promise<void> {
    closePicker()
    if (!tabId) return
    const tab = tabId
    try {
      prefs = await deps.setPrefs(tab, { base: ref })
      refs = null // the recents moved
    } catch (failure) {
      return context.error(`Could not save the base: ${failure instanceof Error ? failure.message : String(failure)}`)
    }
    if (tab === tabId) void load()
  }

  // The base picker: a search box over the default branch, the recents and every other branch.
  const search = el('input', 'diff-filter diff-picker-search')
  search.type = 'search'
  search.placeholder = 'Search branches…'
  search.setAttribute('aria-label', 'Search branches')
  const list = el('div', 'diff-picker-list')
  list.setAttribute('role', 'listbox')
  picker.append(search, list)

  function paintPicker(): void {
    choices = refs ? baseChoices(refs, prefs?.recents ?? [], search.value) : []
    choice = Math.min(choice, Math.max(0, choices.length - 1))
    if (choices.length === 0) {
      list.replaceChildren(el('div', 'diff-picker-empty', refs ? 'No branch matches.' : 'Loading…'))
      return
    }
    let last: BaseChoice['kind'] | null = null
    const items: HTMLElement[] = []
    choices.forEach((c, index) => {
      if (c.kind === 'recent' && last !== 'recent') items.push(el('div', 'diff-picker-label', 'Recent'))
      last = c.kind
      const option = el('div', 'diff-picker-option')
      option.setAttribute('role', 'option')
      option.setAttribute('aria-selected', String(index === choice))
      option.classList.toggle('selected', index === choice)
      option.append(el('span', 'diff-name', c.name))
      if (c.kind === 'default') option.append(el('span', 'diff-tag', 'default'))
      option.addEventListener('click', () => void pickBase(c.ref))
      items.push(option)
    })
    list.replaceChildren(...items)
    list.querySelector('.selected')?.scrollIntoView?.({ block: 'nearest' })
  }

  async function openPicker(): Promise<void> {
    if (!tabId) return
    const tab = tabId
    picker.hidden = false
    baseButton.setAttribute('aria-expanded', 'true')
    search.value = ''
    choice = 0
    paintPicker()
    search.focus()
    if (refs === null) {
      try {
        const loaded = await deps.bases(tab)
        if (tab !== tabId || picker.hidden) return
        refs = loaded
        if (prefs) prefs = { ...prefs, recents: loaded.recents }
      } catch (failure) {
        context.error(`Could not list the branches: ${failure instanceof Error ? failure.message : String(failure)}`)
        return closePicker()
      }
    }
    paintPicker()
  }

  function closePicker(focus = false): void {
    if (picker.hidden) return
    picker.hidden = true
    baseButton.setAttribute('aria-expanded', 'false')
    if (focus) baseButton.focus()
  }

  baseButton.addEventListener('click', () => (picker.hidden ? void openPicker() : closePicker(true)))
  search.addEventListener('input', () => {
    choice = 0
    paintPicker()
  })
  picker.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closePicker(true)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      choice = Math.max(0, Math.min(choices.length - 1, choice + (event.key === 'ArrowDown' ? 1 : -1)))
      paintPicker()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const picked = choices[choice]
      if (picked) void pickBase(picked.ref)
    }
  })
  // A click outside the picker and its button puts it away.
  const onOutside = (event: MouseEvent): void => {
    if (!picker.hidden && event.target instanceof Node && !picker.contains(event.target) && !baseButton.contains(event.target)) closePicker()
  }
  document.addEventListener('mousedown', onOutside)

  refreshButton.addEventListener('click', () => void load())
  untrackedButton.addEventListener('click', () => {
    untracked.show = !untracked.show
    void load()
  })
  filterInput.addEventListener('input', () => {
    filter = filterInput.value
    if (result?.state === 'ok' && result.files.length > 0) paintTree()
  })
  filterInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && filterInput.value !== '') {
      event.preventDefault()
      filterInput.value = ''
      filter = ''
      paintTree()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      move(event.key === 'ArrowDown' ? 1 : -1)
    }
  })

  function move(step: number): void {
    if (rows.length === 0) return
    const index = rows.findIndex((row) => row.path === selected)
    const next = rows[Math.max(0, Math.min(rows.length - 1, (index === -1 ? 0 : index) + step))]
    select(next.path, false)
  }

  // Arrow keys move the selection; right and left open and shut a folder, enter and space flip it.
  treeEl.addEventListener('keydown', (event) => {
    const row = rows.find((r) => r.path === selected)
    const flip = (shut: boolean): void => {
      if (row?.kind !== 'dir' || row.collapsed === shut) return
      if (shut) collapsed.add(row.path)
      else collapsed.delete(row.path)
      paintTree()
    }
    switch (event.key) {
      case 'ArrowDown':
        return event.preventDefault(), move(1)
      case 'ArrowUp':
        return event.preventDefault(), move(-1)
      case 'ArrowRight':
        return event.preventDefault(), flip(false)
      case 'ArrowLeft':
        return event.preventDefault(), flip(true)
      case 'Enter':
      case ' ':
        if (row?.kind === 'dir') return event.preventDefault(), flip(!row.collapsed)
    }
  })

  blank('Loading…')
  void load()

  return {
    focus: () => (filterInput.disabled ? refreshButton : treeEl).focus(),
    destroy() {
      destroyed = true
      sequence++
      document.removeEventListener('mousedown', onOutside)
      root.remove()
    },
    retarget: () => {
      if (deps.tab() !== tabId) void load()
    },
    refresh: () => void load(),
    connection: () => void load(),
    tab: () => tabId,
  }
}
