// Grove Electron spike: menu accelerators, xterm.js + node-pty + tmux + OpenCode,
// env under LaunchServices, userData paths. Facts-gathering only.
const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// ---- args (also passed through `open x.app --args ...`) ----
const arg = (name, def) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const DEFAULT_LOG_DIR =
  '/tmp/grove-espike';
const LOG_DIR = arg('log-dir', process.env.SPIKE_LOG_DIR || DEFAULT_LOG_DIR);
const LABEL = arg('label', app.isPackaged ? 'packaged' : 'dev');
const SESSION = arg('session', 'keys'); // keys | oc | none
const PREVENT = arg('prevent', 'none'); // none | renderer | bie | ignore
const AUTOTEST = arg('autotest', '0') === '1';
const SEND_KEYS = arg('keys', '1') === '1';
const QUIT_AFTER = Number(arg('quit-after', '0'));
const PTY_COLORTERM = arg('pty-colorterm', 'truecolor'); // '' to omit
const SOCK = 'grove-espike';
const CFG = path.join(__dirname, 'tmux.conf').replace('app.asar', 'app.asar.unpacked');

fs.mkdirSync(LOG_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const LOG = path.join(LOG_DIR, `${LABEL}-${stamp}.log`);
const log = (kind, data) =>
  fs.appendFileSync(LOG, JSON.stringify({ t: Date.now(), kind, data }) + '\n');

log('args', { argv: process.argv, LABEL, SESSION, PREVENT, AUTOTEST, CFG });
log('versions', process.versions);
log('env', process.env);
log('paths-before-redirect', {
  name: app.getName(),
  isPackaged: app.isPackaged,
  userData: app.getPath('userData'),
  appData: app.getPath('appData'),
  sessionData: app.getPath('sessionData'),
  logs: app.getPath('logs'),
  home: os.homedir(),
  dotConfig: path.join(os.homedir(), '.config'),
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME ?? null,
  tmpdir: os.tmpdir(),
});
// Redirect Chromium data so the spike never writes into an existing userData dir.
app.setPath('userData', path.join(LOG_DIR, `userdata-${LABEL}`));
log('paths-after-redirect', { userData: app.getPath('userData'), sessionData: app.getPath('sessionData') });

// ---- tool reachability from this process's env ----
const sh = (cmd, env = process.env) => {
  try {
    return execFileSync('/bin/sh', ['-c', cmd], { env, encoding: 'utf8', timeout: 15000 }).trim();
  } catch (e) {
    return `ERR status=${e.status} out=${(e.stdout || '').trim()} err=${(e.stderr || '').trim()}`;
  }
};
log('which', {
  sh_command_v: sh('command -v tmux; command -v opencode; echo "exit=$?"'),
  tmux_abs: fs.existsSync('/opt/homebrew/bin/tmux'),
  opencode_abs: fs.existsSync('/opt/homebrew/bin/opencode'),
  launchctl_PATH: sh('/bin/launchctl getenv PATH'),
});

let TMUX = sh('command -v tmux');
if (!TMUX.startsWith('/')) TMUX = '/opt/homebrew/bin/tmux';
log('tmux-binary', { TMUX });

const tmux = (...args) => {
  try {
    return execFileSync(TMUX, ['-L', SOCK, '-f', CFG, ...args], { encoding: 'utf8', timeout: 15000 }).trim();
  } catch (e) {
    return `ERR status=${e.status} ${(e.stderr || '').trim()}`;
  }
};

// ---- node-pty load ----
let pty = null;
try {
  pty = require('node-pty');
  const p = require.resolve('node-pty');
  const dir = path.dirname(path.dirname(p));
  const helper = path.join(dir, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper').replace('app.asar', 'app.asar.unpacked');
  let mode = null;
  try { mode = (fs.statSync(helper).mode & 0o777).toString(8); } catch (e) { mode = String(e); }
  log('node-pty-load', { ok: true, resolved: p, buildRelease: fs.existsSync(path.join(dir, 'build/Release').replace('app.asar', 'app.asar.unpacked')), helper, helperMode: mode });
} catch (e) {
  log('node-pty-load', { ok: false, error: String(e && e.stack) });
}

function setupTmux() {
  const envOut = path.join(LOG_DIR, `${LABEL}-${stamp}-tmux-session-env.txt`);
  const keysOut = path.join(LOG_DIR, `${LABEL}-${stamp}-inner-keys.log`);
  const ocDir = path.join(LOG_DIR, 'ocproj');
  fs.mkdirSync(ocDir, { recursive: true });
  tmux('kill-server');
  // 1) env dump: what a tmux server started by this process passes to new sessions
  const r1 = tmux('new-session', '-d', '-s', 'envdump', '-x', '120', '-y', '40',
    `env > '${envOut}'; echo "--- command -v:" >> '${envOut}'; command -v tmux opencode >> '${envOut}' 2>&1; echo "exit=$?" >> '${envOut}'; sleep 600`);
  // 2) key logger: hex of bytes tmux delivers to the inner program
  const keylogger = path.join(__dirname, 'keylog.py').replace('app.asar', 'app.asar.unpacked');
  const r2 = tmux('new-session', '-d', '-s', 'keys', '-x', '120', '-y', '40', `/usr/bin/python3 '${keylogger}' '${keysOut}'`);
  // 3) opencode with COLORTERM=truecolor
  const r3 = tmux('new-session', '-d', '-s', 'oc', '-x', '120', '-y', '40', '-e', 'COLORTERM=truecolor', '-c', ocDir, `opencode '${ocDir}'`);
  log('tmux-setup', { r1, r2, r3, envOut, keysOut, sessions: tmux('list-sessions'),
    global_env_PATH: tmux('show-environment', '-g', 'PATH'), global_env_COLORTERM: tmux('show-environment', '-g', 'COLORTERM'),
    oc_env_COLORTERM: tmux('show-environment', '-t', 'oc', 'COLORTERM'),
    terminal_features: tmux('show-options', '-s', 'terminal-features'), extended_keys: tmux('show-options', '-s', 'extended-keys'),
    default_terminal: tmux('show-options', '-g', 'default-terminal') });
}

let term = null;
function attach(win) {
  if (!pty || SESSION === 'none') return;
  const env = { ...process.env, TERM: 'xterm-256color' };
  if (PTY_COLORTERM) env.COLORTERM = PTY_COLORTERM; else delete env.COLORTERM;
  delete env.TMUX;
  log('pty-env', { TERM: env.TERM, COLORTERM: env.COLORTERM ?? null, LANG: env.LANG ?? null, LC_ALL: env.LC_ALL ?? null });
  try {
    term = pty.spawn(TMUX, ['-L', SOCK, '-f', CFG, 'attach', '-t', SESSION], { name: 'xterm-256color', cols: 120, rows: 40, cwd: os.homedir(), env });
    log('pty-spawn', { ok: true, pid: term.pid });
  } catch (e) {
    log('pty-spawn', { ok: false, error: String(e && e.stack) });
    return;
  }
  let outBytes = 0, rgbFg = 0, rgbBg = 0, idx256 = 0;
  term.onData((d) => {
    outBytes += d.length;
    rgbFg += (d.match(/\x1b\[[0-9;:]*38[;:]2[;:]/g) || []).length;
    rgbBg += (d.match(/\x1b\[[0-9;:]*48[;:]2[;:]/g) || []).length;
    idx256 += (d.match(/\x1b\[[0-9;:]*38;5;/g) || []).length;
    if (!win.isDestroyed()) win.webContents.send('pty-out', d);
  });
  term.onExit((e) => log('pty-exit', e));
  setInterval(() => log('pty-out-stats', { outBytes, rgbFg, rgbBg, idx256 }), 3000).unref();
}

ipcMain.on('pty-in', (_e, d) => {
  log('pty-in', { hex: Buffer.from(d, 'utf8').toString('hex'), json: JSON.stringify(d) });
  if (term) term.write(d);
});
ipcMain.on('pty-resize', (_e, { cols, rows }) => term && term.resize(cols, rows));
ipcMain.on('rlog', (_e, kind, data) => log('renderer:' + kind, data));
ipcMain.handle('cfg', () => ({ PREVENT, LABEL }));

function buildMenu() {
  const item = (label, accelerator) => ({ label, accelerator, click: (_mi, _w, ev) => log('menu-click', { label, accelerator, triggeredByAccelerator: ev && ev.triggeredByAccelerator }) });
  const tabs = [];
  for (let i = 1; i <= 9; i++) tabs.push(item(`Tab ${i}`, `CmdOrCtrl+${i}`));
  return Menu.buildFromTemplate([
    { label: 'grove', submenu: [
      { label: 'Quit (logged)', accelerator: 'CmdOrCtrl+Q', click: (_mi, _w, ev) => { log('menu-click', { label: 'Quit', accelerator: 'CmdOrCtrl+Q', triggeredByAccelerator: ev && ev.triggeredByAccelerator }); if (!AUTOTEST) app.quit(); } },
    ] },
    { label: 'File', submenu: [item('New Tab', 'CmdOrCtrl+T'), item('Close Tab', 'CmdOrCtrl+W')] },
    { label: 'Edit', submenu: [{ role: 'copy' }, { role: 'paste' }] },
    { label: 'Tabs', submenu: tabs },
  ]);
}

// synthetic key events: [label, keyCode, modifiers, charToSend|null]
const KEYS = [
  ['Enter', 'Enter', [], '\r'], ['Shift+Enter', 'Enter', ['shift'], '\r'], ['Alt+Enter', 'Enter', ['alt'], '\r'],
  ['Ctrl+Enter', 'Enter', ['control'], null], ['Esc', 'Escape', [], null], ['(gap 1500ms)', null, [], null], ['x', 'x', [], 'x'], ['Esc', 'Escape', [], null], ['(gap 1500ms)', null, [], null], ['Tab', 'Tab', [], '\t'], ['Shift+Tab', 'Tab', ['shift'], null],
  ['Alt+b', 'b', ['alt'], '∫'], ['Alt+f', 'f', ['alt'], 'ƒ'], ['Alt+Backspace', 'Backspace', ['alt'], null], ['Alt+Left', 'Left', ['alt'], null],
  ['Ctrl+a', 'a', ['control'], null], ['Ctrl+c', 'c', ['control'], null], ['Ctrl+p', 'p', ['control'], null], ['Ctrl+x', 'x', ['control'], null],
  ['Ctrl+j', 'j', ['control'], null], ['Ctrl+Left', 'Left', ['control'], null], ['Up', 'Up', [], null],
  ['Cmd+T', 't', ['meta'], null], ['Cmd+W', 'w', ['meta'], null], ['Cmd+1', '1', ['meta'], null], ['Cmd+9', '9', ['meta'], null], ['Cmd+Q', 'q', ['meta'], null],
];
async function autotest(win) {
  const wc = win.webContents;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(2500);
  win.focus(); wc.focus();
  if (!SEND_KEYS) { await wait(6000); return; }
  for (const [label, keyCode, modifiers, ch] of KEYS) {
    log('synthetic-send', { label });
    if (!keyCode) { await wait(1500); continue; }
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (ch) wc.sendInputEvent({ type: 'char', keyCode: ch, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await wait(400);
  }
  await wait(1000);
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(buildMenu());
  if (SESSION !== 'none' || AUTOTEST) setupTmux();
  const win = new BrowserWindow({ width: 1100, height: 760, webPreferences: { preload: path.join(__dirname, 'preload.js') } });
  win.webContents.on('before-input-event', (event, input) => {
    log('before-input-event', input);
    if (PREVENT === 'bie' && input.meta && input.type === 'keyDown') { event.preventDefault(); log('bie-preventDefault', { key: input.key }); }
  });
  if (PREVENT === 'ignore') win.webContents.setIgnoreMenuShortcuts(true);
  win.webContents.on('console-message', (e) => log('console', { message: e.message }));
  await win.loadFile('index.html');
  attach(win);
  if (AUTOTEST) {
    await autotest(win);
    if (SESSION === 'oc') {
      await new Promise((r) => setTimeout(r, 4000));
      log('oc-capture-pane-rgb-count', { n: (tmux('capture-pane', '-e', '-p', '-t', 'oc').match(/38;2;/g) || []).length });
      log('oc-capture-pane-head', tmux('capture-pane', '-p', '-t', 'oc').split('\n').slice(0, 12));
    }
    const img = await win.webContents.capturePage();
    fs.writeFileSync(LOG.replace(/\.log$/, '.png'), img.toPNG());
    win.webContents.send('report');
    await new Promise((r) => setTimeout(r, 1500));
    if (term) term.kill();
    tmux('kill-server');
    log('done', {});
    app.exit(0);
    setTimeout(() => process.exit(0), 500);
  }
  if (QUIT_AFTER > 0) setTimeout(() => { tmux('kill-server'); log('done', {}); app.exit(0); }, QUIT_AFTER);
});
app.on('will-quit', () => { log('will-quit', {}); tmux('kill-server'); });
