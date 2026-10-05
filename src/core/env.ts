import fs from 'node:fs'
import path from 'node:path'

// Strip TMUX vars so a server started from inside tmux isn't treated as nested.
export function minimalEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...base }
  delete env.TMUX
  delete env.TMUX_PANE
  return env
}

export function findTmux(env: NodeJS.ProcessEnv): string | null {
  for (const dir of (env.PATH ?? '').split(':')) {
    if (!dir) continue
    const p = path.join(dir, 'tmux')
    try {
      fs.accessSync(p, fs.constants.X_OK)
      return p
    } catch {
      // keep looking
    }
  }
  return null
}
