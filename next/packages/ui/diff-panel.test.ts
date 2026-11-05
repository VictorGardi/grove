// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiffBases, DiffFile, DiffPrefs, DiffResult } from '../protocol/messages.ts'
import { createDiffPanel, type DiffDeps } from './diff-panel.ts'
import type { DockContext } from './dock.ts'

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

function setup(over: Partial<DiffDeps> = {}, files = [file('src/a.ts'), file('src/b.ts', 'added'), file('top.md', 'untracked', { binary: true, hunks: [] })]) {
  document.body.innerHTML = ''
  const body = document.body.appendChild(document.createElement('div'))
  let prefs: DiffPrefs = { mode: 'branch', base: null, recents: [] }
  const bases: DiffBases = { branches: ['main', 'dev', 'origin/old'], current: 'feature', default: 'main', recents: [] }
  const state = { tab: 'tab1' as string | null, connected: true }
  const get = vi.fn(async (_tab: string, ..._rest: unknown[]) => result(files))
  const setPrefs = vi.fn(async (_tab: string, next: { mode?: DiffPrefs['mode']; base?: string | null }) => (prefs = { ...prefs, ...next }))
  const deps: DiffDeps = {
    tab: () => state.tab,
    connected: () => state.connected,
    get,
    bases: async () => bases,
    prefs: async () => prefs,
    setPrefs,
    ...over,
  }
  const calls = { meta: [] as string[], status: [] as string[], error: [] as Array<string | null> }
  const context: DockContext = { meta: (t) => void calls.meta.push(t), status: (t) => void calls.status.push(t), error: (m) => void calls.error.push(m), close: () => undefined }
  const controller = createDiffPanel(deps)
  const instance = controller.panel.mount(body, context)
  return { body, controller, instance, state, get, setPrefs, calls }
}
const q = <T extends HTMLElement>(root: ParentNode, selector: string): T => root.querySelector(selector) as T

describe('diff panel', () => {
  beforeEach(() => void (document.body.innerHTML = ''))

  it('asks for the active tab by id, with the saved view, and draws the tree and the first file\'s diff', async () => {
    const t = setup()
    await flush()
    expect(t.get).toHaveBeenCalledWith('tab1', 'branch', null, true)
    expect([...t.body.querySelectorAll('.diff-item')].map((e) => (e as HTMLElement).dataset.path)).toEqual(['src/a.ts', 'src/b.ts', 'top.md'])
    expect(q(t.body, '.diff-dir').textContent).toContain('src')
    expect(t.body.querySelector('.diff-line-add .diff-text')?.textContent).toBe('new')
    expect(t.body.querySelector('.diff-line-del .diff-text')?.textContent).toBe('old')
    expect(t.calls.meta.at(-1)).toBe('3')
    expect(q(t.body, '.diff-base').textContent).toBe('Branch · vs main ▾')
  })

  it('says it cannot preview a binary file', async () => {
    const t = setup()
    await flush()
    q(t.body, '[data-path="top.md"]').click()
    expect(t.body.querySelector('.diff-cannot')?.textContent).toBe('Cannot preview this file (binary, too large, or unreadable)')
  })

  it('moves the selection with the arrow keys and shuts a folder with left', async () => {
    const t = setup()
    await flush()
    const tree = q(t.body, '.diff-tree')
    const key = (k: string): void => void tree.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
    expect(q(t.body, '.selected').dataset.path).toBe('src/a.ts')
    key('ArrowDown')
    expect(q(t.body, '.selected').dataset.path).toBe('src/b.ts')
    expect(q(t.body, '.diff-file-path').textContent).toBe('src/b.ts')
    key('ArrowUp')
    key('ArrowUp')
    expect(q(t.body, '.selected').dataset.path).toBe('src')
    key('ArrowLeft')
    expect(q(t.body, '.diff-dir').textContent).toContain('· 2 files')
    expect(t.body.querySelector('[data-path="src/a.ts"]')).toBeNull()
  })

  it('filters the files', async () => {
    const t = setup()
    await flush()
    const input = q<HTMLInputElement>(t.body, '.diff-filter')
    input.value = 'top'
    input.dispatchEvent(new Event('input'))
    expect([...t.body.querySelectorAll('.diff-item')].map((e) => (e as HTMLElement).dataset.path)).toEqual(['top.md'])
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
    expect(t.body.querySelector('.diff-item')).toBeNull()
    t.state.connected = true
    t.controller.connection(true)
    await flush()
    expect(t.body.querySelectorAll('.diff-item')).toHaveLength(3)
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
    expect([...t.body.querySelectorAll('.diff-item')].map((e) => (e as HTMLElement).dataset.path)).toEqual(['fresh.ts'])
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
