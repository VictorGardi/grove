// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createKeysPanel, KEY_LABELS } from './keys-panel.ts'
import { DEFAULT_VALUES } from '../core/config/schema.ts'
import type { KeyAction } from '../protocol/messages.ts'

describe('keys panel', () => {
  let keys: Record<KeyAction, string>
  let save: Mock<(action: KeyAction, binding: string) => Promise<unknown>>
  let panel: ReturnType<typeof createKeysPanel>
  const chip = (action: KeyAction) => document.querySelector<HTMLButtonElement>(`.keys-chip[data-action="${action}"]`)!
  const error = () => document.getElementById('keys-error')!
  const press = (target: HTMLElement, init: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(event)
    return event
  }
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

  beforeEach(() => {
    document.body.innerHTML = '<ul id="keys-list"></ul><p id="keys-error" hidden></p>'
    keys = { ...DEFAULT_VALUES.keys }
    save = vi.fn(async () => {})
    panel = createKeysPanel(document.getElementById('keys-list')!, error(), { keys: () => keys, defaults: DEFAULT_VALUES.keys, isMac: true, save })
    panel.render()
  })

  it('has a label for every key action and shows each binding as the window shows it', () => {
    expect(Object.keys(KEY_LABELS).sort()).toEqual(Object.keys(DEFAULT_VALUES.keys).sort())
    expect(chip('next-urgent').textContent).toBe('Cmd+.')
    expect(chip('grid-tab').textContent).toBe('Cmd+Shift+G')
  })

  it('saves the combination pressed after a click', async () => {
    chip('next-urgent').click()
    expect(chip('next-urgent').textContent).toBe('Press keys…')
    const event = press(chip('next-urgent'), { key: 'j', code: 'KeyJ', metaKey: true, shiftKey: true })
    expect(event.defaultPrevented).toBe(true)
    await flush()
    expect(save).toHaveBeenCalledWith('next-urgent', 'mod+shift+j')
  })

  it('waits past a modifier alone, and says what a bare key lacks', () => {
    chip('notes').click()
    press(chip('notes'), { key: 'Meta', code: 'MetaLeft', metaKey: true })
    expect(save).not.toHaveBeenCalled()
    expect(error().hidden).toBe(true)
    press(chip('notes'), { key: 'j', code: 'KeyJ' })
    expect(save).not.toHaveBeenCalled()
    expect(error().hidden).toBe(false)
  })

  it('gives up on Esc without letting it reach the settings, and saves nothing', () => {
    const reached = vi.fn()
    document.addEventListener('keydown', reached)
    chip('notes').click()
    press(chip('notes'), { key: 'Escape', code: 'Escape' })
    expect(reached).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(chip('notes').textContent).toBe('Cmd+Shift+N')
  })

  it('does not save the binding the action already has', () => {
    chip('next-urgent').click()
    press(chip('next-urgent'), { key: '.', code: 'Period', metaKey: true })
    expect(save).not.toHaveBeenCalled()
  })

  it("shows the core's reason when it refuses, and keeps the old binding", async () => {
    save.mockRejectedValueOnce(new Error('same binding as grid-toggle'))
    chip('next-urgent').click()
    press(chip('next-urgent'), { key: 'g', code: 'KeyG', metaKey: true })
    await flush()
    expect(error().hidden).toBe(false)
    expect(error().textContent).toBe('Next tab that needs you, or is working: same binding as grid-toggle')
    expect(chip('next-urgent').textContent).toBe('Cmd+.')
  })

  it('offers Reset only for a changed binding, and resets to the default', async () => {
    expect(document.querySelectorAll('.keys-reset')).toHaveLength(0)
    keys = { ...keys, notes: 'mod+j' }
    panel.render()
    const reset = document.querySelector<HTMLButtonElement>('.keys-reset[data-action="notes"]')!
    reset.click()
    await flush()
    expect(save).toHaveBeenCalledWith('notes', DEFAULT_VALUES.keys.notes)
  })
})
