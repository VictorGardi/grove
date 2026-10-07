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
