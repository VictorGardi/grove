import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { MenuAction } from '@shared/ipc'

const { setApplicationMenu } = vi.hoisted(() => ({ setApplicationMenu: vi.fn() }))
vi.mock('electron', () => ({
  app: { name: 'Grove', isPackaged: true },
  Menu: { buildFromTemplate: vi.fn((t) => t), setApplicationMenu },
}))

import { buildMenu } from './menu'

const items = (xs: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
  xs.flatMap((x) => [x, ...(Array.isArray(x.submenu) ? items(x.submenu) : [])])

function menu() {
  const send = vi.fn<(a: MenuAction) => void>()
  setApplicationMenu.mockClear()
  buildMenu(send, () => {}, () => {})
  const all = items(setApplicationMenu.mock.calls[0][0] as MenuItemConstructorOptions[])
  return { send, all, accelerators: all.flatMap((x) => (x.accelerator ? [String(x.accelerator)] : [])) }
}

describe('buildMenu', () => {
  it('binds ⌘⇧J once, to the family jump', () => {
    const { send, all, accelerators } = menu()
    expect(accelerators.filter((a) => a === 'CmdOrCtrl+Shift+J')).toHaveLength(1)
    const item = all.find((x) => x.accelerator === 'CmdOrCtrl+Shift+J')!
    expect(item.label).toBe('Jump to Parent / Active Child')
    ;(item.click as () => void)()
    expect(send).toHaveBeenCalledWith({ type: 'familyJump' })
  })

  it('keeps every earlier accelerator, none bound twice', () => {
    const { accelerators } = menu()
    const earlier = [
      'CmdOrCtrl+T', 'CmdOrCtrl+Shift+T', 'CmdOrCtrl+J', 'CmdOrCtrl+N', 'CmdOrCtrl+W',
      ...Array.from({ length: 9 }, (_, i) => `CmdOrCtrl+${i + 1}`),
      'Ctrl+Tab', 'CmdOrCtrl+.', 'CmdOrCtrl+B', 'CmdOrCtrl+Shift+B', 'CmdOrCtrl+Alt+B', 'CmdOrCtrl+G', 'CmdOrCtrl+Shift+G', 'CmdOrCtrl+K',
    ]
    for (const a of earlier) expect(accelerators).toContain(a)
    expect(new Set(accelerators).size).toBe(accelerators.length)
  })
})
