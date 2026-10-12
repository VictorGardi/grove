import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { app, BrowserWindow, dialog, Notification } from 'electron'
import { chromeBackground } from '@shared/theme'
import { TmuxBackend } from '../core/backend/tmux'
import { createCore } from '../core/core'
import type { AgentPaths } from '../core/sandbox/spec'
import { findBin, findTmux, minimalEnv } from '../core/env'
import { SpoolClaude } from '../core/claude/source'
import { HttpOpenCode, serviceFilePath } from '../core/opencode/client'
import { guardNavigation, handleArtifacts, registerArtifactScheme } from './artifacts'
import { registerIpc } from './ipc'
import { startCliServer } from './cliServer'
import { installAgentSkill, installCommandLineTool, writeLauncher } from './launcher'
import { buildMenu } from './menu'
import { installAttachCleanup } from './attachCleanup'

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

async function installSkill(): Promise<void> {
  const home = os.homedir()
  const results = installAgentSkill({
    source: path.join(app.getAppPath(), 'resources', 'skills', 'grove'),
    skillsDirs: [
      path.join(home, '.claude', 'skills'), // Claude Code
      path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'opencode', 'skills'), // OpenCode
    ],
  })
  const failed = results.filter((r) => r.error)
  const opts = failed.length === 0
    ? { message: 'Installed the grove skill', detail: `${results.map((r) => r.target).join('\n')}\n\nAgents now find it in every repo. It links to this app, so updates refresh it.` }
    : { type: 'error' as const, message: 'Could not install the agent skill everywhere', detail: results.map((r) => (r.error ? `✗ ${r.error}` : `✓ ${r.target}`)).join('\n') }
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
  const cliBundle = path.join(app.getAppPath(), 'out', 'main', 'cli.js')
  const launcher = writeLauncher({ binDir, execPath: process.execPath, cliPath: cliBundle, socketPath })
  const spoolDir = path.join(app.getPath('userData'), 'agents', 'claude')
  const home = os.homedir()
  // Everything a sandboxed session's container binds, each at the identical path inside
  // (ADR 0035). Resolved once, here, because only the app knows the Electron paths.
  const agentPaths: AgentPaths = {
    claudeHome: process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), // what Claude's own hooks script resolves
    claudeJson: path.join(home, '.claude.json'),
    opencodeShare: path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'opencode'),
    opencodeConfig: path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'opencode'),
    opencodeState: path.join(process.env.XDG_STATE_HOME || path.join(home, '.local', 'state'), 'opencode'),
    // Two files, same name, different jobs (D6). The registration is the service's own: where it
    // says it can be reached, and the password it wants. The config is where grove writes the
    // address the service should bind. grove reads the registration and never writes it.
    opencodeRegistration: serviceFilePath(process.env, home),
    opencodeServiceConfig: path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'opencode', 'service.json'),
    gitconfig: path.join(home, '.gitconfig'),
    spoolDir,
    socketPath,
    cliBundle,
  }

  const core = createCore({
    sessionEnv: { binDir, ...agentPaths },
    sandbox: { container: 'container', dockerfile: path.join(app.getAppPath(), 'resources', 'sandbox', 'Dockerfile') },
    configPath: path.join(home, '.config', 'grove', 'config.json'),
    statePath: path.join(app.getPath('userData'), 'state.json'),
    commentsPath: path.join(app.getPath('userData'), 'comments.json'),
    bundledWorkflowPath: path.join(app.getAppPath(), 'resources', 'workflow.yaml'),
    backend: new TmuxBackend({
      tmuxPath: tmuxPath ?? 'tmux',
      socket: 'grove',
      confPath: path.join(app.getAppPath(), 'resources', 'tmux.conf'),
      env: minimalEnv(process.env),
    }),
    sources: [new HttpOpenCode({ serviceFile: serviceFilePath(process.env, home) }), new SpoolClaude({ dir: spoolDir })],
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
  }, () => void installCli(launcher), () => void installSkill())

  win = new BrowserWindow({
    width: 1200,
    height: 800,
    titleBarStyle: 'hidden',
    backgroundColor: chromeBackground,
    show: false,
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true },
  })
  win.setWindowButtonVisibility(false)
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
  // Tear down PTY clients for a document navigation/reload, not for artifact iframe navigation.
  installAttachCleanup((onNavigation) => {
    win?.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
      onNavigation(isInPlace, isMainFrame)
    })
  }, killAttaches)
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
