// The hook entries Grove once installed for Copilot, kept for the integration cleanup. Copilot's hook stdin is one JSON object that does not name its event
// (verified on 1.0.102), so each command stamps it in: {"t": <UTC, s>, "e": {"hook_event_name": <event>, ...stdin}}.
// No permissionRequest: it fires before Copilot's permission service, so auto-approved calls hit it too. `notification`
// (permission_prompt, elicitation_dialog) fires only for a prompt actually shown.
export const HOOK_EVENTS = ['sessionStart', 'userPromptSubmitted', 'preToolUse', 'postToolUse', 'postToolUseFailure', 'notification', 'agentStop', 'sessionEnd'] as const

const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

// Never fails Copilot: a hook on preToolUse can gate a tool, so a spool that cannot be written exits 0.
// An empty or brace-less stdin is recorded as {"empty":true} so the event is still seen.
// `rawSpool` is shell text to expand at run time (e.g. a path in a variable), not a literal path to quote.
export function hookCommand(event: string, spool: string, rawSpool = false): string {
  const stamp = '"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'
  return [
    'x=$(cat)',
    `x=$(printf '%s' "$x" | tr '\\n' ' ')`, // raw newlines are only whitespace in JSON; a record is one line
    'b=${x#*{}',
    "case \"$x\" in *\"{\"*) ;; *) b='' ;; esac",
    `case "$b" in ""|"}"*|[[:space:]]"}"*) b='"empty":true}' ;; esac`,
    `printf '{"t":"%s","e":{"hook_event_name":"%s",%s}\\n' ${stamp} ${event} "$b" >> ${rawSpool ? spool : shQuote(spool)} 2>/dev/null`,
    'exit 0',
  ].join('; ')
}
