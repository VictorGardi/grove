// node-pty's prebuilt spawn-helper can lose its exec bit on install, which
// breaks pty.spawn on macOS with "posix_spawnp failed".
import fs from 'node:fs'
import path from 'node:path'

const prebuilds = path.join(process.cwd(), 'node_modules', 'node-pty', 'prebuilds')
if (!fs.existsSync(prebuilds)) process.exit(0)

for (const dir of fs.readdirSync(prebuilds)) {
  const helper = path.join(prebuilds, dir, 'spawn-helper')
  if (fs.existsSync(helper)) {
    fs.chmodSync(helper, 0o755)
    console.log(helper)
  }
}
