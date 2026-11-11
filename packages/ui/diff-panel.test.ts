// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiffBases, DiffComment, DiffFile, DiffFileContent, DiffPrefs, DiffResult } from '../protocol/messages.ts'
import { createDiffPanel, type DiffDeps } from './diff-panel.ts'
import type { DockContext } from './dock.ts'
import type { SendTarget } from './diff-model.ts'

const file = (path: string, status: DiffFile['status'] = 'modified', over: Partial<DiffFile> = {}): DiffFile => ({
  path, oldPath: null, status, binary: false, additions: 1, deletions: 1, truncated: false,
  hunks: [{ header: '@@ -1 +1 @@', oldStart: 1, newStart: 1, lines: [{ kind: 'del', text: 'old', old: 1, new: null }, { kind: 'add', text: 'new', old: null, new: 1 }] }],
  ...over,
})
const result = (files: DiffFile[], over: Partial<DiffResult> = {}): DiffResult => ({
  state: 'ok', error: null, root: '/r', files, truncated: false,
  compared: { mode: 'branch', base: null, defaultBase: 'main', onDefault: false, noDefault: false, noOwnCommits: false },
  counts: { branch: files.length, uncommitted: 0, 'last-commit': 0 },
  ...over,
})
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function setup(
  over: Partial<DiffDeps> = {},
  files = [file('src/a.ts'), file('src/b.ts', 'added'), file('top.md', 'untracked', { binary: true, hunks: [] })],
  saved: DiffComment[] = [],
) {
  document.body.innerHTML = ''
  const body = document.body.appendChild(document.createElement('div'))
  let prefs: DiffPrefs = { mode: 'branch', base: null, recents: [] }
  const bases: DiffBases = { branches: ['main', 'dev', 'origin/old'], current: 'feature', default: 'main', recents: [] }
  const state = { tab: 'tab1' as string | null, connected: true }
  const get = vi.fn(async (_tab: string, ..._rest: unknown[]) => result(files))
  const setPrefs = vi.fn(async (_tab: string, next: { mode?: DiffPrefs['mode']; base?: string | null }) => (prefs = { ...prefs, ...next }))
  const fileText = vi.fn(async (_tab: string, _mode: string, _path: string): Promise<DiffFileContent> => ({ state: 'ok', text: '# Title\n\nHello **world**\n' }))
  // The core's list of comments, as the fake keeps it.
  const store = { list: [...saved], next: 1 }
  const comments = {
    list: vi.fn(async (_tab: string) => [...store.list]),
    add: vi.fn(async (_tab: string, input: Parameters<DiffDeps['comments']['add']>[1]) => {
      const made: DiffComment = { id: `c${store.next++}`, ...input, state: 'pending', createdAt: Date.now() }
      store.list.push(made)
      return made
    }),
    update: vi.fn(async (_tab: string, id: string, change: { body?: string; state?: 'pending' | 'resolved' }) => {
      const found = store.list.find((c) => c.id === id)!
      Object.assign(found, change)
      return found
    }),
    remove: vi.fn(async (_tab: string, id: string) => void (store.list = store.list.filter((c) => c.id !== id))),
    markSent: vi.fn(async (_tab: string, ids: string[]) => {
      const changed = store.list.filter((c) => c.state === 'pending' && ids.includes(c.id))
      for (const c of changed) c.state = 'sent'
      return changed
    }),
  }
  // The window's active tab as a send target, and what the window was asked to do with it.
  const send = { target: { name: 'api', kind: 'claude', state: 'idle', exited: false } as SendTarget | null, writes: [] as string[], focused: [] as string[] }
  const write = vi.fn(async (_tab: string, data: string) => void send.writes.push(data))
  const deps: DiffDeps = {
    tab: () => state.tab,
    connected: () => state.connected,
    get,
    bases: async () => bases,
    prefs: async () => prefs,
    setPrefs,
    file: fileText,
    comments,
    target: () => send.target,
    write,
    focusTab: (tab) => void send.focused.push(tab),
    ...over,
  }
  const calls = { meta: [] as string[], status: [] as string[], error: [] as Array<string | null> }
  const context: DockContext = { meta: (t) => void calls.meta.push(t), status: (t) => void calls.status.push(t), error: (m) => void calls.error.push(m), close: () => undefined }
  const controller = createDiffPanel(deps)
  const instance = controller.panel.mount(body, context)
  return { body, controller, instance, state, get, setPrefs, fileText, calls, comments, store, send, write }
}
// happy-dom's observer never fires: without one the panel draws every card at once, which is what most tests look at.
beforeEach(() => void vi.stubGlobal('IntersectionObserver', undefined))
afterEach(() => void vi.unstubAllGlobals())
const q = <T extends HTMLElement>(root: ParentNode, selector: string): T => root.querySelector(selector) as T

describe('diff panel', () => {
  beforeEach(() => void (document.body.innerHTML = ''))

  const paths = (root: ParentNode): Array<string | undefined> => [...root.querySelectorAll<HTMLElement>('.diff-card')].map((e) => e.dataset.path)

  it('asks for the active tab by id, with the saved view, and draws one card per file with its lines', async () => {
    const t = setup()
    await flush()
    expect(t.get).toHaveBeenCalledWith('tab1', 'branch', null, true)
    expect(paths(t.body)).toEqual(['src/a.ts', 'src/b.ts', 'top.md'])
    const first = q(t.body, '[data-path="src/a.ts"]')
    expect(first.querySelector('.diff-dirname')?.textContent).toBe('src/')
    expect(first.querySelector('.diff-basename')?.textContent).toBe('a.ts')
    expect(first.querySelector('.diff-hunk-head')?.textContent).toBe('@@ -1 +1 @@')
    expect(first.querySelector('.diff-line-add .diff-text')?.textContent).toBe('new')
    expect(first.querySelector('.diff-line-del .diff-text')?.textContent).toBe('old')
    expect(first.querySelectorAll('.diff-square')).toHaveLength(5)
    expect([...t.body.querySelectorAll('.diff-summary > :is(.diff-summary-files, .diff-add-n, .diff-del-n)')].map((e) => e.textContent)).toEqual(['3 files changed', '+2', '−2'])
    expect(t.calls.meta.at(-1)).toBe('3')
    expect(q(t.body, '.diff-base').textContent).toBe('Branch · vs main ▾')
  })

  it('draws a card\'s lines only once it is near the viewport, with a placeholder as tall as the lines until then', async () => {
    const seen: Array<{ target: Element }> = []
    let wake: (entries: Array<{ isIntersecting: boolean; target: Element }>) => void = () => undefined
    class FakeObserver {
      constructor(callback: (entries: Array<{ isIntersecting: boolean; target: Element }>) => void) {
        wake = callback
      }
      observe(target: Element): void { seen.push({ target }) }
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    try {
      const t = setup()
      await flush()
      const first = q(t.body, '[data-path="src/a.ts"]')
      expect(first.querySelector('.diff-line')).toBeNull()
      expect(q<HTMLElement>(first, '.diff-card-pending').style.getPropertyValue('--lines')).toBe('4')
      wake([{ isIntersecting: false, target: first }])
      expect(first.querySelector('.diff-line')).toBeNull()
      wake([{ isIntersecting: true, target: first }])
      expect(first.querySelector('.diff-card-pending')).toBeNull()
      expect(first.querySelectorAll('.diff-line')).toHaveLength(2)
      expect(q(t.body, '[data-path="src/b.ts"]').querySelector('.diff-line')).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('chips new, deleted and renamed files, and not modified ones', async () => {
    const t = setup({}, [file('a.ts'), file('b.ts', 'added'), file('c.ts', 'deleted'), file('d.ts', 'renamed', { oldPath: 'old.ts' })])
    await flush()
    const chip = (path: string): string | undefined => t.body.querySelector(`[data-path="${path}"] .diff-chip`)?.textContent ?? undefined
    expect([chip('a.ts'), chip('b.ts'), chip('c.ts'), chip('d.ts')]).toEqual([undefined, 'New', 'Deleted', 'Renamed'])
    expect(q(t.body, '[data-path="d.ts"] .diff-path').title).toBe('old.ts → d.ts')
  })

  it('marks the words that changed inside a replaced line', async () => {
    const lines = [{ kind: 'del' as const, text: 'let n = 1', old: 1, new: null }, { kind: 'add' as const, text: 'let n = 2', old: null, new: 1 }]
    const t = setup({}, [file('w.ts', 'modified', { hunks: [{ header: '@@', oldStart: 1, newStart: 1, lines }] })])
    await flush()
    expect(q(t.body, '.diff-line-del .diff-word').textContent).toBe('1')
    expect(q(t.body, '.diff-line-add .diff-word').textContent).toBe('2')
    expect(q(t.body, '.diff-line-add .diff-text').textContent).toBe('let n = 2')
  })

  it('says it cannot preview a binary file', async () => {
    const t = setup()
    await flush()
    expect(q(t.body, '[data-path="top.md"] .diff-cannot').textContent).toBe('Cannot preview this file (binary, too large, or unreadable)')
    expect(t.body.querySelector('[data-path="top.md"] .diff-add-n')).toBeNull()
  })

  it('shuts and opens a card with its chevron', async () => {
    const t = setup()
    await flush()
    const card = q(t.body, '[data-path="src/a.ts"]')
    const chevron = q<HTMLButtonElement>(card, '.diff-chevron')
    expect(chevron.getAttribute('aria-expanded')).toBe('true')
    chevron.click()
    expect(card.classList.contains('collapsed')).toBe(true)
    expect(q(card, '.diff-card-body').hidden).toBe(true)
    expect(chevron.getAttribute('aria-label')).toBe('Expand src/a.ts')
    chevron.click()
    expect(q(card, '.diff-card-body').hidden).toBe(false)
  })

  it('marks a file viewed: it shuts and dims, the progress counts it, and unmarking opens it again', async () => {
    const t = setup()
    await flush()
    expect(q(t.body, '.diff-progress-text').textContent).toBe('0 of 3 viewed')
    const card = q(t.body, '[data-path="src/a.ts"]')
    const box = q<HTMLInputElement>(card, '.diff-viewed-box')
    box.checked = true
    box.dispatchEvent(new Event('change'))
    expect(card.classList.contains('viewed')).toBe(true)
    expect(card.classList.contains('collapsed')).toBe(true)
    expect(q(t.body, '.diff-progress-text').textContent).toBe('1 of 3 viewed')
    expect(q(t.body, '.diff-progress').getAttribute('aria-valuenow')).toBe('1')
    box.checked = false
    box.dispatchEvent(new Event('change'))
    expect(card.classList.contains('viewed')).toBe(false)
    expect(card.classList.contains('collapsed')).toBe(false)
    expect(q(t.body, '.diff-progress-text').textContent).toBe('0 of 3 viewed')
  })

  it('keeps viewed and shut cards for a folder after a refresh and after the panel is closed and opened again', async () => {
    const t = setup()
    await flush()
    const box = q<HTMLInputElement>(t.body, '[data-path="src/b.ts"] .diff-viewed-box')
    box.checked = true
    box.dispatchEvent(new Event('change'))
    q<HTMLButtonElement>(t.body, '[data-path="src/a.ts"] .diff-chevron').click()
    q<HTMLButtonElement>(t.body, '.diff-refresh').click()
    await flush()
    expect(q(t.body, '[data-path="src/b.ts"]').classList.contains('viewed')).toBe(true)
    expect(q(t.body, '[data-path="src/a.ts"]').classList.contains('collapsed')).toBe(true)
    t.instance.destroy()
    const body = document.body.appendChild(document.createElement('div'))
    t.controller.panel.mount(body, { meta: () => undefined, status: () => undefined, error: () => undefined, close: () => undefined })
    await flush()
    expect(q(body, '[data-path="src/b.ts"]').classList.contains('viewed')).toBe(true)
    expect(q(body, '.diff-progress-text').textContent).toBe('1 of 3 viewed')
  })

  it('moves the selected card with the arrow keys and j and k, and shuts it with enter', async () => {
    const t = setup()
    await flush()
    const cards = q(t.body, '.diff-cards')
    const key = (k: string): void => void cards.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
    expect(q(t.body, '.diff-card.selected').dataset.path).toBe('src/a.ts')
    key('ArrowDown')
    expect(q(t.body, '.diff-card.selected').dataset.path).toBe('src/b.ts')
    key('j')
    expect(q(t.body, '.diff-card.selected').dataset.path).toBe('top.md')
    key('j')
    expect(q(t.body, '.diff-card.selected').dataset.path).toBe('top.md')
    key('k')
    key('ArrowUp')
    expect(q(t.body, '.diff-card.selected').dataset.path).toBe('src/a.ts')
    key('Enter')
    expect(q(t.body, '[data-path="src/a.ts"]').classList.contains('collapsed')).toBe(true)
  })

  it('filters the files, and keeps what was shut when the filter clears', async () => {
    const t = setup()
    await flush()
    q<HTMLButtonElement>(t.body, '[data-path="top.md"] .diff-chevron').click()
    const input = q<HTMLInputElement>(t.body, '.diff-filter')
    input.value = 'top'
    input.dispatchEvent(new Event('input'))
    expect(paths(t.body)).toEqual(['top.md'])
    input.value = 'zzz'
    input.dispatchEvent(new Event('input'))
    expect(q(t.body, '.diff-message').textContent).toBe('No file matches the filter.')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(paths(t.body)).toEqual(['src/a.ts', 'src/b.ts', 'top.md'])
    expect(q(t.body, '[data-path="top.md"]').classList.contains('collapsed')).toBe(true)
  })

  it('switches mode through the core and loads again', async () => {
    const t = setup()
    await flush()
    ;[...t.body.querySelectorAll<HTMLButtonElement>('.diff-mode')][1].click()
    await flush()
    expect(t.setPrefs).toHaveBeenCalledWith('tab1', { mode: 'uncommitted' })
    expect(t.get).toHaveBeenLastCalledWith('tab1', 'uncommitted', null, true)
    expect(q(t.body, '.diff-base').hidden).toBe(true)
  })

  it('picks a base from the popover and saves it', async () => {
    const t = setup()
    await flush()
    q(t.body, '.diff-base').click()
    await flush()
    expect(q(t.body, '.diff-picker').hidden).toBe(false)
    expect([...t.body.querySelectorAll('.diff-picker-option')].map((e) => e.textContent)).toEqual(['maindefault'])
    const search = q<HTMLInputElement>(t.body, '.diff-picker-search')
    search.value = 'old'
    search.dispatchEvent(new Event('input'))
    q(t.body, '.diff-picker-option').click()
    await flush()
    expect(t.setPrefs).toHaveBeenCalledWith('tab1', { base: 'origin/old' })
    expect(t.get).toHaveBeenLastCalledWith('tab1', 'branch', 'origin/old', true)
    expect(q(t.body, '.diff-picker').hidden).toBe(true)
  })

  it('shows the empty message with a link to the next mode', async () => {
    const t = setup({}, [])
    await flush()
    expect(q(t.body, '.diff-message').textContent).toContain('No changes on this branch compared to main.')
    q(t.body, '.diff-link').click()
    await flush()
    expect(t.setPrefs).toHaveBeenCalledWith('tab1', { mode: 'last-commit' })
  })

  it('shows Core not connected, not an empty diff, and looks again on reconnect', async () => {
    const t = setup()
    await flush()
    t.state.connected = false
    t.controller.connection(false)
    await flush()
    expect(q(t.body, '.diff-message').textContent).toBe('Core not connected')
    expect(t.body.querySelector('.diff-card')).toBeNull()
    t.state.connected = true
    t.controller.connection(true)
    await flush()
    expect(t.body.querySelectorAll('.diff-card')).toHaveLength(3)
  })

  it('re-targets on a tab switch, and only when the tab changed', async () => {
    const t = setup()
    await flush()
    t.controller.retarget()
    await flush()
    expect(t.get).toHaveBeenCalledTimes(1)
    t.state.tab = 'tab2'
    t.controller.retarget()
    await flush()
    expect(t.get).toHaveBeenLastCalledWith('tab2', 'branch', null, true)
  })

  it('looks again when the active tab\'s agent stops working, and not for another tab', async () => {
    const t = setup()
    await flush()
    t.controller.agentChanged('other', true)
    t.controller.agentChanged('tab1', false)
    await flush()
    expect(t.get).toHaveBeenCalledTimes(1)
    t.controller.agentChanged('tab1', true)
    await flush()
    expect(t.get).toHaveBeenCalledTimes(2)
  })

  it('does not draw a slow answer for a tab that is no longer active', async () => {
    let release: (r: DiffResult) => void = () => undefined
    const slow = new Promise<DiffResult>((resolve) => (release = resolve))
    const t = setup({}, [file('new.ts')])
    await flush()
    t.get.mockImplementation(async (tab: string) => (tab === 'tab2' ? slow : result([file('fresh.ts')])))
    t.state.tab = 'tab2'
    t.controller.retarget()
    await flush()
    t.state.tab = 'tab3'
    t.controller.retarget()
    await flush()
    release(result([file('stale.ts')]))
    await flush()
    expect(paths(t.body)).toEqual(['fresh.ts'])
  })

  it('says so for a folder outside git and for an error', async () => {
    const t = setup({ get: async () => result([], { state: 'not-git' }) })
    await flush()
    expect(q(t.body, '.diff-message').textContent).toBe('This folder is not in a git repository.')
    const e = setup({ get: async () => result([], { state: 'error', error: 'timed out' }) })
    await flush()
    expect(q(e.body, '.diff-message').textContent).toBe('Could not read the changes: timed out')
  })
})

describe('diff panel comments', () => {
  const note = (over: Partial<DiffComment> = {}): DiffComment => ({
    id: 'k1', path: 'src/a.ts', side: 'new', line: 1, anchor: 'new', before: [], after: [], body: 'first\nsecond <b>x</b>', state: 'pending', createdAt: Date.now() - 120_000, ...over,
  })
  const click = (root: ParentNode, selector: string): void => void q<HTMLElement>(root, selector).click()
  // The plus is one shared button that moves to the line under the pointer.
  const plusOn = (root: ParentNode, selector: string): void => {
    q<HTMLElement>(root, selector).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    click(root, '.diff-add-comment')
  }
  const type = (root: ParentNode, text: string): HTMLTextAreaElement => {
    const box = q<HTMLTextAreaElement>(root, '.diff-comment-input')
    box.value = text
    box.dispatchEvent(new Event('input'))
    return box
  }
  const key = (box: HTMLElement, init: KeyboardEventInit): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    box.dispatchEvent(event)
    return event
  }

  it('loads the folder\'s comments with the diff and draws a thread under its line, as text', async () => {
    const t = setup({}, undefined, [note()])
    await flush()
    expect(t.comments.list).toHaveBeenCalledWith('tab1')
    const thread = q(t.body, '[data-path="src/a.ts"] .diff-thread')
    expect(thread.previousElementSibling?.classList.contains('diff-line-add')).toBe(true)
    expect(q(thread, '.diff-thread-author').textContent).toBe('You')
    expect(q(thread, '.diff-thread-time').textContent).toBe('2 min ago')
    expect(q(thread, '.diff-thread-body').textContent).toBe('first\nsecond <b>x</b>')
    expect(thread.querySelector('b.x, .diff-thread-body b')).toBeNull()
    expect(q(thread, '.diff-comment-chip').textContent).toBe('Pending')
    expect(q(t.body, '[data-path="src/a.ts"] .diff-comment-count').textContent).toBe('1')
    expect(q<HTMLElement>(t.body, '[data-path="src/b.ts"] .diff-comment-count').hidden).toBe(true)
    expect(t.body.querySelector('.diff-pending-n')).toBeNull()
  })

  it('draws a comment on a deleted line under the old side, and shows the sent state dimmed', async () => {
    const t = setup({}, undefined, [note({ id: 'd', side: 'old', anchor: 'old', state: 'sent' })])
    await flush()
    const thread = q(t.body, '.diff-thread')
    expect(thread.previousElementSibling?.classList.contains('diff-line-del')).toBe(true)
    expect(thread.classList.contains('diff-thread-sent')).toBe(true)
    expect(q(thread, '.diff-comment-chip').textContent).toBe('Sent')
    expect(t.body.querySelector('.diff-pending-n')).toBeNull()
  })

  it('opens a composer from the plus on a line, adds the comment through the core and draws it', async () => {
    const t = setup()
    await flush()
    const lines = t.body.querySelectorAll('[data-path="src/a.ts"] .diff-line')
    lines[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(lines[1].querySelector('.diff-add-comment')?.getAttribute('aria-label')).toBe('Comment on line 1')
    expect(t.body.querySelectorAll('.diff-add-comment')).toHaveLength(1)
    click(t.body, '.diff-add-comment')
    const again = t.body.querySelectorAll('[data-path="src/a.ts"] .diff-line')
    expect(again[1].nextElementSibling?.classList.contains('diff-comment-composer')).toBe(true)
    expect(q<HTMLButtonElement>(t.body, '.diff-comment-submit').disabled).toBe(true)
    type(t.body, 'why this?')
    expect(q<HTMLButtonElement>(t.body, '.diff-comment-submit').disabled).toBe(false)
    click(t.body, '.diff-comment-submit')
    await flush()
    expect(t.comments.add).toHaveBeenCalledWith('tab1', { path: 'src/a.ts', side: 'new', line: 1, anchor: 'new', before: [], after: [], body: 'why this?' })
    expect(t.body.querySelector('.diff-comment-composer')).toBeNull()
    expect(q(t.body, '.diff-thread-body').textContent).toBe('why this?')
    expect(q(t.body, '[data-path="src/a.ts"] .diff-comment-count').textContent).toBe('1')
    expect(t.body.querySelector('.diff-send-count')?.textContent).toBe('1')
  })

  it('drags from the plus over several lines and comments on all of them, under the last', async () => {
    const lines = [0, 1, 2, 3].map((i) => ({ kind: 'add' as const, text: `l${i}`, old: null, new: i + 1 }))
    const t = setup({}, [file('r.ts', 'modified', { hunks: [{ header: '@@', oldStart: 1, newStart: 1, lines }] })])
    await flush()
    const rows = [...t.body.querySelectorAll<HTMLElement>('.diff-line')]
    rows[0].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    q(t.body, '.diff-add-comment').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    rows[2].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(rows.map((r) => r.classList.contains('diff-line-picked'))).toEqual([true, true, true, false])
    document.dispatchEvent(new MouseEvent('mouseup'))
    expect(t.body.querySelector('.diff-line-picked')).toBeNull()
    const after = [...t.body.querySelectorAll('.diff-line')]
    expect(after[2].nextElementSibling?.classList.contains('diff-comment-composer')).toBe(true)
    type(t.body, 'these three')
    click(t.body, '.diff-comment-submit')
    await flush()
    expect(t.comments.add.mock.calls[0][1]).toMatchObject({ line: 1, endLine: 3, anchor: 'l0\nl1\nl2', before: [], after: ['l3'] })
    expect(q(t.body, '.diff-line + .diff-thread').previousElementSibling?.textContent).toContain('l2')
  })

  it('does not extend a drag onto another side or another hunk, and a press and release on one line is one line', async () => {
    const t = setup()
    await flush()
    const rows = [...t.body.querySelectorAll<HTMLElement>('[data-path="src/a.ts"] .diff-line')]
    rows[0].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    q(t.body, '.diff-add-comment').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    rows[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    document.dispatchEvent(new MouseEvent('mouseup'))
    type(t.body, 'one')
    click(t.body, '.diff-comment-submit')
    await flush()
    expect(t.comments.add.mock.calls[0][1]).toMatchObject({ side: 'old', line: 1, anchor: 'old' })
    expect(t.comments.add.mock.calls[0][1]).not.toHaveProperty('endLine')
  })

  it('draws a range comment under its last line and words its place as path:first-last', async () => {
    const lines = [0, 1, 2].map((i) => ({ kind: 'add' as const, text: `l${i}`, old: null, new: i + 1 }))
    const t = setup({}, [file('r.ts', 'modified', { hunks: [{ header: '@@', oldStart: 1, newStart: 1, lines }] })], [note({ path: 'r.ts', line: 1, endLine: 2, anchor: 'l0\nl1' }), note({ id: 'x', path: 'r.ts', line: 2, endLine: 3, anchor: 'l1\nCHANGED' })])
    await flush()
    expect(q(t.body, '.diff-line + .diff-thread').previousElementSibling?.textContent).toContain('l1')
    expect(q(t.body, '.diff-outdated-where').textContent).toBe('r.ts:2-3')
  })

  it('comments on the old side for a deleted line', async () => {
    const t = setup()
    await flush()
    plusOn(t.body, '.diff-line-del')
    type(t.body, 'gone?')
    click(t.body, '.diff-comment-submit')
    await flush()
    expect(t.comments.add.mock.calls[0][1]).toMatchObject({ side: 'old', line: 1, anchor: 'old' })
  })

  it('submits with Cmd or Ctrl and Enter, and cancels with Escape without closing the dock', async () => {
    const t = setup()
    await flush()
    plusOn(t.body, '.diff-line-add')
    const box = type(t.body, 'draft')
    const escape = key(box, { key: 'Escape' })
    expect(escape.defaultPrevented).toBe(true)
    expect(t.body.querySelector('.diff-comment-composer')).toBeNull()
    expect(t.comments.add).not.toHaveBeenCalled()
    plusOn(t.body, '.diff-line-add')
    key(type(t.body, 'sent by key'), { key: 'Enter', ctrlKey: true })
    await flush()
    expect(t.comments.add).toHaveBeenCalledTimes(1)
    plusOn(t.body, '.diff-line-add')
    key(type(t.body, 'again'), { key: 'Enter', metaKey: true })
    await flush()
    expect(t.comments.add).toHaveBeenCalledTimes(2)
    plusOn(t.body, '.diff-line-add')
    key(q(t.body, '.diff-comment-input'), { key: 'Enter' })
    expect(t.comments.add).toHaveBeenCalledTimes(2)
  })

  it('cancels the composer with its button and keeps nothing', async () => {
    const t = setup()
    await flush()
    plusOn(t.body, '.diff-line-add')
    type(t.body, 'never mind')
    click(t.body, '.diff-comment-cancel')
    expect(t.body.querySelector('.diff-comment-composer')).toBeNull()
    expect(t.comments.add).not.toHaveBeenCalled()
  })

  it('keeps the text and shows the core\'s message when adding fails', async () => {
    const t = setup()
    await flush()
    t.comments.add.mockRejectedValueOnce(new Error('a folder keeps at most 500 comments'))
    plusOn(t.body, '.diff-line-add')
    type(t.body, 'keep me')
    click(t.body, '.diff-comment-submit')
    await flush()
    expect(q(t.body, '.diff-comment-error').textContent).toBe('a folder keeps at most 500 comments')
    expect(q<HTMLElement>(t.body, '.diff-comment-error').hidden).toBe(false)
    expect(q<HTMLTextAreaElement>(t.body, '.diff-comment-input').value).toBe('keep me')
    expect(q<HTMLButtonElement>(t.body, '.diff-comment-submit').disabled).toBe(false)
    click(t.body, '.diff-comment-submit')
    await flush()
    expect(t.body.querySelector('.diff-comment-composer')).toBeNull()
    expect(q(t.body, '.diff-thread-body').textContent).toBe('keep me')
  })

  it('edits a comment in place and saves the new text', async () => {
    const t = setup({}, undefined, [note({ body: 'old text' })])
    await flush()
    click(t.body, '.diff-comment-edit')
    expect(q<HTMLTextAreaElement>(t.body, '.diff-thread .diff-comment-input').value).toBe('old text')
    type(t.body, 'new text')
    click(t.body, '.diff-comment-submit')
    await flush()
    expect(t.comments.update).toHaveBeenCalledWith('tab1', 'k1', { body: 'new text' })
    expect(q(t.body, '.diff-thread-body').textContent).toBe('new text')
  })

  it('leaves an edit alone with Cancel', async () => {
    const t = setup({}, undefined, [note({ body: 'old text' })])
    await flush()
    click(t.body, '.diff-comment-edit')
    type(t.body, 'changed')
    click(t.body, '.diff-comment-cancel')
    expect(q(t.body, '.diff-thread-body').textContent).toBe('old text')
    expect(t.comments.update).not.toHaveBeenCalled()
  })

  it('deletes a comment', async () => {
    const t = setup({}, undefined, [note()])
    await flush()
    click(t.body, '.diff-comment-delete')
    await flush()
    expect(t.comments.remove).toHaveBeenCalledWith('tab1', 'k1')
    expect(t.body.querySelector('.diff-thread')).toBeNull()
    expect(q<HTMLElement>(t.body, '[data-path="src/a.ts"] .diff-comment-count').hidden).toBe(true)
    expect(t.body.querySelector('.diff-pending-n')).toBeNull()
  })

  it('resolves and reopens a comment', async () => {
    const t = setup({}, undefined, [note()])
    await flush()
    expect(q(t.body, '.diff-comment-resolve').textContent).toBe('Resolve')
    click(t.body, '.diff-comment-resolve')
    await flush()
    expect(t.comments.update).toHaveBeenLastCalledWith('tab1', 'k1', { state: 'resolved' })
    expect(q(t.body, '.diff-comment-chip').textContent).toBe('Resolved')
    expect(t.body.querySelector('.diff-pending-n')).toBeNull()
    expect(q(t.body, '.diff-comment-resolve').textContent).toBe('Reopen')
    click(t.body, '.diff-comment-resolve')
    await flush()
    expect(t.comments.update).toHaveBeenLastCalledWith('tab1', 'k1', { state: 'pending' })
    expect(q(t.body, '.diff-comment-chip').textContent).toBe('Pending')
  })

  it('reports a failed delete or resolve in the panel\'s error line and keeps the thread', async () => {
    const t = setup({}, undefined, [note()])
    await flush()
    t.comments.remove.mockRejectedValueOnce(new Error('no such comment: k1'))
    click(t.body, '.diff-comment-delete')
    await flush()
    expect(t.calls.error.at(-1)).toBe('Could not delete the comment: no such comment: k1')
    expect(t.body.querySelector('.diff-thread')).not.toBeNull()
  })

  it('lists a comment whose line text changed under a collapsed Outdated section in its card, not inline', async () => {
    const t = setup({}, undefined, [note({ anchor: 'something else' })])
    await flush()
    expect(t.body.querySelector('.diff-line + .diff-thread')).toBeNull()
    const section = q<HTMLDetailsElement>(t.body, '[data-path="src/a.ts"] .diff-outdated')
    expect(section.open).toBe(false)
    expect(q(section, '.diff-outdated-summary').textContent).toBe('Outdated (1)')
    expect(q(section, '.diff-outdated-where').textContent).toBe('src/a.ts:1')
    expect(q(section, '.diff-outdated-anchor').textContent).toBe('something else')
    expect(section.querySelectorAll('.diff-comment-delete')).toHaveLength(1)
    expect(q(t.body, '[data-path="src/a.ts"] .diff-comment-count').textContent).toBe('1')
    expect(t.body.querySelector('.diff-send-count')?.textContent).toBe('1')
  })

  it('lists a comment on a file that is not in the diff in a section above the cards, and acts on it from there', async () => {
    const t = setup({}, undefined, [note({ id: 'g', path: 'gone.ts', line: 7, side: 'old' })])
    await flush()
    const gone = q(t.body, '.diff-gone')
    expect(gone.hidden).toBe(false)
    expect(q(gone, '.diff-outdated-where').textContent).toBe('gone.ts:7 (old)')
    expect(gone.nextElementSibling).toBe(q(t.body, '.diff-cards'))
    click(gone, '.diff-comment-delete')
    await flush()
    expect(t.comments.remove).toHaveBeenCalledWith('tab1', 'g')
    expect(q(t.body, '.diff-gone').hidden).toBe(true)
  })

  it('does not move a comment: the same text at another line number is outdated', async () => {
    const t = setup({}, undefined, [note({ line: 2 })])
    await flush()
    expect(t.body.querySelector('.diff-line + .diff-thread')).toBeNull()
    expect(q(t.body, '.diff-outdated-summary').textContent).toBe('Outdated (1)')
  })

  it('keeps the filter working with comments, and keeps the open Outdated section open', async () => {
    const t = setup({}, undefined, [note({ path: 'gone.ts' })])
    await flush()
    const details = q<HTMLDetailsElement>(t.body, '.diff-gone .diff-outdated')
    details.open = true
    details.dispatchEvent(new Event('toggle'))
    const input = q<HTMLInputElement>(t.body, '.diff-filter')
    input.value = 'top'
    input.dispatchEvent(new Event('input'))
    expect([...t.body.querySelectorAll<HTMLElement>('.diff-card')].map((e) => e.dataset.path)).toEqual(['top.md'])
    click(t.body, '.diff-comment-resolve')
    await flush()
    expect(q<HTMLDetailsElement>(t.body, '.diff-gone .diff-outdated').open).toBe(true)
  })

  it('says so when the comments cannot be loaded, and still shows the diff', async () => {
    const t = setup({}, undefined, [])
    t.comments.list.mockRejectedValue(new Error('core said no'))
    q<HTMLButtonElement>(t.body, '.diff-refresh').click()
    await flush()
    expect(t.calls.error.at(-1)).toBe('Could not load the comments: core said no')
    expect(t.body.querySelectorAll('.diff-card')).toHaveLength(3)
  })

  it('shows no comments of the previous tab after a tab switch', async () => {
    const t = setup({}, undefined, [note()])
    await flush()
    expect(t.body.querySelector('.diff-thread')).not.toBeNull()
    t.store.list.length = 0
    t.state.tab = 'tab2'
    t.controller.retarget()
    await flush()
    expect(t.comments.list).toHaveBeenLastCalledWith('tab2')
    expect(t.body.querySelector('.diff-thread')).toBeNull()
  })
})

describe('diff panel: send to the agent', () => {
  const note = (id: string, over: Partial<DiffComment> = {}): DiffComment => ({
    id, path: 'src/a.ts', side: 'new', line: 1, anchor: 'new', before: [], after: [], body: `body ${id}`, state: 'pending', createdAt: 1, ...over,
  })
  const button = (root: ParentNode): HTMLButtonElement => q(root, '.diff-send-button')
  const label = (root: ParentNode): string | null => button(root).getAttribute('aria-label')
  const line = (root: ParentNode): string => q(root, '.diff-send-line').textContent ?? ''
  const refresh = async (t: ReturnType<typeof setup>): Promise<void> => {
    q<HTMLButtonElement>(t.body, '.diff-refresh').click()
    await flush()
  }

  it('names the agent and tab with the pending count, and sends one bracketed paste with no Enter', async () => {
    const t = setup({}, undefined, [note('c1'), note('c2', { path: 'src/b.ts' }), note('c3', { state: 'resolved' })])
    await flush()
    expect(label(t.body)).toBe('Send 2 to claude · api')
    expect(button(t.body).disabled).toBe(false)
    button(t.body).click()
    await flush()
    expect(t.write).toHaveBeenCalledTimes(1)
    const [tab, data] = t.write.mock.calls[0]
    expect(tab).toBe('tab1')
    expect(data.startsWith('\x1b[200~Review comments on the current changes:\n\nsrc/a.ts:1 (new)')).toBe(true)
    expect(data.endsWith('\x1b[201~')).toBe(true)
    expect(data).not.toContain('\r')
    expect(data).toContain('body c1')
    expect(data).toContain('body c2')
    expect(data).not.toContain('body c3')
    expect(t.comments.markSent).toHaveBeenCalledWith('tab1', ['c1', 'c2'])
    expect(t.store.list.map((c) => c.state)).toEqual(['sent', 'sent', 'resolved'])
    expect(t.send.focused).toEqual(['tab1'])
    expect(t.body.querySelectorAll('.diff-comment-chip-sent')).toHaveLength(2)
    // Nothing is pending any more, so the button is not drawn at all.
    expect(q<HTMLElement>(t.body, '.diff-send').hidden).toBe(true)
  })

  it('draws no button and no text while nothing is pending', async () => {
    const t = setup()
    await flush()
    expect(q<HTMLElement>(t.body, '.diff-send').hidden).toBe(true)
    expect(line(t.body)).toBe('')
  })

  it('a second send includes only comments added since', async () => {
    const t = setup({}, undefined, [note('c1')])
    await flush()
    button(t.body).click()
    await flush()
    t.store.list.push(note('c2', { path: 'src/b.ts' }))
    await refresh(t)
    button(t.body).click()
    await flush()
    expect(t.write.mock.calls[1][1]).not.toContain('body c1')
    expect(t.write.mock.calls[1][1]).toContain('body c2')
  })

  it('marks an outdated pending comment in the message', async () => {
    const t = setup({}, undefined, [note('c1', { anchor: 'different text' })])
    await flush()
    button(t.body).click()
    await flush()
    expect(t.write.mock.calls[0][1]).toContain('src/a.ts:1 (new) (outdated: the code has changed since)')
    expect(t.store.list[0].state).toBe('sent')
  })

  it.each([
    ['a shell tab', { name: '1', kind: 'shell', state: 'idle', exited: false }, [note('c1')], 'This tab has no agent'],
    ['a gone tab', { name: 'api', kind: 'claude', state: 'idle', exited: true }, [note('c1')], 'This tab has no agent'],
    ['no target', null, [note('c1')], 'This tab has no agent'],
    ['a permission prompt', { name: 'api', kind: 'claude', state: 'needs-you', reason: 'permission', exited: false }, [note('c1')], 'claude is waiting for an answer'],
    ['a question', { name: 'api', kind: 'claude', state: 'needs-you', reason: 'question', exited: false }, [note('c1')], 'claude is waiting for an answer'],
  ] as Array<[string, SendTarget | null | undefined, DiffComment[], string]>)('is disabled with its reason in view for %s', async (_name, target, saved, reason) => {
    const t = setup({}, undefined, saved)
    if (target !== undefined) t.send.target = target
    await flush()
    expect(button(t.body).disabled).toBe(true)
    expect(button(t.body).title).toBe(reason)
    expect(line(t.body)).toBe(reason)
    button(t.body).click()
    await flush()
    expect(t.write).not.toHaveBeenCalled()
  })

  it('follows the host events: agent state, active tab and connection', async () => {
    const t = setup({}, undefined, [note('c1')])
    await flush()
    expect(button(t.body).disabled).toBe(false)
    t.send.target = { name: 'api', kind: 'claude', state: 'needs-you', reason: 'permission', exited: false }
    t.controller.agentChanged('tab1', false)
    expect(button(t.body).disabled).toBe(true)
    t.send.target = { name: 'web', kind: 'opencode', state: 'finished', exited: false }
    t.controller.retarget()
    expect(label(t.body)).toBe('Send 1 to opencode · web')
    expect(button(t.body).disabled).toBe(false)
    t.state.connected = false
    t.controller.connection(false)
    await flush()
    expect(q<HTMLElement>(t.body, '.diff-summary').hidden).toBe(true)
  })

  it('takes the agent name from its kind for the label, the notice and the reasons, and pastes the same text', async () => {
    const t = setup({}, undefined, [note('c1'), note('c2', { path: 'src/b.ts' })])
    t.send.target = { name: 'web', kind: 'opencode', state: 'working', exited: false }
    await flush()
    expect(label(t.body)).toBe('Send 2 to opencode · web')
    t.comments.markSent.mockImplementationOnce(async () => {
      t.store.list[0].state = 'sent'
      return [t.store.list[0]]
    })
    button(t.body).click()
    await flush()
    expect(t.write.mock.calls[0][1].startsWith('\x1b[200~Review comments on the current changes:')).toBe(true)
    expect(line(t.body)).toBe('opencode is working; the text is waiting in its input')
    t.send.target = { name: 'web', kind: 'copilot', state: 'needs-you', reason: 'question', exited: false }
    t.controller.agentChanged('tab1', false)
    expect(line(t.body)).toBe('copilot is waiting for an answer')
  })

  it('is disabled with the reason when the core is not connected', async () => {
    const t = setup({}, undefined, [note('c1')])
    await flush()
    t.state.connected = false
    t.controller.agentChanged('tab1', false)
    expect(button(t.body).disabled).toBe(true)
    expect(line(t.body)).toBe('The core is not connected')
  })

  it('sends while the agent works, and says afterwards that the text waits in its input', async () => {
    const t = setup({}, undefined, [note('c1'), note('c2', { path: 'src/b.ts' })])
    t.send.target = { name: 'api', kind: 'claude', state: 'working', exited: false }
    await flush()
    expect(button(t.body).disabled).toBe(false)
    expect(line(t.body)).toBe('')
    // Only c1 is marked by the fake core, so a pending comment stays and the line has the notice to itself.
    t.comments.markSent.mockImplementationOnce(async () => {
      t.store.list[0].state = 'sent'
      return [t.store.list[0]]
    })
    button(t.body).click()
    await flush()
    expect(t.write).toHaveBeenCalledTimes(1)
    expect(line(t.body)).toBe('claude is working; the text is waiting in its input')
  })

  it('when the write fails, shows the error and changes nothing', async () => {
    const t = setup({ write: async () => { throw new Error('tab is gone') } }, undefined, [note('c1')])
    await flush()
    button(t.body).click()
    await flush()
    expect(t.calls.error.at(-1)).toBe('Could not send the comments: tab is gone')
    expect(t.comments.markSent).not.toHaveBeenCalled()
    expect(t.store.list[0].state).toBe('pending')
    expect(t.send.focused).toEqual([])
    expect(button(t.body).disabled).toBe(false)
  })

  it('when marking fails after the paste, says so, refreshes and still focuses the tab', async () => {
    const t = setup({}, undefined, [note('c1')])
    t.comments.markSent.mockRejectedValueOnce(new Error('disk full'))
    await flush()
    const listed = t.comments.list.mock.calls.length
    button(t.body).click()
    await flush()
    expect(t.write).toHaveBeenCalledTimes(1)
    expect(t.calls.error.at(-1)).toBe('The text was pasted, but the comments could not be marked sent: disk full')
    expect(t.comments.list.mock.calls.length).toBeGreaterThan(listed)
    expect(t.send.focused).toEqual(['tab1'])
  })

  it('keeps the filter as an icon until it is clicked, opens it with Cmd+F, and shuts it again when empty', async () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' })
    const t = setup()
    await flush()
    const input = q<HTMLInputElement>(t.body, '.diff-filter')
    const icon = q<HTMLButtonElement>(t.body, '.diff-search')
    expect(input.hidden).toBe(true)
    icon.click()
    expect(input.hidden).toBe(false)
    expect(icon.hidden).toBe(true)
    expect(document.activeElement).toBe(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(input.hidden).toBe(true)
    expect(icon.hidden).toBe(false)
    q(t.body, '.diff').dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true }))
    expect(input.hidden).toBe(false)
    input.value = 'top'
    input.dispatchEvent(new Event('input'))
    input.dispatchEvent(new Event('blur'))
    expect(input.hidden).toBe(false)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    input.dispatchEvent(new Event('blur'))
    expect(input.hidden).toBe(true)
  })
})

describe('diff panel: markdown preview', () => {
  const doc = (over: Partial<DiffFile> = {}) => file('docs/guide.md', 'modified', over)
  const view = (card: Element, label: 'Diff' | 'Preview'): HTMLButtonElement =>
    [...card.querySelectorAll<HTMLButtonElement>('.diff-view button')].find((b) => b.textContent === label)!

  it('gives a markdown card a Diff and Preview switch, and no other file, deleted, binary or cut one', async () => {
    const t = setup({}, [
      doc(),
      file('README.MD', 'added'),
      file('src/a.ts'),
      doc({ status: 'deleted', path: 'gone.md' }),
      doc({ binary: true, hunks: [], path: 'bin.md' }),
      doc({ truncated: true, hunks: [], path: 'big.md' }),
    ])
    await flush()
    const has = (path: string): boolean => t.body.querySelector(`[data-path="${path}"] .diff-view`) !== null
    expect(['docs/guide.md', 'README.MD', 'src/a.ts', 'gone.md', 'bin.md', 'big.md'].map(has)).toEqual([true, true, false, false, false, false])
    expect(view(q(t.body, '[data-path="docs/guide.md"]'), 'Diff').getAttribute('aria-pressed')).toBe('true')
    expect(view(q(t.body, '[data-path="docs/guide.md"]'), 'Preview').getAttribute('aria-pressed')).toBe('false')
    expect(t.fileText).not.toHaveBeenCalled()
  })

  it('flips to the file as it reads after the change, asked for once, and back without asking again', async () => {
    const t = setup({}, [doc()])
    await flush()
    const card = q(t.body, '[data-path="docs/guide.md"]')
    view(card, 'Preview').click()
    expect(card.querySelector('.diff-card-body')?.textContent).toContain('Loading')
    await flush()
    expect(t.fileText).toHaveBeenCalledTimes(1)
    expect(t.fileText).toHaveBeenCalledWith('tab1', 'branch', 'docs/guide.md')
    expect(q(card, '.diff-card-body h1').textContent).toBe('Title')
    expect(q(card, '.diff-card-body strong').textContent).toBe('world')
    expect(card.querySelector('.diff-line')).toBeNull()
    expect(view(card, 'Preview').getAttribute('aria-pressed')).toBe('true')
    view(card, 'Diff').click()
    expect(card.querySelector('.diff-line-add .diff-text')?.textContent).toBe('new')
    expect(card.querySelector('h1')).toBeNull()
    view(card, 'Preview').click()
    await flush()
    expect(q(card, 'h1').textContent).toBe('Title')
    expect(t.fileText).toHaveBeenCalledTimes(1)
  })

  it('opens on the diff, and shows no comment controls in the preview', async () => {
    const t = setup({}, [doc()])
    await flush()
    const card = q(t.body, '[data-path="docs/guide.md"]')
    expect(card.querySelector('.diff-line')).not.toBeNull()
    view(card, 'Preview').click()
    await flush()
    expect(card.querySelector('.diff-plus, .diff-thread, .diff-composer')).toBeNull()
  })

  it('does not let a link in the preview navigate the window', async () => {
    const t = setup({ file: async () => ({ state: 'ok', text: '[site](https://example.com)' }) }, [doc()])
    await flush()
    const card = q(t.body, '[data-path="docs/guide.md"]')
    view(card, 'Preview').click()
    await flush()
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    q(card, 'a').dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
  })

  it('keeps the choice across a refresh and a reopened panel, and asks again then, since the diff was read again', async () => {
    const t = setup({}, [doc(), file('src/a.ts')])
    await flush()
    view(q(t.body, '[data-path="docs/guide.md"]'), 'Preview').click()
    await flush()
    q<HTMLButtonElement>(t.body, '.diff-refresh').click()
    await flush()
    expect(q(t.body, '[data-path="docs/guide.md"] h1').textContent).toBe('Title')
    expect(t.fileText).toHaveBeenCalledTimes(2)
    t.instance.destroy()
    const body = document.body.appendChild(document.createElement('div'))
    t.controller.panel.mount(body, { meta: () => undefined, status: () => undefined, error: () => undefined, close: () => undefined })
    await flush()
    expect(q(body, '[data-path="docs/guide.md"] h1').textContent).toBe('Title')
  })

  it('asks for the new mode after the mode changes', async () => {
    const t = setup({}, [doc()])
    await flush()
    view(q(t.body, '[data-path="docs/guide.md"]'), 'Preview').click()
    await flush()
    ;[...t.body.querySelectorAll<HTMLButtonElement>('.diff-mode')][2].click()
    await flush()
    expect(t.fileText).toHaveBeenLastCalledWith('tab1', 'last-commit', 'docs/guide.md')
  })

  it('says why a file cannot be previewed, and how it failed, and lets the diff come back', async () => {
    const answers: Record<string, () => Promise<DiffFileContent>> = {
      'big.md': async () => ({ state: 'too-large', text: null }),
      'gone.md': async () => ({ state: 'missing', text: null }),
      'odd.md': async () => ({ state: 'binary', text: null }),
      'down.md': async () => {
        throw new Error('socket closed')
      },
    }
    const t = setup({ file: (_tab, _mode, path) => answers[path]() }, Object.keys(answers).map((path) => file(path)))
    await flush()
    const said: Record<string, string> = {}
    for (const path of Object.keys(answers)) {
      view(q(t.body, `[data-path="${path}"]`), 'Preview').click()
      await flush()
      said[path] = q(t.body, `[data-path="${path}"] .diff-card-body`).textContent ?? ''
    }
    expect(said['big.md']).toContain('too large to preview')
    expect(said['gone.md']).toContain('not there')
    expect(said['odd.md']).toContain('binary')
    expect(said['down.md']).toContain('Could not load the preview: socket closed')
    const card = q(t.body, '[data-path="down.md"]')
    view(card, 'Diff').click()
    expect(card.querySelector('.diff-line')).not.toBeNull()
  })

  it('says an empty file is empty', async () => {
    const t = setup({ file: async () => ({ state: 'ok', text: '' }) }, [doc()])
    await flush()
    const card = q(t.body, '[data-path="docs/guide.md"]')
    view(card, 'Preview').click()
    await flush()
    expect(q(card, '.diff-card-body').textContent).toContain('This file is empty')
  })

  it('does not draw an answer that came after the diff was read again', async () => {
    const releases: Array<(value: DiffFileContent) => void> = []
    const t = setup({ file: () => new Promise<DiffFileContent>((resolve) => void releases.push(resolve)) }, [doc()])
    await flush()
    view(q(t.body, '[data-path="docs/guide.md"]'), 'Preview').click()
    q<HTMLButtonElement>(t.body, '.diff-refresh').click()
    await flush()
    releases[0]({ state: 'ok', text: '# Late' }) // the first card's answer; the refresh made a new card, which asked again
    await flush()
    expect(t.body.textContent).not.toContain('Late')
  })
})
