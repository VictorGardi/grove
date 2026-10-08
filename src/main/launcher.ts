import fs from 'node:fs'
import path from 'node:path'

// `grove` runs the CLI bundle on the app's own Electron binary as Node (ADR 0028). Rewritten at every start.
export function writeLauncher(o: { binDir: string; execPath: string; cliPath: string; socketPath: string }): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
  const file = path.join(o.binDir, 'grove')
  fs.mkdirSync(o.binDir, { recursive: true })
  fs.writeFileSync(
    file,
    `#!/bin/sh\n[ -n "$GROVE_SOCKET" ] || GROVE_SOCKET=${q(o.socketPath)}\nexport GROVE_SOCKET\nELECTRON_RUN_AS_NODE=1 exec ${q(o.execPath)} ${q(o.cliPath)} "$@"\n`
  )
  fs.chmodSync(file, 0o755)
  return file
}

// `grove` on the human's PATH: a symlink to the launcher in `targetDir` (nothing is written to system directories).
export function installCommandLineTool(o: { launcher: string; targetDir: string; pathVar: string }):
  { ok: true; target: string; onPath: boolean } | { ok: false; message: string } {
  const target = path.join(o.targetDir, 'grove')
  try {
    fs.mkdirSync(o.targetDir, { recursive: true })
    const existing = fs.lstatSync(target, { throwIfNoEntry: false })
    if (existing && !existing.isSymbolicLink()) return { ok: false, message: `${target} exists and is not a link; remove it first` }
    if (existing) fs.unlinkSync(target)
    fs.symlinkSync(o.launcher, target)
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
  return { ok: true, target, onPath: o.pathVar.split(path.delimiter).includes(o.targetDir) }
}
