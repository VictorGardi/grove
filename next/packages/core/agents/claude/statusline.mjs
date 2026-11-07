// Claude statusLine command: keeps the latest context reading in the tab's usage file, then runs the user's own
// status-line command on the same stdin and passes its output through. Runs as `node statusline.mjs`.
// It must never break Claude, so every failure is swallowed and the exit code stays 0.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const usage =
  process.env.GROVE_NEXT_USAGE ||
  (process.env.GROVE_NEXT_HOME && process.env.GROVE_NEXT_TAB
    ? path.join(process.env.GROVE_NEXT_HOME, 'agents', 'claude', `${process.env.GROVE_NEXT_TAB}.usage.json`)
    : '')

async function readStdin() {
  process.stdin.setEncoding('utf8')
  let text = ''
  for await (const chunk of process.stdin) text += chunk
  return text
}

// Only what the context reading needs; the rest of the status-line input stays out of the file.
function slim(input) {
  const cw = input && typeof input.context_window === 'object' && input.context_window !== null ? input.context_window : {}
  const model = input && input.model
  return {
    session_id: typeof input?.session_id === 'string' ? input.session_id : null,
    model: typeof model === 'object' && model !== null ? (model.id ?? null) : (model ?? null),
    context_window: {
      total_input_tokens: cw.total_input_tokens ?? null,
      context_window_size: cw.context_window_size ?? null,
      used_percentage: cw.used_percentage ?? null,
      current_usage:
        typeof cw.current_usage === 'object' && cw.current_usage !== null
          ? {
              input_tokens: cw.current_usage.input_tokens ?? null,
              cache_creation_input_tokens: cw.current_usage.cache_creation_input_tokens ?? null,
              cache_read_input_tokens: cw.current_usage.cache_read_input_tokens ?? null,
            }
          : null,
    },
  }
}

function record(text) {
  if (!usage) return
  try {
    const input = JSON.parse(text)
    fs.mkdirSync(path.dirname(usage), { recursive: true, mode: 0o700 })
    const tmp = `${usage}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ at: Date.now(), payload: slim(input) }) + '\n', { mode: 0o600 })
    fs.renameSync(tmp, usage)
  } catch {
    // A missed reading is better than a failed status line.
  }
}

// The user's configured command, from the Claude config folder's settings.json. Undefined when there is none.
function userCommand() {
  try {
    const file = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json')
    const command = JSON.parse(fs.readFileSync(file, 'utf8'))?.statusLine?.command
    return typeof command === 'string' && command.trim() ? command : undefined
  } catch {
    return undefined
  }
}

function chain(command, text) {
  return new Promise((resolve) => {
    try {
      const child = spawn('sh', ['-c', command], { stdio: ['pipe', 'inherit', 'inherit'] })
      child.on('error', () => resolve())
      child.on('close', () => resolve())
      child.stdin.on('error', () => {})
      child.stdin.end(text)
    } catch {
      resolve()
    }
  })
}

async function main() {
  let text = ''
  try {
    text = await readStdin()
  } catch {
    return
  }
  record(text)
  const command = userCommand()
  if (command) await chain(command, text)
}

main().catch(() => {})
