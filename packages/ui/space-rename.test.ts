// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { bindSpaceRename } from './space-rename.ts'

describe('space rename', () => {
  it('recognizes a double-click when the first click rebuilds the space list', () => {
    const list = document.createElement('ul')
    const rename = vi.fn()
    const spaceButton = (): HTMLButtonElement => {
      const button = document.createElement('button')
      button.className = 'space'
      button.dataset.spaceId = 'space-1'
      const name = document.createElement('span')
      name.className = 'space-name'
      name.textContent = 'grove'
      button.append(name)
      return button
    }

    list.replaceChildren(spaceButton())
    bindSpaceRename(list, rename)
    list.querySelector('.space')?.addEventListener('click', () => list.replaceChildren(spaceButton()))

    list.querySelector('.space-name')?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    list.querySelector('.space-name')?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }))

    expect(rename).toHaveBeenCalledWith('space-1')
  })
})
