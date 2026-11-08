import fs from 'node:fs'
import path from 'node:path'

// Copilot's session ids are UUIDs.
const SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The top-level `key: value` lines of Copilot's workspace.yaml that discovery reads.
function fieldsOf(file: string): { cwd?: string; created_at?: string } | undefined {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
  const field = (key: string) => {
    const match = new RegExp(`^${key}:[ \\t]*(.+)$`, 'm').exec(text)
    return match?.[1].trim().replace(/^(['"])(.*)\1$/, '$2')
  }
  return { cwd: field('cwd'), created_at: field('created_at') }
}

// The folder as the OS names it, so a link and its target match.
function realFolder(folder: string): string {
  try {
    return fs.realpathSync(folder)
  } catch {
    return folder
  }
}

// The session a hand-started Copilot is running: the one session in `cwd` created at or after `since` (ms).
// Copilot writes <home>/session-state/<id>/workspace.yaml when a session starts, before any prompt, so this finds the
// session with no hook. With no candidate it is undefined, and with more than one it is too: an ambiguous hand-started
// tab is never adopted and never credited with another session's usage, rather than guessed.
export function findCopilotSession(options: { copilotHome: string; cwd: string; since: number; exclude?: ReadonlySet<string> }): string | undefined {
  const root = path.join(options.copilotHome, 'session-state')
  let names: string[]
  try {
    names = fs.readdirSync(root)
  } catch {
    return undefined
  }
  const folder = realFolder(options.cwd)
  let found: string | undefined
  for (const id of names) {
    if (!SESSION.test(id) || options.exclude?.has(id)) continue
    const dir = path.join(root, id)
    let changed: number
    try {
      changed = fs.statSync(dir).mtimeMs
    } catch {
      continue
    }
    // A session folder is written when its session starts, so one last changed before `since` is an older session.
    if (changed < options.since) continue
    const fields = fieldsOf(path.join(dir, 'workspace.yaml'))
    if (fields?.cwd === undefined || realFolder(fields.cwd) !== folder) continue
    const created = Date.parse(fields.created_at ?? '')
    if (!Number.isFinite(created) || created < options.since) continue
    // A second eligible candidate makes the whole discovery ambiguous, taking a found one with it.
    if (found !== undefined) return undefined
    found = id
  }
  return found
}
