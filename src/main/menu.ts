import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import type { MenuAction } from '@shared/ipc'

export function buildMenu(send: (a: MenuAction) => void, installCli: () => void, installSkill: () => void): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Install Command Line Tool…', click: installCli },
        { label: 'Install Agent Skill…', click: installSkill },
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
        // ⌘T picks a checkout and a kind in one keystroke, which is the point of it; this is the
        // configured launch — where the prompt and the worktree are chosen.
        { label: 'New Session with Options…', accelerator: 'CmdOrCtrl+Shift+T', click: () => send({ type: 'newSessionOptions' }) },
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
        { label: 'Next Waiting Session', accelerator: 'CmdOrCtrl+.', click: () => send({ type: 'nextWaiting' }) },
        { label: 'Jump to Parent / Active Child', accelerator: 'CmdOrCtrl+Shift+J', click: () => send({ type: 'familyJump' }) },
      ],
    },
  ]
  const view: MenuItemConstructorOptions[] = [
    { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: () => send({ type: 'toggleSidebar' }) },
    { label: 'Project Board', accelerator: 'CmdOrCtrl+Shift+B', click: () => send({ type: 'projectBoard' }) },
    { label: 'Artifacts', accelerator: 'CmdOrCtrl+Shift+A', click: () => send({ type: 'artifactsBoard' }) },
    { label: 'Session Diff', accelerator: 'CmdOrCtrl+Alt+B', click: () => send({ type: 'sessionDiff' }) },
    { label: 'Session Grid', accelerator: 'CmdOrCtrl+G', click: () => send({ type: 'toggleGrid' }) },
    { label: 'Add Session to Grid', accelerator: 'CmdOrCtrl+Shift+G', click: () => send({ type: 'addToGrid' }) },
    { label: 'Command Palette', accelerator: 'CmdOrCtrl+K', click: () => send({ type: 'palette' }) },
  ]
  if (!app.isPackaged) view.push({ type: 'separator' }, { role: 'toggleDevTools' }, { role: 'reload' })
  template.push({ label: 'View', submenu: view }, { role: 'windowMenu' }) // minimize and fullscreen, now the window buttons are hidden
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
