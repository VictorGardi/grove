import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'

// The image is content-addressed on the Dockerfile alone. Nothing that differs per install or
// per grove release may go into it — above all not the CLI bundle, which is mounted instead
// (D7, ADR 0039) — or a grove upgrade would rebuild the image for every user.
export function imageRef(dockerfile: string): string {
  return `grove-sandbox:${createHash('sha256').update(fs.readFileSync(dockerfile)).digest('hex').slice(0, 12)}`
}

// Built once, on first use. A missing `container`, a stopped system or a failing build rejects —
// the caller turns that into `no-sandbox`, never into an unsandboxed pane.
export function ensureImage(o: { container: string; dir: string; tag: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(o.container, ['image', 'ls', '--quiet'], (err, stdout) => {
      if (err) return reject(err)
      if (stdout.split('\n').some((line) => line.trim() === o.tag)) return resolve()
      execFile(o.container, ['build', '-t', o.tag, o.dir], (e) => (e ? reject(e) : resolve()))
    })
  })
}