// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DockContext, DockInstance } from './dock.ts'
import { SAVE_DELAY_MS, countWords, createNotesPanel, type NotesDeps } from './notes-panel.ts'

function setup(overrides: Partial<NotesDeps> = {}) {
  const body = document.createElement('div')
  const seen = { status: '', meta: '', error: null as string | null, closes: 0 }
  const context: DockContext = {
    status: (text) => void (seen.status = text),
    meta: (text) => void (seen.meta = text),
    error: (message) => void (seen.error = message),
    close: () => void seen.closes++,
  }
  const editors: Array<{ text: string; handlers: Parameters<NotesDeps['createEditor']>[2]; destroyed: boolean }> = []
  const deps: NotesDeps = {
    read: vi.fn(async () => 'hello'),
    write: vi.fn(async () => ({})),
    createEditor: (_host, text, handlers) => {
      const editor = { text, handlers, destroyed: false }
      editors.push(editor)
      return { focus() {}, destroy: () => void (editor.destroyed = true) }
    },
    ...overrides,
  }
  const panel = createNotesPanel(deps)
  const mount = (): DockInstance => panel.mount(body, context)
  return { panel, mount, body, seen, deps, editors }
}

const flush = () => vi.advanceTimersByTimeAsync(0)

describe('countWords', () => {
  it('counts words and skips bare markdown marks', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('# Title\n\n- one two\n---\n')).toBe(3)
  })
})

describe('notes panel', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('describes itself to the dock', () => {
    const { panel } = setup()
    expect(panel.id).toBe('notes')
    expect(panel.title).toBe('Notes')
  })

  it('loads the page, then mounts the editor with it', async () => {
    const { mount, seen, editors } = setup()
    mount()
    expect(seen.status).toBe('Loading…')
    expect(editors).toHaveLength(0)
    await flush()
    expect(editors.map((e) => e.text)).toEqual(['hello'])
    expect(seen.status).toBe('Saved')
    expect(seen.meta).toBe('1 words')
  })

  it('saves once, a moment after the last key', async () => {
    const { mount, deps, editors, seen } = setup()
    mount()
    await flush()
    editors[0].handlers.onChange('hello w')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 1)
    editors[0].handlers.onChange('hello world')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 1)
    expect(deps.write).not.toHaveBeenCalled()
    expect(seen.status).toBe('Unsaved')
    await vi.advanceTimersByTimeAsync(1)
    expect(deps.write).toHaveBeenCalledTimes(1)
    expect(deps.write).toHaveBeenCalledWith('hello world')
    expect(seen.status).toBe('Saved')
  })

  it('saves what is pending before it may close', async () => {
    const { mount, deps, editors } = setup()
    const instance = mount()
    await flush()
    editors[0].handlers.onChange('edited')
    await expect(instance.canClose?.()).resolves.toBe(true)
    expect(deps.write).toHaveBeenCalledWith('edited')
  })

  it('does not write when nothing changed', async () => {
    const { mount, deps } = setup()
    const instance = mount()
    await flush()
    await instance.canClose?.()
    expect(deps.write).not.toHaveBeenCalled()
  })

  it('asks the dock to close on Esc', async () => {
    const { mount, editors, seen } = setup()
    mount()
    await flush()
    editors[0].handlers.onClose()
    expect(seen.closes).toBe(1)
  })

  it('never writes over a page that failed to load, and may close', async () => {
    const { mount, deps, seen, editors } = setup({ read: vi.fn(async () => Promise.reject(new Error('disk gone'))) })
    const instance = mount()
    await flush()
    expect(editors).toHaveLength(0)
    expect(seen.error).toContain('disk gone')
    await expect(instance.canClose?.()).resolves.toBe(true)
    expect(deps.write).not.toHaveBeenCalled()
  })

  it('refuses to close when the save fails, and a second close discards', async () => {
    const write = vi.fn(async () => Promise.reject(new Error('read-only')))
    const { mount, editors, seen } = setup({ write })
    const instance = mount()
    await flush()
    editors[0].handlers.onChange('keep me')
    await expect(instance.canClose?.()).resolves.toBe(false)
    expect(seen.error).toContain('read-only')
    expect(seen.error).toContain('Close again')
    await expect(instance.canClose?.()).resolves.toBe(true)
  })

  it('writes the latest text when a key lands during a write, one write at a time', async () => {
    let release: () => void = () => {}
    const write = vi.fn(() => new Promise<void>((resolve) => void (release = resolve)))
    const { mount, editors } = setup({ write })
    mount()
    await flush()
    editors[0].handlers.onChange('one')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    expect(write).toHaveBeenCalledTimes(1)
    editors[0].handlers.onChange('one two')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    expect(write).toHaveBeenCalledTimes(1)
    release()
    await flush()
    await flush()
    expect(write).toHaveBeenCalledTimes(2)
    expect(write).toHaveBeenLastCalledWith('one two')
  })

  it('removes its editor and its window listeners when destroyed', async () => {
    const { mount, editors, body, deps } = setup()
    const instance = mount()
    await flush()
    editors[0].handlers.onChange('late')
    instance.destroy()
    expect(editors[0].destroyed).toBe(true)
    expect(body.children).toHaveLength(0)
    window.dispatchEvent(new Event('blur'))
    await flush()
    expect(deps.write).not.toHaveBeenCalled()
  })
})
