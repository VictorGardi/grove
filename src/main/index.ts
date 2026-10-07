import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, Notification } from 'electron'
import { chromeBackground } from '@shared/theme'
import { TmuxBackend } from '../core/backend/tmux'
import { createCore } from '../core/core'
import { findTmux, minimalEnv } from '../core/env'
import { HttpOpenCode, serviceFilePath } from '../core/opencode/client'
import { guardNavigation, handleArtifacts, registerArtifactScheme } from './artifacts'
import { registerIpc } from './ipc'
import { buildMenu } from './menu'

let win: BrowserWindow | null = null

registerArtifactScheme()

app.whenReady().then(async () => {
  const errors: string[] = []
  const tmuxPath = findTmux(process.env)
  if (!tmuxPath) errors.push('tmux not found (looked in PATH, /opt/homebrew/bin, /usr/local/bin)')

  const core = createCore({
    configPath: path.join(os.homedir(), '.config', 'grove', 'config.json'),
    statePath: path.join(app.getPath('userData'), 'state.json'),
    bundledWorkflowPath: path.join(app.getAppPath(), 'resources', 'workflow.yaml'),
    backend: new TmuxBackend({
      tmuxPath: tmuxPath ?? 'tmux',
      socket: 'grove',
      confPath: path.join(app.getAppPath(), 'resources', 'tmux.conf'),
      env: minimalEnv(process.env),
    }),
    sources: [new HttpOpenCode({ serviceFile: serviceFilePath(process.env, os.homedir()) })],
    claudeSpoolDir: path.join(app.getPath('userData'), 'agents', 'claude'),
  })
  await core.start()

  // Unsigned builds can't show these (design D3): `failed` is logged once per run.
  const shown = new Set<Notification>() // held until closed or clicked, or a click may be lost
  let notifyFailed = false
  const BODY = { permission: 'Needs permission', question: 'Has a question', done: 'Finished' }
  core.on('notify', (s) => {
    if (!Notification.isSupported() || !s.waitingFor) return
    const n = new Notification({ title: s.label, body: BODY[s.waitingFor] })
    shown.add(n)
    n.on('close', () => shown.delete(n))
    n.on('click', () => {
      shown.delete(n)
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
      }
      void core.commands.uiSet({ focusedSessionId: s.id })
    })
    n.on('failed', (_e, error) => {
      shown.delete(n)
      if (notifyFailed) return
      notifyFailed = true
      console.error(`notification failed: ${error}`)
    })
    n.show()
  })
  handleArtifacts(core)

  registerIpc(core, () => win, () => [...errors, ...core.getErrors()])
  buildMenu((a) => {
    if (win && !win.isDestroyed()) win.webContents.send('menu:action', a)
  })

  win = new BrowserWindow({
    width: 1200,
    height: 800,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: chromeBackground,
    show: false,
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true },
  })
  guardNavigation(win, core)
  win.once('ready-to-show', () => {
    win?.show()
    core.setWindowFocused(win?.isFocused() ?? false)
  })
  win.on('focus', () => {
    core.setWindowFocused(true)
    void core.checkLiveness()
  })
  win.on('blur', () => core.setWindowFocused(false))
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
