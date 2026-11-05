// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOCK_SLIDE_MS, createDock, type DockContext, type DockInstance, type DockPanel } from './dock.ts'
import { DOCK_WIDTH_DEFAULT, DOCK_WIDTH_KEY, DOCK_WIDTH_MAX, DOCK_WIDTH_MIN, DOCK_WIDTH_STEP, clampDockWidth, readDockWidth } from './dock-state.ts'

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), data }
}

function setup(store = memoryStore()) {
  document.body.innerHTML = ''
  const make = <T extends HTMLElement>(tag: string): T => document.body.appendChild(document.createElement(tag)) as T
  const elements = {
    app: make('div'),
    dock: make('aside'),
    title: make('h2'),
    status: make('span'),
    meta: make('span'),
    error: make('p'),
    body: make('div'),
    close: make<HTMLButtonElement>('button'),
    edge: make('div'),
  }
  const widths: number[] = []
  const closed = vi.fn()
  const changes: Array<string | null> = []
  const dock = createDock(elements, { store, applyWidth: (w) => void widths.push(w), closed, changed: (id) => void changes.push(id) })
  const contexts = new Map<string, DockContext>()
  const instances = new Map<string, { destroyed: number; focused: number; allow: boolean }>()
  const panel = (id: string): DockPanel => ({
    id,
    title: `Panel ${id}`,
    mount: (body, context): DockInstance => {
      const state = { destroyed: 0, focused: 0, allow: true }
      instances.set(id, state)
      contexts.set(id, context)
      body.append(Object.assign(document.createElement('div'), { textContent: id }))
      return { focus: () => void state.focused++, destroy: () => void state.destroyed++, canClose: async () => state.allow }
    },
  })
  return { dock, elements, widths, closed, changes, contexts, instances, panel, store }
}

describe('dock state', () => {
  it('clamps and defaults', () => {
    expect(clampDockWidth(10)).toBe(DOCK_WIDTH_MIN)
    expect(clampDockWidth(9999)).toBe(DOCK_WIDTH_MAX)
    expect(clampDockWidth(Number.NaN)).toBe(DOCK_WIDTH_DEFAULT)
    expect(readDockWidth(null)).toBe(DOCK_WIDTH_DEFAULT)
    expect(readDockWidth(memoryStore({ [DOCK_WIDTH_KEY]: '400' }))).toBe(400)
    expect(readDockWidth(memoryStore({ [DOCK_WIDTH_KEY]: 'wide' }))).toBe(DOCK_WIDTH_DEFAULT)
  })
})

describe('dock', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('opens a panel into the body, with its title, and marks the window', async () => {
    const t = setup()
    t.dock.register(t.panel('notes'))
    await t.dock.open('notes')
    expect(t.elements.app.classList.contains('dock-open')).toBe(true)
    expect(t.elements.title.textContent).toBe('Panel notes')
    expect(t.elements.body.textContent).toBe('notes')
    expect(t.instances.get('notes')?.focused).toBe(1)
    expect(t.dock.current()).toBe('notes')
  })

  it('toggles the same panel closed, and hands the keyboard back', async () => {
    const t = setup()
    t.dock.register(t.panel('notes'))
    await t.dock.toggle('notes')
    await t.dock.toggle('notes')
    expect(t.elements.app.classList.contains('dock-open')).toBe(false)
    expect(t.elements.body.children).toHaveLength(1) // still in view while the card slides shut
    expect(t.instances.get('notes')?.destroyed).toBe(0)
    await vi.advanceTimersByTimeAsync(DOCK_SLIDE_MS)
    expect(t.elements.body.children).toHaveLength(0)
    expect(t.instances.get('notes')?.destroyed).toBe(1)
    expect(t.closed).toHaveBeenCalledTimes(1)
    expect(t.changes).toEqual(['notes', null])
    expect(t.dock.current()).toBeNull()
  })

  it('swaps one panel for another without closing the dock', async () => {
    const t = setup()
    t.dock.register(t.panel('notes'))
    t.dock.register(t.panel('diff'))
    await t.dock.open('notes')
    await t.dock.toggle('diff')
    expect(t.instances.get('notes')?.destroyed).toBe(1)
    expect(t.elements.title.textContent).toBe('Panel diff')
    expect(t.elements.body.textContent).toBe('diff')
    expect(t.elements.app.classList.contains('dock-open')).toBe(true)
    expect(t.closed).not.toHaveBeenCalled()
    expect(t.changes).toEqual(['notes', 'diff'])
  })

  it('takes a closed panel down before the next one opens, even inside the slide', async () => {
    const t = setup()
    t.dock.register(t.panel('notes'))
    await t.dock.open('notes')
    await t.dock.close()
    await t.dock.open('notes')
    expect(t.instances.get('notes')?.destroyed).toBe(0) // the new mount replaced the record
    expect(t.elements.body.children).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(DOCK_SLIDE_MS)
    expect(t.elements.body.children).toHaveLength(1)
    expect(t.dock.current()).toBe('notes')
  })

  it('stays open when the panel refuses to close', async () => {
    const t = setup()
    t.dock.register(t.panel('notes'))
    t.dock.register(t.panel('diff'))
    await t.dock.open('notes')
    const state = t.instances.get('notes')!
    state.allow = false
    await expect(t.dock.close()).resolves.toBe(false)
    await t.dock.open('diff')
    expect(t.dock.current()).toBe('notes')
    state.allow = true
    await expect(t.dock.close()).resolves.toBe(true)
  })

  it('closes with the button and with Esc, but not on an Esc a panel handled', async () => {
    const t = setup()
    t.dock.register(t.panel('notes'))
    await t.dock.open('notes')
    const handled = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    handled.preventDefault()
    t.elements.dock.dispatchEvent(handled)
    await vi.advanceTimersByTimeAsync(0)
    expect(t.dock.current()).toBe('notes')
    t.elements.dock.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await vi.advanceTimersByTimeAsync(0)
    expect(t.dock.current()).toBeNull()
    await t.dock.open('notes')
    t.elements.close.click()
    await vi.advanceTimersByTimeAsync(0)
    expect(t.dock.current()).toBeNull()
  })

  it('shows what the open panel says, and ignores a closed panel', async () => {
    const t = setup()
    t.dock.register(t.panel('notes'))
    await t.dock.open('notes')
    const context = t.contexts.get('notes')!
    context.status('Saved')
    context.meta('3 words')
    context.error('Could not save')
    expect([t.elements.status.textContent, t.elements.meta.textContent, t.elements.error.textContent, t.elements.error.hidden]).toEqual(['Saved', '3 words', 'Could not save', false])
    context.error(null)
    expect(t.elements.error.hidden).toBe(true)
    await t.dock.close()
    await vi.advanceTimersByTimeAsync(DOCK_SLIDE_MS)
    context.status('Saved late')
    expect(t.elements.status.textContent).toBe('')
  })

  it('opens at the saved width and keeps a resize from the keyboard', async () => {
    const t = setup(memoryStore({ [DOCK_WIDTH_KEY]: '420' }))
    expect(t.widths.at(-1)).toBe(420)
    t.elements.edge.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }))
    expect(t.widths.at(-1)).toBe(420 + DOCK_WIDTH_STEP)
    expect(t.store.data.get(DOCK_WIDTH_KEY)).toBe(String(420 + DOCK_WIDTH_STEP))
    t.elements.edge.dispatchEvent(new Event('dblclick'))
    expect(t.widths.at(-1)).toBe(DOCK_WIDTH_DEFAULT)
  })
})
