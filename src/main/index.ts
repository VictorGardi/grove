import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { app, BrowserWindow, dialog, Notification } from 'electron'
import { chromeBackground } from '@shared/theme'
import { TmuxBackend } from '../core/backend/tmux'
import { createCore } from '../core/core'
import { findBin, findTmux, minimalEnv } from '../core/env'
import { SpoolClaude } from '../core/claude/source'
import { HttpOpenCode, serviceFilePath } from '../core/opencode/client'
import { guardNavigation, handleArtifacts, registerArtifactScheme } from './artifacts'
import { registerIpc } from './ipc'
import { startCliServer } from './cliServer'
import { installCommandLineTool, writeLauncher } from './launcher'
import { buildMenu } from './menu'

let win: BrowserWindow | null = null

registerArtifactScheme()

// A second launch focuses the first instead of starting a second app (ADR 0027).
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

function raise(): void {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}
app.on('second-instance', raise)

// The PATH a new terminal would have: a GUI app's own is minimal.
const loginPath = () => new Promise<string>((resolve) => {
  execFile(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf %s "$PATH"'], { timeout: 5000 }, (err, out) => resolve(err ? process.env.PATH ?? '' : out))
})

async function installCli(launcher: string): Promise<void> {
  const targetDir = path.join(os.homedir(), '.local', 'bin')
  const res = installCommandLineTool({ launcher, targetDir, pathVar: await loginPath() })
  const opts = res.ok
    ? {
        message: `Installed ${res.target}`,
        detail: res.onPath ? 'Open a new terminal and run `grove ls`.' : `${targetDir} is not on your PATH. Add it to your shell profile to run \`grove\` from any terminal.`,
      }
    : { type: 'error' as const, message: 'Could not install the command line tool', detail: res.message }
  await (win && !win.isDestroyed() ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts))
}

app.whenReady().then(async () => {
  if (!gotLock) return
  const errors: string[] = []
  const tmuxPath = findTmux(process.env)
  if (!tmuxPath) errors.push('tmux not found (looked in PATH, /opt/homebrew/bin, /usr/local/bin)')
  const gitPath = findBin('git', process.env) // null: the diff viewer says so, no banner

  const socketPath = path.join(app.getPath('userData'), 'grove.sock')
  const binDir = path.join(app.getPath('userData'), 'bin')
  const launcher = writeLauncher({ binDir, execPath: process.execPath, cliPath: path.join(app.getAppPath(), 'out', 'main', 'cli.js'), socketPath })

  const core = createCore({
    sessionEnv: { socketPath, binDir },
    configPath: path.join(os.homedir(), '.config', 'grove', 'config.json'),
    statePath: path.join(app.getPath('userData'), 'state.json'),
    commentsPath: path.join(app.getPath('userData'), 'comments.json'),
    bundledWorkflowPath: path.join(app.getAppPath(), 'resources', 'workflow.yaml'),
    backend: new TmuxBackend({
      tmuxPath: tmuxPath ?? 'tmux',
      socket: 'grove',
      confPath: path.join(app.getAppPath(), 'resources', 'tmux.conf'),
      env: minimalEnv(process.env),
    }),
    sources: [
      new HttpOpenCode({ serviceFile: serviceFilePath(process.env, os.homedir()) }),
      new SpoolClaude({ dir: path.join(app.getPath('userData'), 'agents', 'claude') }),
    ],
    git: gitPath,
  })
  await core.start()
  const cliServer = await startCliServer(core, { socketPath, raise }).catch((e: Error) => {
    errors.push(`grove CLI: ${e.message}`)
    return null
  })

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
      raise()
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

  const { killAttaches } = registerIpc(core, () => win, () => [...errors, ...core.getErrors()])
  buildMenu((a) => {
    if (win && !win.isDestroyed()) win.webContents.send('menu:action', a)
  }, () => void installCli(launcher))

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
  // a reload leaves the old page's attaches behind (ADR 0030)
  win.webContents.on('did-start-loading', killAttaches)
  win.on('closed', () => {
    killAttaches()
    win = null
    app.quit()
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))

  app.on('before-quit', () => {
    cliServer?.close()
    core.dispose()
  })
})

app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => app.exit(0))
