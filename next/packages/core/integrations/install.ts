import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CLAUDE_HOOK_EVENTS, CLAUDE_HOOK_SCRIPT } from '../agents/claude/launch.ts'

// The Claude SessionStart hook that reports the resume id of tabs typed by hand and after /clear. Status itself is OSC 7501.
// Each command does nothing unless the tab it runs in has GROVE_NEXT_TAB
// (every tab the app starts sets it), so the same hook is harmless in every other terminal. Install merges these
// entry into Claude's own user settings; uninstall removes exactly these entries and nothing else. Copilot's entries from
// older installs can still be removed (uninstallCopilot), but are no longer written.
// The marker is a shell comment at the end of each command, so it is found again without a second file.
export const MARKER = '# grove-next-hook'

const shQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

// The Claude command for one event. `node` is the Node that runs the hook (the one running this install).
export function claudeHookCommand(event: string, node: string, script: string = CLAUDE_HOOK_SCRIPT): string {
  return `if [ -n "$GROVE_NEXT_TAB" ]; then ${shQuote(node)} ${shQuote(script)} ${event}; fi ${MARKER}`
}

interface HookEntry {
  type?: string
  command?: string
  bash?: string
}

interface HookGroup {
  matcher?: string
  hooks?: HookEntry[]
}

type JsonObject = Record<string, unknown>

// Whether an entry was written by install (its command or bash text carries the marker).
export function isOurs(entry: HookEntry): boolean {
  return [entry.command, entry.bash].some((text) => typeof text === 'string' && text.includes(MARKER))
}

// Returns a copy of `settings` with our Claude hook set for SessionStart only (entries from older installs for other
// events are dropped), other hooks untouched.
export function mergeClaudeHooks(settings: JsonObject, commandFor: (event: string) => string): JsonObject {
  const hooks = withoutOurs(objectOf(settings.hooks), 'claude')
  for (const event of CLAUDE_HOOK_EVENTS) {
    const groups = Array.isArray(hooks[event]) ? (hooks[event] as HookGroup[]) : []
    hooks[event] = [...groups, { hooks: [{ type: 'command', command: commandFor(event) }] }]
  }
  return { ...settings, hooks }
}

// Removes every Claude hook entry install wrote, and drops groups or events left empty.
export function removeClaudeHooks(settings: JsonObject): JsonObject {
  const hooks = withoutOurs(objectOf(settings.hooks), 'claude')
  const next: JsonObject = { ...settings }
  if (Object.keys(hooks).length === 0) delete next.hooks
  else next.hooks = hooks
  return next
}

// Removes every Copilot hook entry an older install wrote, and drops events left empty.
export function removeCopilotHooks(settings: JsonObject): JsonObject {
  const hooks = withoutOurs(objectOf(settings.hooks), 'copilot')
  const next: JsonObject = { ...settings }
  if (Object.keys(hooks).length === 0) delete next.hooks
  else next.hooks = hooks
  return next
}

// Whether `settings` holds our Claude hook for SessionStart and nowhere else. An older install that also has entries for
// other events is not current: it is out-of-date until the next install replaces it.
export function hasClaudeHooks(settings: JsonObject): boolean {
  const hooks = objectOf(settings.hooks)
  const ours = (event: string) => (Array.isArray(hooks[event]) ? (hooks[event] as HookGroup[]) : []).some((group) => (group.hooks ?? []).some(isOurs))
  return Object.keys(hooks).every((event) => ours(event) === (event === 'SessionStart')) && ours('SessionStart')
}

// Whether `settings` holds any entry Grove wrote, for any event and whether or not every event has one (Claude's are
// inside groups, Copilot's are direct).
export function hasAnyGroveHooks(settings: JsonObject): boolean {
  return Object.values(objectOf(settings.hooks)).some((value) =>
    Array.isArray(value) &&
    value.some((item) => {
      if (item === null || typeof item !== 'object') return false
      const group = item as HookGroup
      return isOurs(item as HookEntry) || (Array.isArray(group.hooks) && group.hooks.some(isOurs))
    })
  )
}

function objectOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? { ...(value as JsonObject) } : {}
}

// Drops our entries from every event of `hooks`. A Claude group is kept with its other hooks; an event left with
// nothing is dropped.
function withoutOurs(hooks: Record<string, unknown>, agent: 'claude' | 'copilot'): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [event, value] of Object.entries(hooks)) {
    if (!Array.isArray(value)) {
      out[event] = value
      continue
    }
    const kept =
      agent === 'claude'
        ? (value as HookGroup[]).flatMap((group) => {
            if (group === null || typeof group !== 'object' || !Array.isArray(group.hooks)) return [group]
            const others = group.hooks.filter((entry) => !isOurs(entry))
            if (others.length === group.hooks.length) return [group]
            return others.length === 0 ? [] : [{ ...group, hooks: others }]
          })
        : (value as HookEntry[]).filter((entry) => !isOurs(entry))
    if (kept.length > 0) out[event] = kept
  }
  return out
}

// The settings file an install edits. Its folder is the agent's own config folder.
export function claudeSettingsFile(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  return path.join(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'settings.json')
}

export function copilotSettingsFile(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  return path.join(env.COPILOT_HOME || path.join(home, '.copilot'), 'settings.json')
}

export interface InstallResult {
  file: string
  // The backup written before the first change, or null when the file did not exist before.
  backup: string | null
  changed: boolean
}

// Reads a settings file as a JSON object. A missing file is an empty object; an unreadable or non-object file is
// refused (never overwritten).
export function readSettings(file: string): JsonObject {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
  const parsed: unknown = JSON.parse(text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${file} is not a JSON object; it was not changed`)
  }
  return parsed as JsonObject
}

// Writes `next` to `file`. The first change keeps a copy of the file as it was, next to it, so uninstall and a
// hand edit can always go back. Later changes keep that first copy.
export function writeSettings(file: string, next: JsonObject, previous: JsonObject, existed: boolean): InstallResult {
  const same = JSON.stringify(previous) === JSON.stringify(next)
  if (same) return { file, backup: null, changed: false }
  let backup: string | null = null
  if (existed) {
    backup = `${file}.grove-next.bak`
    if (!fs.existsSync(backup)) fs.copyFileSync(file, backup)
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.grove-next.tmp`
  // The rewritten file keeps the permissions of the one it replaces: a settings file kept private stays private.
  const mode = existed ? fs.statSync(file).mode & 0o777 : undefined
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, mode === undefined ? undefined : { mode })
  if (mode !== undefined) fs.chmodSync(tmp, mode)
  fs.renameSync(tmp, file)
  return { file, backup, changed: true }
}

export function installClaude(file: string, node: string = process.execPath): InstallResult {
  const existed = fs.existsSync(file)
  const previous = readSettings(file)
  const next = mergeClaudeHooks(previous, (event) => claudeHookCommand(event, node))
  return writeSettings(file, next, previous, existed)
}

export function uninstallClaude(file: string): InstallResult {
  if (!fs.existsSync(file)) return { file, backup: null, changed: false }
  const previous = readSettings(file)
  return writeSettings(file, removeClaudeHooks(previous), previous, true)
}

export function uninstallCopilot(file: string): InstallResult {
  if (!fs.existsSync(file)) return { file, backup: null, changed: false }
  const previous = readSettings(file)
  return writeSettings(file, removeCopilotHooks(previous), previous, true)
}
