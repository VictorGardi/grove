import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow } from 'electron'
import { TmuxBackend } from '../core/backend/tmux'
import { createCore } from '../core/core'
import { findTmux, minimalEnv } from '../core/env'
import { registerIpc } from './ipc'
import { buildMenu } from './menu'

let win: BrowserWindow | null = null

app.whenReady().then(async () => {
  const errors: string[] = []
  const tmuxPath = findTmux(process.env)
  if (!tmuxPath) errors.push('tmux not found (looked in PATH, /opt/homebrew/bin, /usr/local/bin)')

  const core = createCore({
    configPath: path.join(os.homedir(), '.config', 'grove', 'config.json'),
    statePath: path.join(app.getPath('userData'), 'state.json'),
    backend: new TmuxBackend({
      tmuxPath: tmuxPath ?? 'tmux',
      socket: 'grove',
      confPath: path.join(app.getAppPath(), 'resources', 'tmux.conf'),
      env: minimalEnv(process.env),
    }),
  })
  await core.start()

  registerIpc(core, () => win, () => [...errors, ...core.getErrors()])
  buildMenu((a) => {
    if (win && !win.isDestroyed()) win.webContents.send('menu:action', a)
  })

  win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#1e1e1e',
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true },
  })
  win.on('focus', () => void core.checkLiveness())
  win.on('closed', () => {
    win = null
    app.quit()
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))

  app.on('before-quit', () => core.dispose())
})

app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => app.exit(0))
