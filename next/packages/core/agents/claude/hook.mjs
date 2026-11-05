// Claude hook: appends one JSON line per hook event to the Grove spool. Runs as `node hook.mjs <Event>`.
// It must never break Claude, so every failure is swallowed and the exit code stays 0.
import fs from 'node:fs'
import path from 'node:path'

const event = process.argv[2]
// The app's own launches set GROVE_NEXT_SPOOL. An agent typed into a tab the app started has only GROVE_NEXT_TAB and
// GROVE_NEXT_HOME (set on every tab), and its spool is the tab's own file, the one the core watches for it.
const spool =
  process.env.GROVE_NEXT_SPOOL ||
  (process.env.GROVE_NEXT_HOME && process.env.GROVE_NEXT_TAB
    ? path.join(process.env.GROVE_NEXT_HOME, 'agents', 'claude', `${process.env.GROVE_NEXT_TAB}.jsonl`)
    : '')

async function readStdin() {
  process.stdin.setEncoding('utf8')
  let text = ''
  for await (const chunk of process.stdin) text += chunk
  return text
}

async function main() {
  if (!event || !spool) return
  let payload = null
  try {
    const text = await readStdin()
    payload = text.trim() ? JSON.parse(text) : null
  } catch {
    payload = null
  }
  try {
    fs.mkdirSync(path.dirname(spool), { recursive: true, mode: 0o700 })
    fs.appendFileSync(spool, JSON.stringify({ event, at: Date.now(), payload }) + '\n', { mode: 0o600 })
  } catch {
    // Dropping one event is better than failing the hook.
  }
}

main().catch(() => {})
