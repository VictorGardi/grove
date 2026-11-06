// The diff panel: the changes in the active tab's folder, read only, as one scrolling column of file cards like a pull request's files tab. It names a tab and never a path, and the core finds the folder. It
// asks again when it opens, when the active tab changes, when the mode or base changes, when that tab's agent stops working, and on the
// refresh button; the core does not push, and nothing watches files. The mode and base are kept by the core per folder. Which cards are
// shut and which are marked viewed is the window's own memory, per folder, until the window closes. Review comments are the core's: the
// panel loads them with the diff and again after each change, draws the ones that still fit under their line, and lists the others as outdated.
import { bracketedPaste } from '../protocol/paste.ts'
import type { DiffBases, DiffComment, DiffFile, DiffHunk, DiffMode, DiffPrefs, DiffResult, MethodMap } from '../protocol/messages.ts'
import type { DockContext, DockInstance, DockPanel } from './dock.ts'
import {
  baseChoices,
  branchNote,
  changeBar,
  COMMENT_STATE_LABEL,
  commentContext,
  commentEnd,
  commentKey,
  commentRange,
  commentSide,
  commentWhere,
  emptyMessage,
  lineWords,
  matchFiles,
  MODE_LABEL,
  MODES,
  placeComments,
  NO_PENDING,
  relativeTime,
  sendState,
  splitPath,
  STATUS_CHIP,
  summarize,
  type BaseChoice,
  type CommentSide,
  type PlacedComments,
  type SendTarget,
  type WordSegment,
} from './diff-model.ts'
import { iconSvg } from './icons.ts'
import { reviewMessage } from './review-message.ts'

export interface DiffDeps {
  // The active tab's id; null with no tab open.
  tab(): string | null
  // False while the window has no connection to the core.
  connected(): boolean
  get(tabId: string, mode: DiffMode, base: string | null, showUntracked: boolean): Promise<DiffResult>
  bases(tabId: string): Promise<DiffBases>
  prefs(tabId: string): Promise<DiffPrefs>
  setPrefs(tabId: string, prefs: { mode?: DiffMode; base?: string | null }): Promise<DiffPrefs>
  // The review comments of the tab's folder.
  comments: {
    list(tabId: string): Promise<DiffComment[]>
    add(tabId: string, comment: Omit<MethodMap['diff.comments.add']['params'], 'tabId' | 'spaceId'>): Promise<DiffComment>
    update(tabId: string, id: string, change: { body?: string; state?: 'pending' | 'resolved' }): Promise<DiffComment>
    remove(tabId: string, id: string): Promise<void>
    // The pending ones among `ids` become sent; the ones that changed come back.
    markSent(tabId: string, ids: string[]): Promise<DiffComment[]>
  }
  // The active tab as a place to send to; null with no tab open.
  target(): SendTarget | null
  // Writes bytes to the tab's terminal, as typed.
  write(tabId: string, data: string): Promise<void>
  // Makes the tab the active one and puts the keyboard in its terminal. The dock stays open.
  focusTab(tabId: string): void
}

// What the window tells the open panel.
export interface DiffController {
  panel: DockPanel
  // The active tab may have changed: look at its folder.
  retarget(): void
  // The tab's agent changed state: look again if it just stopped working in the active tab, and re-read the Send button.
  agentChanged(tabId: string, settledNow: boolean): void
  // The connection to the core opened or closed.
  connection(open: boolean): void
}

// What the human has done to a folder's cards: the shut ones and the ones marked viewed, by file path.
interface Review {
  collapsed: Set<string>
  viewed: Set<string>
}

export function createDiffPanel(deps: DiffDeps): DiffController {
  let open: { retarget(): void; refresh(): void; connection(): void; paintSend(): void; tab(): string | null } | null = null
  // Whether untracked files show: kept across the panel closing, not across a restart.
  const untracked = { show: true }
  // The review state of each folder (by its root), kept while the window is open.
  const reviews = new Map<string, Review>()
  return {
    panel: {
      id: 'diff',
      title: 'Changes',
      mount(body, context) {
        const view = mountDiff(body, context, deps, untracked, reviews)
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
      open?.paintSend()
      if (settledNow && open?.tab() === tabId) open.refresh()
    },
    connection: () => open?.connection(),
  }
}

// Scrolls `container` just enough, and only vertically, to show `target`. Element.scrollIntoView also scrolls every ancestor, including the
// ones that clip with overflow: hidden: while the dock slides in, its content lies past the window edge, and the whole window shifted sideways.
function reveal(container: HTMLElement, target: Element | null): void {
  if (!target) return
  const box = container.getBoundingClientRect()
  const row = target.getBoundingClientRect()
  if (row.top < box.top) container.scrollTop -= box.top - row.top
  else if (row.bottom > box.bottom) container.scrollTop += row.bottom - box.bottom
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
  reviews: Map<string, Review>,
): DockInstance & { retarget(): void; refresh(): void; connection(): void; paintSend(): void; tab(): string | null } {
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
  const summaryEl = el('div', 'diff-summary')
  const filesText = el('span', 'diff-summary-files')
  const addsText = el('span', 'diff-add-n')
  const delsText = el('span', 'diff-del-n')
  const searchButton = el('button', 'icon-button diff-search')
  searchButton.type = 'button'
  searchButton.innerHTML = iconSvg('search')
  searchButton.title = 'Filter files (Cmd+F)'
  searchButton.setAttribute('aria-label', 'Filter files')
  searchButton.setAttribute('aria-expanded', 'false')
  const filterInput = el('input', 'diff-filter')
  filterInput.type = 'search'
  filterInput.placeholder = 'Search files…'
  filterInput.setAttribute('aria-label', 'Filter files')
  filterInput.hidden = true
  const filterBox = el('label', 'diff-filter-box')
  filterBox.hidden = true
  const filterIcon = el('span', 'diff-filter-icon')
  filterIcon.innerHTML = iconSvg('search')
  filterBox.append(filterIcon, filterInput)
  const progressText = el('span', 'diff-progress-text')
  const progressBar = el('span', 'diff-progress')
  progressBar.setAttribute('role', 'progressbar')
  progressBar.setAttribute('aria-label', 'Files viewed')
  const progressFill = el('span', 'diff-progress-fill')
  progressBar.append(progressFill)
  const sendBox = el('div', 'diff-send')
  const sendButton = el('button', 'icon-button diff-send-button')
  sendButton.type = 'button'
  const sendIcon = el('span', 'diff-send-icon')
  sendIcon.innerHTML = iconSvg('send')
  const sendCount = el('span', 'diff-send-count')
  sendButton.append(sendIcon, sendCount)
  const sendLine = el('span', 'diff-send-line')
  sendLine.setAttribute('role', 'status')
  sendBox.append(sendLine, sendButton)
  summaryEl.append(filesText, addsText, delsText, el('span', 'diff-summary-spacer'), filterBox, searchButton, progressText, progressBar, sendBox)
  const message = el('div', 'diff-message')
  const noteEl = el('div', 'diff-note')
  noteEl.hidden = true
  const cardsEl = el('div', 'diff-cards')
  cardsEl.tabIndex = 0
  const picker = el('div', 'diff-picker')
  picker.hidden = true
  root.append(bar, tabsEl, summaryEl, noteEl, message, cardsEl, picker)
  body.append(root)

  let tabId: string | null = null
  let prefs: DiffPrefs | null = null
  let result: DiffResult | null = null
  let selected: string | null = null // the path of the card the keys act on
  let review: Review = { collapsed: new Set(), viewed: new Set() }
  let filter = ''
  let shown: DiffFile[] = [] // the files that match the filter
  const cards = new Map<string, Card>() // the drawn cards of the current result, by path
  let sequence = 0
  let destroyed = false
  let refs: DiffBases | null = null
  let choices: BaseChoice[] = []
  let choice = 0
  // The notice after a send to a working agent, and whether a send is under way.
  let sendNote: string | null = null
  let sending = false

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

  // Which of the parts shows: the cards, or one message instead of them.
  function layout(files: boolean): void {
    cardsEl.hidden = !files
    summaryEl.hidden = !files
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

  interface Card {
    root: HTMLElement
    paint(): void
    // Draws the body again, with the comments as they are now.
    redraw(): void
  }
  let comments: DiffComment[] = []
  let placed: PlacedComments = placeComments([], [])
  // The line a new comment is being written on, with what the core keeps beside it; and the comment being edited. Drafts survive a redraw.
  let composing: { path: string; side: CommentSide; line: number; endLine?: number; anchor: string; before: string[]; after: string[]; draft: string } | null = null
  let editing: { id: string; draft: string } | null = null
  // Which outdated sections are open, by file path ('' is the panel's own section).
  const outdatedOpen = new Set<string>()
  // One shared plus button, moved onto the line under the pointer or the keyboard: a button per line made a long diff twice the nodes.
  // A row that takes comments: its hunk and place in it. The rows of each hunk are kept so a drag can mark the lines it covers.
  const commentable = new WeakMap<HTMLElement, { hunk: DiffHunk; index: number; line: number; open(first: number, last: number): void }>()
  const hunkRows = new WeakMap<DiffHunk, HTMLElement[]>()
  // Dragging from the plus down (or up) over lines of the same side comments on all of them.
  let drag: { hunk: DiffHunk; first: number; last: number; open(first: number, last: number): void } | null = null
  const markDrag = (): void => {
    if (!drag) return
    const lines = drag.hunk.lines
    const range = commentRange(lines, drag.first, drag.last)
    const picked = new Set(range?.indexes ?? [])
    hunkRows.get(drag.hunk)?.forEach((row, i) => row.classList.toggle('diff-line-picked', picked.has(i)))
  }
  const endDrag = (): void => {
    const done = drag
    if (!done) return
    drag = null
    hunkRows.get(done.hunk)?.forEach((row) => row.classList.remove('diff-line-picked'))
    done.open(done.first, done.last)
  }
  const plus = el('button', 'diff-add-comment', '+')
  plus.type = 'button'
  plus.addEventListener('mousedown', (event) => {
    const info = commentable.get(plus.parentElement as HTMLElement)
    if (!info || event.button !== 0) return
    event.preventDefault() // no text selection while dragging
    drag = { hunk: info.hunk, first: info.index, last: info.index, open: info.open }
    markDrag()
  })
  // A click with no pointer (the keyboard) comments on the one line; a mouse click is finished by the mouseup below.
  plus.addEventListener('click', (event) => {
    const info = commentable.get(plus.parentElement as HTMLElement)
    if (info && event.detail === 0) info.open(info.index, info.index)
  })
  document.addEventListener('mouseup', endDrag)
  const putPlus = (row: HTMLElement | null): void => {
    const target = row && commentable.get(row)
    if (!row || !target) return
    if (drag) {
      // Only lines of the dragged hunk, on the side the drag began on, extend it.
      if (target.hunk === drag.hunk && commentSide(drag.hunk.lines[target.index])?.side === commentSide(drag.hunk.lines[drag.first])?.side) {
        drag.last = target.index
        markDrag()
      }
      return
    }
    if (plus.parentElement === row) return
    row.prepend(plus)
    plus.setAttribute('aria-label', `Comment on line ${target.line}`)
  }
  cardsEl.addEventListener('focusin', (event) => putPlus(event.target instanceof Element ? event.target.closest<HTMLElement>('.diff-line') : null))
  cardsEl.addEventListener('mouseover', (event) => putPlus(event.target instanceof Element ? event.target.closest<HTMLElement>('.diff-line') : null))
  // A card's lines are drawn when it comes within a screen of the visible part, not at load: a review of many files opens at once and
  // scrolls light. Without IntersectionObserver every card is drawn at once.
  const wakers = new Map<Element, () => void>()
  const observer =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue
              observer?.unobserve(entry.target)
              wakers.get(entry.target)?.()
              wakers.delete(entry.target)
            }
          },
          { root: cardsEl, rootMargin: '100%' },
        )
  const goneEl = el('div', 'diff-gone')
  goneEl.hidden = true
  root.insertBefore(goneEl, cardsEl)

  const failureText = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure))
  const pendingCount = (): number => comments.filter((comment) => comment.state === 'pending').length

  // A text box with its buttons, for a new comment and for an edit. Ctrl or Cmd with Enter saves, Escape cancels; a refusal from the core
  // is shown under the box and the text stays.
  function commentForm(initial: string, label: string, onDraft: (text: string) => void, save: (body: string) => Promise<void>, cancel: () => void): HTMLElement {
    const form = el('div', 'diff-comment-form')
    const input = el('textarea', 'diff-comment-input')
    input.rows = 3
    input.value = initial
    input.placeholder = 'Leave a comment (Enter for a new line, Cmd+Enter to save)'
    input.setAttribute('aria-label', 'Comment')
    const error = el('p', 'diff-comment-error')
    error.hidden = true
    const actions = el('div', 'diff-comment-actions')
    const cancelButton = el('button', 'diff-comment-button diff-comment-cancel', 'Cancel')
    cancelButton.type = 'button'
    const saveButton = el('button', 'diff-comment-button diff-comment-submit', label)
    saveButton.type = 'button'
    actions.append(cancelButton, saveButton)
    form.append(input, error, actions)
    const sync = (): void => void (saveButton.disabled = input.value.trim() === '')
    const submit = async (): Promise<void> => {
      if (input.value.trim() === '' || saveButton.disabled) return
      saveButton.disabled = cancelButton.disabled = input.readOnly = true
      error.hidden = true
      try {
        await save(input.value.trim())
      } catch (failure) {
        error.textContent = failureText(failure)
        error.hidden = false
        input.readOnly = cancelButton.disabled = false
        sync()
      }
    }
    input.addEventListener('input', () => {
      onDraft(input.value)
      sync()
    })
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        void submit()
      } else if (event.key === 'Escape') {
        // Handled here: an unhandled Escape would also close the dock.
        event.preventDefault()
        event.stopPropagation()
        cancel()
      }
    })
    saveButton.addEventListener('click', () => void submit())
    cancelButton.addEventListener('click', cancel)
    sync()
    return form
  }

  // Asks the core again for the folder's comments and draws them. A failure keeps what is shown and says so.
  async function reloadComments(tab: string): Promise<void> {
    try {
      const saved = await deps.comments.list(tab)
      if (tab === tabId && !destroyed) setComments(saved)
    } catch (failure) {
      context.error(`Could not load the comments: ${failureText(failure)}`)
    }
  }

  // Runs one change of a comment, then reloads. The failure of the change itself goes to the caller; a failed reload is reported here.
  async function change(run: (tab: string) => Promise<unknown>): Promise<void> {
    const tab = tabId
    if (tab === null) throw new Error('No tab open')
    await run(tab)
    await reloadComments(tab)
  }

  // Changes from the thread's buttons have no form to show an error in: it goes to the panel's error line.
  function act(what: string, run: (tab: string) => Promise<unknown>): void {
    context.error(null)
    change(run).catch((failure) => context.error(`Could not ${what}: ${failureText(failure)}`))
  }

  function threadEl(comment: DiffComment): HTMLElement {
    const box = el('div', `diff-thread diff-thread-${comment.state}`)
    box.dataset.id = comment.id
    const head = el('div', 'diff-thread-head')
    const when = el('span', 'diff-thread-time', relativeTime(comment.createdAt, Date.now()))
    when.title = new Date(comment.createdAt).toLocaleString()
    head.append(el('b', 'diff-thread-author', 'You'), when, el('span', 'diff-thread-spacer'), el('span', `diff-comment-chip diff-comment-chip-${comment.state}`, COMMENT_STATE_LABEL[comment.state]))
    box.append(head)
    if (editing?.id === comment.id) {
      const form = commentForm(
        editing.draft,
        'Save',
        (text) => void (editing && (editing.draft = text)),
        (body) =>
          change((tab) => deps.comments.update(tab, comment.id, { body })).then(() => {
            editing = null
            redrawCommentCards([comment.path])
          }),
        () => {
          editing = null
          redrawCommentCards([comment.path])
        },
      )
      box.append(form)
      return box
    }
    const text = el('p', 'diff-thread-body')
    text.textContent = comment.body
    const actions = el('div', 'diff-thread-actions')
    const button = (name: string, label: string, run: () => void): void => {
      const b = el('button', `diff-comment-button diff-comment-${name}`, label)
      b.type = 'button'
      b.addEventListener('click', run)
      actions.append(b)
    }
    button('edit', 'Edit', () => {
      editing = { id: comment.id, draft: comment.body }
      redrawCommentCards([comment.path])
      cards.get(comment.path)?.root.querySelector<HTMLTextAreaElement>(`[data-id="${CSS.escape(comment.id)}"] .diff-comment-input`)?.focus({ preventScroll: true })
    })
    button('delete', 'Delete', () => act('delete the comment', (tab) => deps.comments.remove(tab, comment.id)))
    const resolved = comment.state === 'resolved'
    button('resolve', resolved ? 'Reopen' : 'Resolve', () => act(`${resolved ? 'reopen' : 'resolve'} the comment`, (tab) => deps.comments.update(tab, comment.id, { state: resolved ? 'pending' : 'resolved' })))
    box.append(text, actions)
    return box
  }

  // The comments that no longer fit their line: a collapsed section with where each was written and the text it was written on.
  function outdatedSection(list: DiffComment[], key: string): HTMLElement {
    const section = el('details', 'diff-outdated')
    section.open = outdatedOpen.has(key)
    section.append(el('summary', 'diff-outdated-summary', `Outdated (${list.length})`))
    for (const comment of list) {
      const item = el('div', 'diff-outdated-item')
      item.append(el('span', 'diff-outdated-where', commentWhere(comment)), el('code', 'diff-outdated-anchor', comment.anchor), threadEl(comment))
      section.append(item)
    }
    section.addEventListener('toggle', () => void (section.open ? outdatedOpen.add(key) : outdatedOpen.delete(key)))
    return section
  }

  // The outdated comments of files that are not in the diff at all, above the cards.
  function paintGone(): void {
    const present = new Set((result?.files ?? []).map((file) => file.path))
    const gone = [...placed.outdated].filter(([path]) => !present.has(path)).flatMap(([, list]) => list)
    goneEl.hidden = gone.length === 0 || result?.state !== 'ok'
    goneEl.replaceChildren(...(goneEl.hidden ? [] : [outdatedSection(gone, '')]))
  }

  // Redraws the cards of these paths, and the panel's own parts that show comments.
  function redrawCommentCards(paths: Iterable<string>): void {
    for (const path of paths) cards.get(path)?.redraw()
    paintGone()
    if (result?.state === 'ok' && result.files.length > 0) paintSummary()
  }

  function setComments(next: DiffComment[]): void {
    const touched = new Set([...comments, ...next].map((comment) => comment.path))
    if (composing) touched.add(composing.path)
    comments = next
    if (editing && !comments.some((comment) => comment.id === editing?.id)) editing = null
    placed = placeComments(result?.files ?? [], comments)
    redrawCommentCards(touched)
  }

  function wordText(text: string, words: WordSegment[] | null): HTMLElement {
    const cell = el('span', 'diff-text')
    if (!words) cell.textContent = text
    else cell.append(...words.map((w) => (w.changed ? el('span', 'diff-word', w.text) : document.createTextNode(w.text))))
    return cell
  }

  function fileLine(kind: string, oldN: number | null, newN: number | null, text: string, words: WordSegment[] | null): HTMLElement {
    const line = el('div', `diff-line diff-line-${kind}`)
    line.append(el('span', 'diff-ln', oldN === null ? '' : String(oldN)), el('span', 'diff-ln', newN === null ? '' : String(newN)))
    line.append(el('span', 'diff-sign', kind === 'add' ? '+' : kind === 'del' ? '−' : ' '), wordText(text, words))
    return line
  }

  function openComposer(path: string, hunk: DiffHunk, first: number, last: number): void {
    const at = commentRange(hunk.lines, first, last)
    if (!at) return
    const before = composing?.path
    if (composing?.path !== path || composing.side !== at.side || composing.line !== at.line || composing.endLine !== at.endLine) {
      const { indexes, ...place } = at
      composing = { path, ...place, ...commentContext(hunk.lines, indexes), draft: '' }
    }
    redrawCommentCards(before === undefined || before === path ? [path] : [before, path])
    cards.get(path)?.root.querySelector<HTMLTextAreaElement>('.diff-comment-composer .diff-comment-input')?.focus({ preventScroll: true })
  }

  function closeComposer(): void {
    const path = composing?.path
    composing = null
    if (path !== undefined) redrawCommentCards([path])
  }

  function composerEl(draft: NonNullable<typeof composing>): HTMLElement {
    const box = el('div', 'diff-thread diff-comment-composer')
    box.append(
      commentForm(
        draft.draft,
        'Add comment',
        (text) => void (composing && (composing.draft = text)),
        (body) =>
          change((tab) => deps.comments.add(tab, { path: draft.path, side: draft.side, line: draft.line, ...(draft.endLine === undefined ? {} : { endLine: draft.endLine }), anchor: draft.anchor, before: draft.before, after: draft.after, body })).then(() => {
            composing = null
            redrawCommentCards([draft.path])
          }),
        closeComposer,
      ),
    )
    return box
  }

  function paintHunk(file: DiffFile, hunk: DiffHunk): HTMLElement {
    const box = el('div', 'diff-hunk')
    box.append(el('div', 'diff-hunk-head', hunk.header))
    const words = lineWords(hunk.lines)
    const rows: HTMLElement[] = []
    hunkRows.set(hunk, rows)
    hunk.lines.forEach((line, index) => {
      const row = fileLine(line.kind, line.old, line.new, line.text, words[index])
      rows.push(row)
      box.append(row)
      const at = commentSide(line)
      if (!at) return
      commentable.set(row, { hunk, index, line: at.line, open: (first, last) => openComposer(file.path, hunk, first, last) })
      box.append(...(placed.inline.get(commentKey(file.path, at.side, at.line)) ?? []).map(threadEl))
      if (composing?.path === file.path && composing.side === at.side && commentEnd(composing) === at.line) box.append(composerEl(composing))
    })
    return box
  }

  function countsOf(file: DiffFile): HTMLElement[] {
    if (file.binary || file.truncated) return []
    const bar = el('span', 'diff-squares')
    bar.setAttribute('aria-hidden', 'true')
    bar.append(...changeBar(file.additions, file.deletions).map((kind) => el('i', `diff-square diff-square-${kind}`)))
    return [el('span', 'diff-add-n', `+${file.additions}`), el('span', 'diff-del-n', `−${file.deletions}`), bar]
  }

  // One file as a card: a head that stays at the top while its lines scroll by, and the hunks under it. The body is drawn when the card
  // first opens, so a long review does not pay for the files nobody has expanded.
  function buildCard(file: DiffFile): Card {
    const card = el('section', 'diff-card')
    card.dataset.path = file.path
    const head = el('div', 'diff-card-head')
    const chevron = el('button', 'icon-button diff-chevron')
    chevron.type = 'button'
    chevron.innerHTML = iconSvg('chevron')
    const { dir, name } = splitPath(file.path)
    const path = el('span', 'diff-path')
    path.title = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path
    path.append(el('span', 'diff-dirname', dir), el('span', 'diff-basename', name))
    head.append(chevron, path)
    const chip = STATUS_CHIP[file.status]
    if (chip) head.append(el('span', `diff-chip diff-chip-${file.status}`, chip))
    head.append(...countsOf(file))
    const commentBadge = el('span', 'diff-comment-count')
    head.append(commentBadge)
    const viewedLabel = el('label', 'diff-viewed')
    const viewedBox = el('input', 'diff-viewed-box')
    viewedBox.type = 'checkbox'
    viewedBox.setAttribute('aria-label', `Mark ${file.path} as viewed`)
    const tick = el('span', 'diff-viewed-tick')
    tick.innerHTML = iconSvg('check')
    viewedLabel.append(viewedBox, tick, document.createTextNode('Viewed'))
    head.append(viewedLabel)
    const content = el('div', 'diff-card-body')
    card.append(head, content)

    let near = observer === null
    let drawn = false
    const draw = (): void => {
      content.replaceChildren()
      const outdated = placed.outdated.get(file.path) ?? []
      if (outdated.length > 0) content.append(outdatedSection(outdated, file.path))
      if (file.binary || file.truncated || file.hunks.length === 0) content.append(el('p', 'diff-cannot', 'Cannot preview this file (binary, too large, or unreadable)'))
      else content.append(...file.hunks.map((hunk) => paintHunk(file, hunk)))
      drawn = true
    }
    // Stands in for the lines until the card is near, as tall as they will be, so the scrollbar and the jumps between files stay right.
    const holdPlace = (): void => {
      if (content.hasChildNodes()) return
      const stand = el('div', 'diff-card-pending')
      stand.style.setProperty('--lines', String(file.hunks.reduce((n, hunk) => n + hunk.lines.length + 1, 1)))
      content.append(stand)
    }
    if (observer) {
      wakers.set(card, () => {
        near = true
        if (!drawn && !review.collapsed.has(file.path)) draw()
      })
      observer.observe(card)
    }
    const paint = (): void => {
      const shut = review.collapsed.has(file.path)
      const done = review.viewed.has(file.path)
      card.classList.toggle('collapsed', shut)
      card.classList.toggle('viewed', done)
      card.classList.toggle('selected', file.path === selected)
      content.hidden = shut
      chevron.setAttribute('aria-expanded', String(!shut))
      chevron.setAttribute('aria-label', `${shut ? 'Expand' : 'Collapse'} ${file.path}`)
      viewedBox.checked = done
      const count = comments.filter((comment) => comment.path === file.path).length
      commentBadge.hidden = count === 0
      commentBadge.textContent = String(count)
      commentBadge.title = `${count} ${count === 1 ? 'comment' : 'comments'}`
      if (!shut && !drawn) {
        if (near) draw()
        else holdPlace()
      }
    }
    const redraw = (): void => {
      drawn = false
      content.replaceChildren()
      paint()
    }
    const toggleShut = (): void => {
      if (review.collapsed.has(file.path)) review.collapsed.delete(file.path)
      else review.collapsed.add(file.path)
      paint()
    }
    chevron.addEventListener('click', toggleShut)
    viewedBox.addEventListener('change', () => {
      // Marking a file viewed puts it away; unmarking opens it again.
      if (viewedBox.checked) {
        review.viewed.add(file.path)
        review.collapsed.add(file.path)
      } else {
        review.viewed.delete(file.path)
        review.collapsed.delete(file.path)
      }
      paint()
      paintProgress()
    })
    head.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('button, label')) return
      select(file.path, false)
    })
    paint()
    return { root: card, paint, redraw }
  }

  function paintProgress(): void {
    const all = result?.files ?? []
    const done = all.filter((file) => review.viewed.has(file.path)).length
    progressText.textContent = `${done} of ${all.length} viewed`
    progressFill.style.setProperty('--done', all.length === 0 ? '0' : String(done / all.length))
    progressBar.setAttribute('aria-valuemin', '0')
    progressBar.setAttribute('aria-valuemax', String(all.length))
    progressBar.setAttribute('aria-valuenow', String(done))
  }

  function paintSummary(): void {
    const total = summarize(result?.files ?? [])
    filesText.textContent = `${total.files} ${total.files === 1 ? 'file' : 'files'} changed`
    addsText.textContent = `+${total.additions}`
    delsText.textContent = `−${total.deletions}`
    paintSend()
  }

  // The Send button, in the filter bar: an icon with the pending count, drawn only while there is something to send (or to say about a send).
  // Beside it a short line gives the reason it is off, or the notice from the last send.
  function paintSend(): void {
    const pending = pendingCount()
    const state = sendState(pending, deps.target(), deps.connected())
    sendBox.hidden = pending === 0 && sendNote === null
    sendCount.textContent = pending > 0 ? String(pending) : ''
    sendButton.setAttribute('aria-label', state.label)
    sendButton.disabled = state.reason !== null || sending
    sendButton.title = state.reason ?? `${state.label}: paste the pending comments into the agent's input; you press Enter to submit them`
    // With nothing pending the notice from the last send is all there is to say.
    sendLine.textContent = pending === 0 ? (sendNote ?? '') : (state.reason ?? sendNote ?? '')
    sendLine.title = sendLine.textContent
  }

  // Pastes the pending comments into the active tab's agent, unsubmitted, then marks exactly those comments sent.
  async function send(): Promise<void> {
    const tab = tabId
    const target = deps.target()
    if (tab === null || sending || tab !== deps.tab()) return
    const batch = comments.filter((comment) => comment.state === 'pending')
    if (sendState(batch.length, target, deps.connected()).reason !== null) return
    const outdated = new Set([...placed.outdated.values()].flat().map((comment) => comment.id))
    context.error(null)
    sendNote = null
    sending = true
    paintSend()
    try {
      await deps.write(tab, bracketedPaste(reviewMessage(batch, (comment) => outdated.has(comment.id))))
    } catch (failure) {
      sending = false
      paintSend()
      return context.error(`Could not send the comments: ${failureText(failure)}`)
    }
    try {
      await deps.comments.markSent(tab, batch.map((comment) => comment.id))
    } catch (failure) {
      context.error(`The text was pasted, but the comments could not be marked sent: ${failureText(failure)}`)
    }
    await reloadComments(tab)
    sendNote = sendState(1, target, true).notice
    sending = false
    paintSend()
    if (!destroyed) deps.focusTab(tab)
  }

  // Draws the cards of the files that match the filter. The cards are kept between filters, so a filter does not lose what was opened.
  function paintCards(): void {
    const files = result?.files ?? []
    shown = matchFiles(files, filter)
    if (!shown.some((file) => file.path === selected)) selected = shown[0]?.path ?? null
    const top = cardsEl.scrollTop
    cardsEl.replaceChildren(
      ...shown.map((file) => {
        let card = cards.get(file.path)
        if (!card) cards.set(file.path, (card = buildCard(file)))
        card.paint()
        return card.root
      }),
    )
    cardsEl.scrollTop = top
    if (shown.length === 0 && files.length > 0) say('No file matches the filter.')
    else if (result?.state === 'ok' && files.length > 0) say(null)
  }

  // Makes a card the one the keys act on, and brings its top to the top of the column.
  function select(path: string, scroll: boolean): void {
    const previous = selected
    selected = path
    if (previous) cards.get(previous)?.paint()
    const card = cards.get(path)
    card?.paint()
    if (scroll && card) cardsEl.scrollTop += card.root.getBoundingClientRect().top - cardsEl.getBoundingClientRect().top
  }

  function move(step: number): void {
    if (shown.length === 0) return
    const index = shown.findIndex((file) => file.path === selected)
    select(shown[Math.max(0, Math.min(shown.length - 1, (index === -1 ? 0 : index) + step))].path, true)
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
    paintGone()
    if (result.files.length === 0) {
      layout(false)
      const empty = emptyMessage(result.compared, mode())
      say(empty.text, { label: empty.switchTo.label, run: () => void pickMode(empty.switchTo.mode) })
      return
    }
    layout(true)
    say(null)
    paintSummary()
    paintProgress()
    paintCards()
  }

  // The whole panel as one state with a message: not connected, no tab, not in git, an error. Nothing of an earlier diff stays in view.
  function blank(text: string, status = ''): void {
    result = null
    shown = []
    cards.clear()
    cardsEl.replaceChildren()
    comments = []
    placed = placeComments([], [])
    composing = editing = null
    paintGone()
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
      sendNote = null
      prefs = null
      refs = null
      selected = null
      cards.clear()
      comments = []
      composing = editing = null
      closePicker()
    }
    context.error(null)
    if (!deps.connected()) return blank('Core not connected', 'Reconnecting…')
    if (tab === null) return blank('No tab open')
    context.status('Loading…')
    try {
      if (prefs === null) prefs = await deps.prefs(tab)
      if (mine !== sequence || destroyed) return
      let commentFailure: string | null = null
      const [next, saved] = await Promise.all([
        deps.get(tab, prefs.mode, prefs.base, untracked.show),
        deps.comments.list(tab).catch((failure: unknown) => ((commentFailure = failureText(failure)), null)),
      ])
      if (mine !== sequence || destroyed) return
      if (next.state === 'not-git') return blank('This folder is not in a git repository.')
      if (next.state === 'error') return blank(`Could not read the changes: ${next.error ?? 'git failed'}`)
      result = next
      cards.clear()
      review = reviews.get(next.root ?? '') ?? { collapsed: new Set(), viewed: new Set() }
      reviews.set(next.root ?? '', review)
      if (saved) comments = saved
      placed = placeComments(next.files, comments)
      context.status('')
      paintAll()
      if (commentFailure !== null) context.error(`Could not load the comments: ${commentFailure}`)
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
    reveal(list, list.querySelector('.selected'))
  }

  async function openPicker(): Promise<void> {
    if (!tabId) return
    const tab = tabId
    picker.hidden = false
    baseButton.setAttribute('aria-expanded', 'true')
    search.value = ''
    choice = 0
    paintPicker()
    search.focus({ preventScroll: true })
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
    if (focus) baseButton.focus({ preventScroll: true })
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
  sendButton.addEventListener('click', () => void send())
  untrackedButton.addEventListener('click', () => {
    untracked.show = !untracked.show
    void load()
  })
  filterInput.addEventListener('input', () => {
    filter = filterInput.value
    if (result?.state === 'ok' && result.files.length > 0) paintCards()
  })
  // The filter is an icon until it is wanted: a click on it or Cmd+F (Ctrl+F off the Mac) opens the input; it shuts again when it is empty and loses focus.
  function showFilter(on: boolean): void {
    filterInput.hidden = !on
    filterBox.hidden = !on
    searchButton.hidden = on
    searchButton.setAttribute('aria-expanded', String(on))
  }
  function openFilter(): void {
    if (filterInput.disabled) return
    showFilter(true)
    filterInput.focus({ preventScroll: true })
    filterInput.select()
  }
  searchButton.addEventListener('click', openFilter)
  filterInput.addEventListener('blur', () => {
    if (filterInput.value === '') showFilter(false)
  })
  root.addEventListener('keydown', (event) => {
    if ((navigator.platform.startsWith('Mac') ? event.metaKey : event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      openFilter()
    }
  })
  filterInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (filterInput.value !== '') {
        filterInput.value = ''
        filter = ''
        paintCards()
      } else {
        showFilter(false)
        cardsEl.focus({ preventScroll: true })
      }
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      move(event.key === 'ArrowDown' ? 1 : -1)
    }
  })

  // Arrow keys and j and k move between the files; enter and space shut or open the selected one. A button inside a card keeps its own keys.
  cardsEl.addEventListener('keydown', (event) => {
    if (event.target !== cardsEl) return
    switch (event.key) {
      case 'ArrowDown':
      case 'j':
        return event.preventDefault(), move(1)
      case 'ArrowUp':
      case 'k':
        return event.preventDefault(), move(-1)
      case 'Enter':
      case ' ': {
        if (selected === null) return
        event.preventDefault()
        cards.get(selected)?.root.querySelector<HTMLButtonElement>('.diff-chevron')?.click()
      }
    }
  })

  blank('Loading…')
  void load()

  return {
    focus: () => (filterInput.disabled ? refreshButton : cardsEl).focus({ preventScroll: true }),
    destroy() {
      destroyed = true
      sequence++
      document.removeEventListener('mousedown', onOutside)
      document.removeEventListener('mouseup', endDrag)
      observer?.disconnect()
      root.remove()
    },
    retarget: () => {
      if (deps.tab() !== tabId) void load()
      else paintSend()
    },
    paintSend,
    refresh: () => void load(),
    connection: () => void load(),
    tab: () => tabId,
  }
}
