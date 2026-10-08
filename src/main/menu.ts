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
        { type: 'separator' },
        { label: 'Scratchpad', accelerator: 'CmdOrCtrl+N', click: () => send({ type: 'scratchpad' }) },
        { label: 'Remove Session', accelerator: 'CmdOrCtrl+W', click: () => send({ type: 'closeSession' }) },
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
      submenu: [
        ...Array.from({ length: 9 }, (_, i): MenuItemConstructorOptions => ({
          label: `Session ${i + 1}`,
          accelerator: `CmdOrCtrl+${i + 1}`,
          click: () => send({ type: 'focusIndex', n: i + 1 }),
        })),
        { type: 'separator' },
        { label: 'Last Session', accelerator: 'Ctrl+Tab', click: () => send({ type: 'lastSession' }) },
      ],
    },
  ]
  const view: MenuItemConstructorOptions[] = [
    { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: () => send({ type: 'toggleSidebar' }) },
    { label: 'Project Board', accelerator: 'CmdOrCtrl+Shift+B', click: () => send({ type: 'projectBoard' }) },
    { label: 'Session Diff', accelerator: 'CmdOrCtrl+Alt+B', click: () => send({ type: 'sessionDiff' }) },
    { label: 'Session Grid', accelerator: 'CmdOrCtrl+G', click: () => send({ type: 'toggleGrid' }) },
    { label: 'Add Session to Grid', accelerator: 'CmdOrCtrl+Shift+G', click: () => send({ type: 'addToGrid' }) },
    { label: 'Command Palette', accelerator: 'CmdOrCtrl+K', click: () => send({ type: 'palette' }) },
  ]
  if (!app.isPackaged) view.push({ type: 'separator' }, { role: 'toggleDevTools' }, { role: 'reload' })
  template.push({ label: 'View', submenu: view }, { role: 'windowMenu' }) // minimize and fullscreen, now the window buttons are hidden
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
