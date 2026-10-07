import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import type { MenuAction } from '@shared/ipc'

export function buildMenu(send: (a: MenuAction) => void, installCli: () => void): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Install Command Line Tool…', click: installCli },
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
        { label: 'New Terminal', accelerator: 'CmdOrCtrl+J', click: () => send({ type: 'newTerminal' }) },
        { label: 'Close Session', accelerator: 'CmdOrCtrl+W', click: () => send({ type: 'closeSession' }) },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
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
  const view: MenuItemConstructorOptions[] = [
    { label: 'Project Board', accelerator: 'CmdOrCtrl+B', click: () => send({ type: 'projectBoard' }) },
    { label: 'Session Diff', accelerator: 'CmdOrCtrl+Alt+B', click: () => send({ type: 'sessionDiff' }) },
    { label: 'Session Grid', accelerator: 'CmdOrCtrl+G', click: () => send({ type: 'toggleGrid' }) },
    { label: 'Command Palette', accelerator: 'CmdOrCtrl+K', click: () => send({ type: 'palette' }) },
  ]
  if (!app.isPackaged) view.push({ type: 'separator' }, { role: 'toggleDevTools' }, { role: 'reload' })
  template.push({ label: 'View', submenu: view })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
