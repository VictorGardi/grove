import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import type { MenuAction } from '@shared/ipc'

export function buildMenu(send: (a: MenuAction) => void): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Session', accelerator: 'CmdOrCtrl+T', click: () => send({ type: 'newSession' }) },
      ],
    },
  ]
  if (!app.isPackaged) {
    template.push({ label: 'View', submenu: [{ role: 'toggleDevTools' }, { role: 'reload' }] })
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
