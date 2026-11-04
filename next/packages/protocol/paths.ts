import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const MAX_SOCKET_PATH_BYTES = 100

export function groveNextHome(): string {
  const home = process.env.GROVE_NEXT_HOME || path.join(os.homedir(), '.grove-next')
  fs.mkdirSync(home, { recursive: true, mode: 0o700 })
  fs.chmodSync(home, 0o700)
  return home
}

function socketPath(name: string): string {
  const full = path.join(groveNextHome(), name)
  const bytes = Buffer.byteLength(full)
  if (bytes >= MAX_SOCKET_PATH_BYTES) {
    throw new Error(
      `socket path is ${bytes} bytes, over the ${MAX_SOCKET_PATH_BYTES}-byte limit: ${full}. Set GROVE_NEXT_HOME to a shorter directory.`,
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
