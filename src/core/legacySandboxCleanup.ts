import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'

// Transitional: older releases left containers, images and a gateway hostname in the
// opencode service file on some machines. This sweeps them once, then drops a marker.
// Delete this module (and its call in main/index.ts) in a later release.

export type RunResult = { ok: boolean; stdout: string }
export type Run = (cmd: string, args: string[], timeoutMs: number) => Promise<RunResult>

const defaultRun: Run = (cmd, args, timeoutMs) =>
  new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: timeoutMs, encoding: 'utf8' }, (err, stdout) => {
        resolve({ ok: !err, stdout: err ? '' : String(stdout) })
      })
    } catch {
      resolve({ ok: false, stdout: '' })
    }
  })

const lines = (s: string): string[] => s.split('\n').map((l) => l.trim()).filter(Boolean)

async function gateway(run: Run, container: string, timeoutMs: number): Promise<string | null> {
  const r = await run(container, ['network', 'ls', '--format', 'json'], timeoutMs)
  if (!r.ok) return null
  try {
    const nets = JSON.parse(r.stdout) as unknown
    if (!Array.isArray(nets)) return null
    for (const n of nets) {
      if (n?.configuration?.name === 'default') {
        const g = n?.status?.ipv4Gateway
        return typeof g === 'string' && g ? g : null
      }
    }
  } catch {
    // unparseable output: treat as no gateway
  }
  return null
}

function dropHostname(configFile: string, gw: string): void {
  let obj: unknown
  try {
    obj = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  } catch {
    return
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return
  const rec = obj as Record<string, unknown>
  if (typeof rec.hostname !== 'string' || rec.hostname !== gw) return
  delete rec.hostname
  fs.writeFileSync(configFile, JSON.stringify(rec, null, 2) + '\n', { mode: 0o600 })
}

export async function runLegacySandboxCleanup(opts: {
  markerPath: string
  configFile: string
  container?: string
  run?: Run
  timeoutMs?: number
}): Promise<void> {
  try {
    const { markerPath, configFile, container = 'container', run = defaultRun, timeoutMs = 10_000 } = opts
    if (fs.existsSync(markerPath)) return
    try {
      const ps = await run(container, ['list', '--all', '--quiet'], timeoutMs)
      if (ps.ok) {
        for (const name of lines(ps.stdout)) {
          if (name.startsWith('grove-')) await run(container, ['rm', '-f', name], timeoutMs)
        }
      }
      const imgs = await run(container, ['image', 'ls', '--quiet'], timeoutMs)
      if (imgs.ok) {
        for (const ref of lines(imgs.stdout)) {
          if (ref.startsWith('grove-sandbox:')) await run(container, ['image', 'rm', ref], timeoutMs)
        }
      }
      const gw = await gateway(run, container, timeoutMs)
      if (gw) dropHostname(configFile, gw)
    } catch {
      // best effort: fall through to the marker
    }
    try {
      fs.mkdirSync(path.dirname(markerPath), { recursive: true })
      fs.writeFileSync(markerPath, new Date().toISOString() + '\n')
    } catch {
      // retried next launch
    }
  } catch {
    // never throw
  }
}
