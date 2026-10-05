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
        { label: 'Close Session', accelerator: 'CmdOrCtrl+W', click: () => send({ type: 'closeSession' }) },
      ],
    },
    {
      label: 'Session',
      submenu: Array.from({ length: 9 }, (_, i) => ({
        label: `Session ${i + 1}`,
        accelerator: `CmdOrCtrl+${i + 1}`,
        click: () => send({ type: 'focusIndex', n: i + 1 }),
      })),
    },
  ]
  if (!app.isPackaged) {
    template.push({ label: 'View', submenu: [{ role: 'toggleDevTools' }, { role: 'reload' }] })
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
