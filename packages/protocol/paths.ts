import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const MAX_SOCKET_PATH_BYTES = 100

// The app was called grove-next and kept its state in ~/.grove-next. Each entry moves into the new home unless it is
// already there, so ~/.grove's other files (worktrees/) are left alone.
function migrateLegacyHome(home: string): void {
  const legacy = path.join(os.homedir(), '.grove-next')
  if (!fs.existsSync(legacy)) return
  fs.mkdirSync(home, { recursive: true, mode: 0o700 })
  for (const name of fs.readdirSync(legacy)) {
    const target = path.join(home, name)
    if (!fs.existsSync(target)) fs.renameSync(path.join(legacy, name), target)
  }
  try {
    fs.rmdirSync(legacy)
  } catch {}
}

export function groveHome(): string {
  const override = process.env.GROVE_HOME
  const home = override || path.join(os.homedir(), '.grove')
  if (!override) migrateLegacyHome(home)
  fs.mkdirSync(home, { recursive: true, mode: 0o700 })
  fs.chmodSync(home, 0o700)
  return home
}

function socketPath(name: string): string {
  const full = path.join(groveHome(), name)
  const bytes = Buffer.byteLength(full)
  if (bytes >= MAX_SOCKET_PATH_BYTES) {
    throw new Error(
      `socket path is ${bytes} bytes, over the ${MAX_SOCKET_PATH_BYTES}-byte limit: ${full}. Set GROVE_HOME to a shorter directory.`,
    )
  }
  return full
}

export function coreSocketPath(): string {
  return socketPath('s')
}

export function holderSocketPath(): string {
  return socketPath('h')
}
