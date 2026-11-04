import type { SpoolRecord } from '../../status/spool.ts'

// Per-launch hooks for Copilot CLI, supplied as a plugin through `--plugin-dir` so the user's own
// ~/.copilot/settings.json is never edited. Copilot's hook stdin is one JSON object that does not name its event
// (verified on 1.0.102), so each command stamps it in: {"t": <UTC, s>, "e": {"hook_event_name": <event>, ...stdin}}.
// The spool is read by the generic spool source with parseCopilotLine.
// No permissionRequest: it fires before Copilot's permission service, so auto-approved calls hit it too. `notification`
// (permission_prompt, elicitation_dialog) fires only for a prompt actually shown.
export const HOOK_EVENTS = ['sessionStart', 'userPromptSubmitted', 'preToolUse', 'postToolUse', 'postToolUseFailure', 'notification', 'agentStop', 'sessionEnd'] as const

const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

// Never fails Copilot: a hook on preToolUse can gate a tool, so a spool that cannot be written exits 0.
// An empty or brace-less stdin is recorded as {"empty":true} so the event is still seen.
export function hookCommand(event: string, spool: string): string {
  const stamp = '"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'
  return [
    'x=$(cat)',
    `x=$(printf '%s' "$x" | tr '\\n' ' ')`, // raw newlines are only whitespace in JSON; a record is one line
    'b=${x#*{}',
    "case \"$x\" in *\"{\"*) ;; *) b='' ;; esac",
    `case "$b" in ""|"}"*|[[:space:]]"}"*) b='"empty":true}' ;; esac`,
    `printf '{"t":"%s","e":{"hook_event_name":"%s",%s}\\n' ${stamp} ${event} "$b" >> ${shQuote(spool)} 2>/dev/null`,
    'exit 0',
  ].join('; ')
}

export const pluginJson = JSON.stringify({ name: 'grove', version: '1.0.0', hooks: 'hooks.json' })

export function hooksJson(spool: string): string {
  const hooks = Object.fromEntries(HOOK_EVENTS.map((e) => [e, [{ type: 'command', bash: hookCommand(e, spool) }]]))
  return JSON.stringify({ version: 1, hooks })
}

// One spool line read back. The event is the payload's own hook_event_name when it has one (a Notification payload
// names itself, and that wins over the stamp). The time is Copilot's own epoch-ms timestamp when the payload has one,
// else the stamp. A line that is not that shape is corrupt.
export function parseCopilotLine(line: string): SpoolRecord | null {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  if (value === null || typeof value !== 'object') return null
  const { t, e } = value as { t?: unknown; e?: unknown }
  if (e === null || typeof e !== 'object') return null
  const hook = e as { hook_event_name?: unknown; timestamp?: unknown }
  const own = typeof hook.timestamp === 'number' ? hook.timestamp : typeof t === 'string' ? Date.parse(t) : NaN
  return {
    event: typeof hook.hook_event_name === 'string' ? hook.hook_event_name : '',
    at: Number.isFinite(own) ? own : undefined,
    payload: e,
  }
}
