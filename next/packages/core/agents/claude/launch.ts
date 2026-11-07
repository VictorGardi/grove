import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The one Claude hook event Grove listens to: SessionStart carries the session id, which changes on /clear. It runs
// hook.mjs with the event name as argv[2]. Status comes from OSC 7501, not hooks.
export const CLAUDE_HOOK_EVENTS = ['SessionStart'] as const

// A Claude session id is a UUID. Anything else must never reach the command line as a flag.
export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const CLAUDE_HOOK_SCRIPT = fileURLToPath(new URL('./hook.mjs', import.meta.url))

export interface ClaudeLaunchOptions {
  tabId: string
  // The caller starts the command in this folder; the launch itself does not need it.
  cwd: string
  home: string
  resumeId?: string
  // False when the user's own Claude settings already carry Grove's hook (grove-next integration install claude):
  // the per-launch hook would report the session twice, so the launch leaves it out.
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

// The inline --settings JSON: a command hook for SessionStart, pointing at hook.mjs.
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
    env: {},
    sessionId,
    spoolFile,
  }
}
