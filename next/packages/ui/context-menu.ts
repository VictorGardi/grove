// A context menu at the pointer: a short list of actions. A click on an item runs it and closes the menu; Esc, a click
// outside, a scroll and a lost window focus close it. Up and Down move between items and Enter runs the one in focus.
export interface MenuItem {
  label: string
  // The markup of a leading icon, or none.
  icon?: string
  // A line drawn above the item.
  separated?: boolean
  run(): void
}

export interface ContextMenu {
  open(items: MenuItem[], x: number, y: number): void
  isOpen(): boolean
}

export function createContextMenu(host: HTMLElement, deps: { closed(): void }): ContextMenu {
  let menu: HTMLElement | null = null

  function close(): void {
    if (!menu) return
    menu.remove()
    menu = null
    document.removeEventListener('pointerdown', outside, true)
    document.removeEventListener('keydown', key, true)
    window.removeEventListener('blur', close)
    window.removeEventListener('wheel', close, true)
  }

  function outside(event: Event): void {
    if (menu && !menu.contains(event.target as Node)) close()
  }

  function key(event: KeyboardEvent): void {
    if (!menu) return
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button')]
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Escape') {
      close()
      deps.closed()
    } else if (event.key === 'ArrowDown') buttons[(at + 1) % buttons.length]?.focus()
    else if (event.key === 'ArrowUp') buttons[(at - 1 + buttons.length) % buttons.length]?.focus()
    else return
    event.preventDefault()
    event.stopPropagation()
  }

  return {
    open(items, x, y) {
      close()
      const node = document.createElement('div')
      node.className = 'context-menu'
      node.setAttribute('role', 'menu')
      for (const item of items) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = item.separated ? 'context-item separated' : 'context-item'
        button.setAttribute('role', 'menuitem')
        const icon = document.createElement('span')
        icon.className = 'context-icon'
        icon.innerHTML = item.icon ?? ''
        const label = document.createElement('span')
        label.textContent = item.label
        button.append(icon, label)
        button.addEventListener('click', () => {
          close()
          item.run()
        })
        node.append(button)
      }
      host.append(node)
      menu = node
      // Kept inside the window: a menu at the right or bottom edge opens toward the inside.
      const { width, height } = node.getBoundingClientRect()
      node.style.left = `${Math.max(0, Math.min(x, window.innerWidth - width - 4))}px`
      node.style.top = `${Math.max(0, Math.min(y, window.innerHeight - height - 4))}px`
      node.querySelector<HTMLButtonElement>('button')?.focus()
      document.addEventListener('pointerdown', outside, true)
      document.addEventListener('keydown', key, true)
      window.addEventListener('blur', close)
      window.addEventListener('wheel', close, true)
    },
    isOpen: () => menu !== null,
  }
}
