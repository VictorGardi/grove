// Per-launch hooks for Copilot CLI (D1 = A), supplied as a plugin through `--plugin-dir` so the user's own
// ~/.copilot/settings.json is never edited. Copilot's hook stdin is one JSON object that does not name its event
// (verified on 1.0.102), so each command stamps it in: {"t": <UTC, s>, "e": {"hook_event_name": <event>, ...stdin}}.
// Same record shape as Claude's spool, so SpoolTail reads it.
export const HOOK_EVENTS = ['sessionStart', 'userPromptSubmitted', 'preToolUse', 'permissionRequest', 'postToolUse', 'agentStop', 'sessionEnd'] as const

const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

// Never fails Copilot: a hook on preToolUse or permissionRequest can gate a tool, so a spool that cannot be written exits 0.
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
