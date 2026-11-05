import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// A fingerprint of the core's own source: every .ts and .mjs file under core/ except tests. A core process keeps the
// code it started with, so a core whose fingerprint differs from the one the caller computes is from an older build.
let cached: string | undefined

export function buildId(dir: string = fileURLToPath(new URL('.', import.meta.url))): string {
  if (cached !== undefined && dir === fileURLToPath(new URL('.', import.meta.url))) return cached
  const hash = crypto.createHash('sha256')
  for (const file of sourceFiles(dir)) {
    hash.update(path.relative(dir, file))
    hash.update(fs.readFileSync(file))
  }
  const id = hash.digest('hex').slice(0, 16)
  if (dir === fileURLToPath(new URL('.', import.meta.url))) cached = id
  return id
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) out.push(...sourceFiles(full))
    } else if (/\.(ts|mjs)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}
