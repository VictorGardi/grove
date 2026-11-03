import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { app, BrowserWindow, dialog, nativeTheme, Notification } from 'electron'
import { chromeBackground } from '@shared/theme'
import { TmuxBackend } from '../core/backend/tmux'
import { createCore } from '../core/core'
import { findBin, findTmux, minimalEnv } from '../core/env'
import { runLegacySandboxCleanup } from '../core/legacySandboxCleanup'
import { ghLookup } from '../core/pr'
import { claudeRunner } from '../core/classifier'
import { SpoolClaude } from '../core/claude/source'
import { CopilotSource } from '../core/copilot/source'
import { HttpOpenCode, serviceFilePath } from '../core/opencode/client'
import { guardWindow } from './windowGuard'
import { guardNavigation, handleArtifacts, registerArtifactScheme } from './artifacts'
import { registerIpc } from './ipc'
import { cleanStaleWavs, MODEL_BYTES, type WhisperDeps } from '../core/stt/whisper'
import { startCliServer } from './cliServer'
import { agentSkillsDirs, installAgentSkill, installCommandLineTool, writeLauncher } from './launcher'
import { buildMenu } from './menu'
import { installAttachCleanup } from './attachCleanup'
import { createSoundPlayer } from './sound'

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

let loginPathCache: Promise<string> | null = null
const cachedLoginPath = () => (loginPathCache ??= loginPath())

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
    skillsDirs: agentSkillsDirs(home, process.env),
  })
  const failed = results.filter((r) => r.error)
  const opts = failed.length === 0
    ? { message: 'Installed the grove skill', detail: `${results.map((r) => r.target).join('\n')}\n\nAgents now find it in every repo. It links to this app, so updates refresh it.` }
    : { type: 'error' as const, message: 'Could not install the agent skill everywhere', detail: results.map((r) => (r.error ? `✗ ${r.error}` : `✓ ${r.target}`)).join('\n') }
  await (win && !win.isDestroyed() ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts))
}

app.whenReady().then(async () => {
  if (!gotLock) return
  // the UI is dark-only; pin the appearance so the window vibrancy is the dark material even in system Light mode
  nativeTheme.themeSource = 'dark'
  const errors: string[] = []
  const tmuxPath = findTmux(process.env)
  if (!tmuxPath) errors.push('tmux not found (looked in PATH, /opt/homebrew/bin, /usr/local/bin)')
  const ghPath = findBin('gh', process.env) // null: no PR markers, no banner
  const claudePath = findBin('claude', process.env) // null: finished sessions are not read by a small model
  const gitPath = findBin('git', process.env) // null: the diff viewer says so, no banner

  const socketPath = path.join(app.getPath('userData'), 'grove.sock')
  const binDir = path.join(app.getPath('userData'), 'bin')
  const cliBundle = path.join(app.getAppPath(), 'out', 'main', 'cli.js')
  const launcher = writeLauncher({ binDir, execPath: process.execPath, cliPath: cliBundle, socketPath })
  const spoolDir = path.join(app.getPath('userData'), 'agents', 'claude')
  const copilotDir = path.join(app.getPath('userData'), 'agents', 'copilot')
  const home = os.homedir()
  const core = createCore({
    sessionEnv: { binDir, socketPath },
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
    sources: [new HttpOpenCode({ serviceFile: serviceFilePath(process.env, home) }), new SpoolClaude({ dir: spoolDir }), new CopilotSource({ dir: copilotDir })],
    git: gitPath,
    classifierRun: claudePath ? claudeRunner(claudePath, minimalEnv(process.env)) : undefined,
    prLookup: ghPath ? ghLookup(ghPath, minimalEnv(process.env)) : undefined,
  })
  await core.start()
  // One-time sweep of leftovers from the removed feature; not awaited so startup stays fast.
  void runLegacySandboxCleanup({
    container: findBin('container', process.env) ?? 'container', // a GUI launch has a minimal PATH
    markerPath: path.join(app.getPath('userData'), 'sandbox-cleanup.done'),
    configFile: path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'opencode', 'service.json'),
  }).catch(() => {})
  const cliServer = await startCliServer(core, { socketPath, raise }).catch((e: Error) => {
    errors.push(`grove CLI: ${e.message}`)
    return null
  })

  // Unsigned builds can't show these (design D3): `failed` is logged once per run.
  const shown = new Set<Notification>() // held until closed or clicked, or a click may be lost
  let notifyFailed = false
  const BODY = { permission: 'Needs permission', question: 'Has a question', done: 'Finished' }
  const playSound = createSoundPlayer((file) => execFile('/usr/bin/afplay', [file], () => {}))
  core.on('notify', (s) => {
    if (process.platform === 'darwin' && core.soundsOn()) playSound(s)
    if (!Notification.isSupported() || !s.waitingFor) return
    const n = new Notification({ title: s.label, body: s.attention?.reason ?? BODY[s.waitingFor] })
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

  // whisper-cli lives on the login shell's PATH (e.g. Homebrew), which a GUI launch lacks. Resolved once, off the startup path.
  let whisperBin: string | null = null
  const sttDir = path.join(app.getPath('userData'), 'stt')
  const sttDeps = {
    execFile: promisify(execFile) as unknown as WhisperDeps['execFile'],
    whisperBin: () => whisperBin ?? findBin('whisper-cli', process.env),
    modelPath: path.join(sttDir, 'ggml-base.en.bin'),
    tmpDir: path.join(sttDir, 'tmp'),
  }
  cleanStaleWavs(sttDeps.tmpDir)
  const { killAttaches } = registerIpc(core, () => win, () => [...errors, ...core.getErrors()], sttDeps)
  // The dictation hint reflects whisper-cli + model presence, checked at launch only, never polled.
  let dictationReady = false
  const rebuildMenu = (): void => buildMenu((a) => {
    if (win && !win.isDestroyed()) win.webContents.send('menu:action', a)
  }, () => void installCli(launcher), () => void installSkill(), { ready: dictationReady })
  rebuildMenu()
  void cachedLoginPath().then((p) => {
    whisperBin = findBin('whisper-cli', { PATH: p })
    const modelSize = (() => { try { return fs.statSync(sttDeps.modelPath).size } catch { return -1 } })()
    dictationReady = whisperBin !== null && modelSize === MODEL_BYTES
    rebuildMenu()
  })

  win = new BrowserWindow({
    width: 1200,
    height: 800,
    titleBarStyle: 'hidden',
    // macOS: a vibrancy layer behind a transparent page, so the chrome around the terminals is frosted glass
    ...(process.platform === 'darwin'
      ? { vibrancy: 'under-window' as const, visualEffectState: 'active' as const, backgroundColor: '#00000000' }
      : { backgroundColor: chromeBackground }),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })
  win.setWindowButtonVisibility(false)
  // Permissions (microphone for dictation, clipboard write for terminal copy) are decided in guardWindow.
  guardNavigation(win, core)
  guardWindow(win, process.env.ELECTRON_RENDERER_URL)
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
