// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createTabPill, type TabPill } from './tab-pill.ts'

describe('tab pill', () => {
  let handlers: { onActivate: Mock<() => void>; onRename: Mock<() => void>; onClose: Mock<() => void> }
  let pill: TabPill
  let strip: HTMLElement

  beforeEach(() => {
    document.body.innerHTML = ''
    strip = document.createElement('div')
    document.body.append(strip)
    handlers = { onActivate: vi.fn(() => {}), onRename: vi.fn(() => {}), onClose: vi.fn(() => {}) }
    pill = createTabPill(document.createElement('span'), handlers)
    strip.append(pill.root)
    pill.update({ name: 'Tab 1', title: 'Space: tab 1', state: 'idle' })
  })

  const label = () => pill.root.querySelector<HTMLElement>('.tab-label')!
  const closeButton = () => pill.root.querySelector<HTMLElement>('.tab-close')!

  // What a double-click does in the browser: two clicks, then a dblclick on the element under the pointer.
  function doubleClick(target: HTMLElement): void {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  }

  it('opens the rename on a double-click on the name', () => {
    doubleClick(label())
    expect(handlers.onRename).toHaveBeenCalledTimes(1)
  })

  it('opens the rename on a double-click anywhere on the pill, outside the close button', () => {
    doubleClick(pill.root)
    expect(handlers.onRename).toHaveBeenCalledTimes(1)
  })

  it('does not open the rename on a double-click on the close button', () => {
    closeButton().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(handlers.onRename).not.toHaveBeenCalled()
  })

  it('still opens the rename after the tab is re-painted between the two clicks', () => {
    label().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(handlers.onActivate).toHaveBeenCalledTimes(1)
    // paint() runs on activate: the same node must still be in the pill, or the second click lands on a detached node.
    pill.update({ name: 'Tab 1', title: 'Space: tab 1', state: 'working' })
    expect(label()).toBe(label())
    label().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    label().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(handlers.onRename).toHaveBeenCalledTimes(1)
  })

  it('closes the tab from the close button only', () => {
    closeButton().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(handlers.onClose).toHaveBeenCalledTimes(1)
    expect(handlers.onActivate).not.toHaveBeenCalled()
  })

  it('shows the name and the state, and keeps the same name element', () => {
    const before = label()
    pill.update({ name: 'docs nav', title: 'Space: docs nav', state: 'needs-you' })
    expect(label()).toBe(before)
    expect(label().textContent).toBe('docs nav')
    expect(pill.root.querySelector('.indicator')?.classList.contains('ind-needs-you')).toBe(true)
  })
})
