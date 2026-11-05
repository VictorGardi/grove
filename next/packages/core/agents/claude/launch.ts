import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Every Claude hook event Grove listens to. Each one runs hook.mjs with the event name as argv[2].
export const CLAUDE_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'Stop',
  'StopFailure',
  'PermissionRequest',
  'Notification',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'SubagentStart',
  'SubagentStop',
  'SessionEnd',
] as const

// A Claude session id is a UUID. Anything else must never reach the command line as a flag.
export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const CLAUDE_HOOK_SCRIPT = fileURLToPath(new URL('./hook.mjs', import.meta.url))

export interface ClaudeLaunchOptions {
  tabId: string
  // The caller starts the command in this folder; the launch itself does not need it.
  cwd: string
  home: string
  resumeId?: string
  // False when the user's own Claude settings already carry Grove's hooks (grove-next integration install claude):
  // the per-launch hooks would report every event twice, so the launch leaves them out.
  perLaunchHooks?: boolean
}

export interface ClaudeLaunch {
  command: 'claude'
  args: string[]
  env: Record<string, string>
  sessionId: string
  spoolFile: string
}

export function claudeSpoolFile(home: string, tabId: string): string {
  return path.join(home, 'agents', 'claude', `${tabId}.jsonl`)
}

// The inline --settings JSON: one command hook per event, all pointing at hook.mjs.
export function claudeSettings(hookScript: string = CLAUDE_HOOK_SCRIPT): string {
  const hooks: Record<string, Array<{ hooks: Array<{ type: 'command'; command: string }> }>> = {}
  for (const event of CLAUDE_HOOK_EVENTS) {
    hooks[event] = [{ hooks: [{ type: 'command', command: `node ${shellQuote(hookScript)} ${event}` }] }]
  }
  return JSON.stringify({ hooks })
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

// A fresh launch names its session; a resume reuses the id Claude last reported.
export function claudeLaunch(options: ClaudeLaunchOptions): ClaudeLaunch {
  const spoolFile = claudeSpoolFile(options.home, options.tabId)
  const sessionId = options.resumeId ? options.resumeId : crypto.randomUUID()
  const identity = options.resumeId ? ['--resume', options.resumeId] : ['--session-id', sessionId]
  const settings = options.perLaunchHooks === false ? [] : ['--settings', claudeSettings()]
  return {
    command: 'claude',
    args: [...identity, ...settings],
    env: { GROVE_NEXT_SPOOL: spoolFile },
    sessionId,
    spoolFile,
  }
}
