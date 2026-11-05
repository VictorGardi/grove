// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createRenameModal, type RenameModal } from './rename-modal.ts'

const MODAL = `
  <div id="rename-modal" class="modal-backdrop" hidden>
    <form id="rename-form" class="modal">
      <h2>Rename tab</h2>
      <input id="rename-input" type="text" maxlength="80" />
      <p id="rename-error" hidden></p>
      <button id="rename-cancel" type="button">Cancel</button>
      <button id="rename-save" type="submit">Save</button>
    </form>
  </div>`

describe('rename modal', () => {
  let modal: RenameModal
  let rename: Mock<(id: string, label: string) => Promise<unknown>>
  let renamed: Mock<(id: string, label: string) => void>
  let closed: Mock<() => void>
  const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
  const isHidden = () => el('rename-modal').hidden

  beforeEach(() => {
    document.body.innerHTML = MODAL
    rename = vi.fn(async (_id: string, _label: string) => ({}))
    renamed = vi.fn((_id: string, _label: string) => {})
    closed = vi.fn(() => {})
    modal = createRenameModal(
      {
        modal: el('rename-modal'),
        form: el<HTMLFormElement>('rename-form'),
        input: el<HTMLInputElement>('rename-input'),
        cancel: el<HTMLButtonElement>('rename-cancel'),
        error: el('rename-error'),
      },
      { rename, renamed, closed },
    )
  })

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
  const enter = () => el('rename-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  const escape = (target: HTMLElement) => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

  it('opens with the saved name, or empty with the number as placeholder', () => {
    modal.open({ id: 't1', label: 'api fix', number: 2 })
    expect(isHidden()).toBe(false)
    expect(el<HTMLInputElement>('rename-input').value).toBe('api fix')
    expect(modal.isOpen()).toBe(true)

    modal.open({ id: 't2', label: null, number: 3 })
    expect(el<HTMLInputElement>('rename-input').value).toBe('')
    expect(el<HTMLInputElement>('rename-input').placeholder).toBe('Tab 3')
  })

  it('Enter saves the trimmed name, then closes', async () => {
    modal.open({ id: 't1', label: null, number: 1 })
    el<HTMLInputElement>('rename-input').value = '  build pricing  '
    enter()
    await flush()
    expect(rename).toHaveBeenCalledWith('t1', 'build pricing')
    expect(renamed).toHaveBeenCalledWith('t1', 'build pricing')
    expect(isHidden()).toBe(true)
    expect(closed).toHaveBeenCalledTimes(1)
    expect(modal.isOpen()).toBe(false)
  })

  it('Save saves and closes, through the form submit', async () => {
    modal.open({ id: 't1', label: null, number: 1 })
    el<HTMLInputElement>('rename-input').value = 'docs nav'
    el('rename-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flush()
    expect(rename).toHaveBeenCalledWith('t1', 'docs nav')
    expect(isHidden()).toBe(true)
  })

  it('an empty name is sent as an empty label, which clears the name', async () => {
    modal.open({ id: 't1', label: 'old', number: 1 })
    el<HTMLInputElement>('rename-input').value = '   '
    enter()
    await flush()
    expect(rename).toHaveBeenCalledWith('t1', '')
    expect(renamed).toHaveBeenCalledWith('t1', '')
    expect(isHidden()).toBe(true)
  })

  it('Esc cancels without saving', async () => {
    modal.open({ id: 't1', label: null, number: 1 })
    el<HTMLInputElement>('rename-input').value = 'nope'
    escape(el('rename-input'))
    await flush()
    expect(rename).not.toHaveBeenCalled()
    expect(isHidden()).toBe(true)
    expect(closed).toHaveBeenCalledTimes(1)
  })

  it('Cancel and a click on the backdrop cancel without saving', async () => {
    modal.open({ id: 't1', label: null, number: 1 })
    el('rename-cancel').click()
    expect(isHidden()).toBe(true)

    modal.open({ id: 't1', label: null, number: 1 })
    el('rename-modal').click()
    expect(isHidden()).toBe(true)
    await flush()
    expect(rename).not.toHaveBeenCalled()
  })

  it('a failed save keeps the modal open and says why inside it', async () => {
    rename.mockRejectedValueOnce(new Error('unknown method tabs.rename'))
    modal.open({ id: 't1', label: null, number: 1 })
    el<HTMLInputElement>('rename-input').value = 'build pricing'
    enter()
    await flush()
    expect(isHidden()).toBe(false)
    expect(el('rename-error').hidden).toBe(false)
    expect(el('rename-error').textContent).toBe('Could not save the name: unknown method tabs.rename')
    expect(renamed).not.toHaveBeenCalled()
    expect(modal.isOpen()).toBe(true)
  })

  it('the next open clears an old error', async () => {
    rename.mockRejectedValueOnce(new Error('boom'))
    modal.open({ id: 't1', label: null, number: 1 })
    enter()
    await flush()
    modal.open({ id: 't1', label: null, number: 1 })
    expect(el('rename-error').hidden).toBe(true)
    expect(el('rename-error').textContent).toBe('')
  })
})
