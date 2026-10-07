import fs from 'node:fs'
import path from 'node:path'

// Finder/Dock launches get launchd's PATH (/usr/bin:/bin:/usr/sbin:/sbin), which misses Homebrew.
export const FIXED_DIRS = ['/opt/homebrew/bin', '/usr/local/bin']

// The env for the tmux server and attach clients. Sessions re-read the user's
// full env through loginShellArgv / tmux's login shell (ADR 0010).
export function minimalEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...base }
  // strip TMUX vars so a server started from inside tmux isn't treated as nested
  delete env.TMUX
  delete env.TMUX_PANE
  const dirs = (env.PATH ?? '').split(':').filter(Boolean)
  env.PATH = [...dirs, ...FIXED_DIRS.filter((d) => !dirs.includes(d))].join(':')
  if (!env.LANG) env.LANG = 'en_US.UTF-8'
  return env
}

export function findBin(name: string, env: NodeJS.ProcessEnv, dirs: string[] = FIXED_DIRS): string | null {
  for (const dir of [...(env.PATH ?? '').split(':'), ...dirs]) {
    if (!dir) continue
    const p = path.join(dir, name)
    try {
      fs.accessSync(p, fs.constants.X_OK)
      return p
    } catch {
      // keep looking
    }
  }
  return null
}

export const findTmux = (env: NodeJS.ProcessEnv, dirs?: string[]) => findBin('tmux', env, dirs)

function shellQuote(arg: string): string {
  return /^[A-Za-z0-9_\-./=:@%+,]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`
}

// Each session gets the user's own login-shell env, re-read at every start (ADR 0010).
export function loginShellArgv(argv: string[], shell = process.env.SHELL ?? '/bin/zsh'): string[] {
  return [shell, '-l', '-i', '-c', 'exec ' + argv.map(shellQuote).join(' ')]
}
