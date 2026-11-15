import fs from 'node:fs'
import path from 'node:path'
import { cleanName, nameReporter, NAME_POLL_MS, poll } from '../nameSource.ts'
import { SESSION_ID } from './launch.ts'

export interface ClaudeNameSource {
  // Reads what the transcript gained since the last read and delivers the name when it changed.
  drain: () => void
  close: () => void
}

export interface ClaudeNameOptions {
  // The tab's usage file, which carries the session id Claude runs now (it changes on /clear).
  usageFile: string
  // Claude's projects folder, which holds <project>/<session id>.jsonl.
  projectsDir: string
  // The id the tab was launched or resumed with, used until the usage file names one.
  sessionId: string
  onName: (name: string) => void
  intervalMs?: number
}

// What a transcript says about the session's name. A name the human or a skill set (`custom-title` from /rename,
// `agent-name` from --name or a skill) beats one Claude made (`ai-title`), which beats the first prompt.
export interface TranscriptNames {
  named?: string
  generated?: string
  prompt?: string
}

// The text of a user record that is a real prompt: not a sidechain (subagent) record, not Claude's own meta record, and not
// a slash-command or hook wrapper such as `<command-name>`.
function promptOf(record: Record<string, unknown>): string | undefined {
  if (record.type !== 'user' || record.isSidechain === true || record.isMeta === true) return undefined
  const message = record.message
  const content = message !== null && typeof message === 'object' ? (message as Record<string, unknown>).content : undefined
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((part) => (part !== null && typeof part === 'object' && (part as Record<string, unknown>).type === 'text' ? (part as Record<string, unknown>).text : '')).join(' ')
        : ''
  const first = (typeof text === 'string' ? text : '').trim()
  return first === '' || first.startsWith('<') ? undefined : cleanName(first.split('\n')[0])
}

// Folds one transcript line into the names. Lines that are not one of the records above are skipped without parsing.
export function readLine(names: TranscriptNames, line: string): void {
  const interesting = line.includes('"custom-title"') || line.includes('"agent-name"') || line.includes('"ai-title"') || (names.prompt === undefined && line.includes('"type":"user"'))
  if (!interesting) return
  let record: unknown
  try {
    record = JSON.parse(line)
  } catch {
    return
  }
  if (record === null || typeof record !== 'object') return
  const fields = record as Record<string, unknown>
  if (fields.type === 'custom-title') names.named = cleanName(fields.customTitle) ?? names.named
  else if (fields.type === 'agent-name') names.named = cleanName(fields.agentName) ?? names.named
  else if (fields.type === 'ai-title') names.generated = cleanName(fields.aiTitle) ?? names.generated
  else if (names.prompt === undefined) names.prompt = promptOf(fields)
}

export const nameOf = (names: TranscriptNames): string | undefined => names.named ?? names.generated ?? names.prompt

// The transcript of a session: the one project folder that holds <id>.jsonl. Undefined while there is none.
export function findTranscript(projectsDir: string, sessionId: string): string | undefined {
  if (!SESSION_ID.test(sessionId)) return undefined
  let projects: string[]
  try {
    projects = fs.readdirSync(projectsDir)
  } catch {
    return undefined
  }
  for (const project of projects) {
    const file = path.join(projectsDir, project, `${sessionId}.jsonl`)
    if (fs.existsSync(file)) return file
  }
  return undefined
}

function sessionOf(usageFile: string): string | undefined {
  try {
    const id = (JSON.parse(fs.readFileSync(usageFile, 'utf8')) as { payload?: { session_id?: unknown } } | null)?.payload?.session_id
    return typeof id === 'string' ? id : undefined
  } catch {
    return undefined
  }
}

// Watches one tab's transcript for its session's name. A transcript only grows, so each poll reads what it gained since
// the last one; a new session id (after /clear) or a shorter file starts over.
export function createClaudeNameSource(options: ClaudeNameOptions): ClaudeNameSource {
  const report = nameReporter('Claude', options.onName)
  let sessionId = ''
  let file: string | undefined
  let offset = 0
  let rest = ''
  let names: TranscriptNames = {}

  const reset = (id: string): void => {
    sessionId = id
    file = undefined
    offset = 0
    rest = ''
    names = {}
  }

  const drain = (): void => {
    const id = sessionOf(options.usageFile) ?? options.sessionId
    if (id !== sessionId) reset(id)
    file ??= findTranscript(options.projectsDir, id)
    if (file === undefined) return
    try {
      const size = fs.statSync(file).size
      if (size < offset) reset(id)
      if (size === offset) return
      const fd = fs.openSync(file, 'r')
      try {
        const buffer = Buffer.alloc(size - offset)
        const read = fs.readSync(fd, buffer, 0, buffer.length, offset)
        offset += read
        rest += buffer.subarray(0, read).toString('utf8')
      } finally {
        fs.closeSync(fd)
      }
    } catch {
      return
    }
    const lines = rest.split('\n')
    rest = lines.pop() ?? ''
    for (const line of lines) readLine(names, line)
    report(nameOf(names))
  }

  const timer = poll(drain, { immediate: true, intervalMs: options.intervalMs ?? NAME_POLL_MS })
  return { drain, close: timer.stop }
}
