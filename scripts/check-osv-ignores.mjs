// osv-scanner accepts [[IgnoredVulns]] entries without ignoreUntil or reason,
// and such entries never expire. This fails on any entry missing either.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// A basic or literal string followed by an optional comment, else the bare value without its comment.
function tomlString(raw) {
  const quoted = raw.match(/^\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\s*(?:#.*)?$/)
  if (quoted) return (quoted[1] ?? quoted[2]).trim()
  return raw.replace(/\s+#.*$/, '').trim()
}

export function checkIgnores(text) {
  const problems = []
  let entry = null
  let n = 0
  const finish = () => {
    if (!entry) return
    const label = entry.id ? `${entry.id}` : `entry ${n}`
    for (const key of ['id', 'ignoreUntil', 'reason']) {
      if (!entry[key]) problems.push(`[[IgnoredVulns]] ${label}: missing ${key}`)
    }
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('[')) {
      finish()
      entry = line.replace(/\s+#.*$/, '').replace(/\s+/g, '') === '[[IgnoredVulns]]' ? {} : null
      if (entry) n++
      continue
    }
    if (!entry) continue
    const m = line.match(/^([A-Za-z]+)\s*=\s*(.*)$/)
    if (!m) continue
    entry[m[1]] = tomlString(m[2])
  }
  finish()
  return problems
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const file = process.argv[2] ?? 'osv-scanner.toml'
  const problems = checkIgnores(fs.readFileSync(file, 'utf8'))
  for (const p of problems) console.error(`${file}: ${p}`)
  process.exit(problems.length ? 1 : 0)
}
