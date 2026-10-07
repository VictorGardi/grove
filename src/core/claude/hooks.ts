// Per-launch hooks (E-D10, ADR 0016): every hook appends {"t": <UTC, s>, "e": <stdin JSON>} to the session's spool,
// except PostToolBatch, whose stdin holds every tool's input and output: it appends a marker instead.
const HOOKS: [event: string, matcher?: string][] = [
  ['SessionStart'],
  ['UserPromptSubmit'],
  ['PermissionRequest'],
  ['PreToolUse', 'AskUserQuestion'],
  ['PostToolUse', 'Write|Edit|MultiEdit|NotebookEdit|AskUserQuestion'],
  ['PostToolUseFailure'],
  ['PostToolBatch'],
  ['Stop'],
  ['StopFailure'],
  ['Notification', 'idle_prompt'],
]

const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

// The statusLine stdin keeps only what the context gauge reads (model id, window size, used %, the three input token counts).
const SLIM = `{t: $t, e: {hook_event_name: "StatusLine",
  model: (.model | if type == "object" then .id else . end),
  context_window: {context_window_size: .context_window.context_window_size, used_percentage: .context_window.used_percentage,
    current_usage: (.context_window.current_usage | if type == "object" then {input_tokens, cache_read_input_tokens, cache_creation_input_tokens} else null end)}}}`.replace(/\n\s*/g, ' ')

// The per-launch statusLine (ADR 0032): --settings overrides the user's own statusLine, so this appends a slim
// StatusLine record to the spool, then runs the user's command (from <config dir>/settings.json) on the same stdin
// and passes its output through. Without jq it does nothing: no gauge, and no user statusline either.
function statusLineCommand(spool: string): string {
  const stamp = '"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'
  return [
    'x=$(cat)',
    'command -v jq >/dev/null 2>&1 || exit 0',
    `printf '%s' "$x" | jq -c --arg t ${stamp} '${SLIM}' >> ${shQuote(spool)} 2>/dev/null`,
    `u=$(jq -r '.statusLine.command // empty' "\${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json" 2>/dev/null)`,
    `if [ -n "$u" ]; then printf '%s' "$x" | sh -c "$u"; fi`,
    'exit 0',
  ].join('; ')
}

export function hookSettings(spool: string): string {
  const stamp = '"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'
  const record = `x=$(cat); printf '{"t":"%s","e":%s}\\n' ${stamp} "$x" >> ${shQuote(spool)}`
  const marker = `cat >/dev/null; printf '{"t":"%s","e":{"hook_event_name":"PostToolBatch"}}\\n' ${stamp} >> ${shQuote(spool)}`
  const hooks = Object.fromEntries(HOOKS.map(([event, matcher]) => [
    event,
    [{ ...(matcher && { matcher }), hooks: [{ type: 'command', command: event === 'PostToolBatch' ? marker : record, timeout: 5 }] }],
  ]))
  return JSON.stringify({ hooks, statusLine: { type: 'command', command: statusLineCommand(spool) } })
}

// Before loginShellArgv. Resume uses the spool's latest SessionStart id when known (after /clear).
export function claudeArgv(id: string, spool: string, mode: 'start' | 'resume', resumeId?: string, opts?: { prompt?: string; name?: string }): string[] {
  const session = mode === 'start' ? ['--session-id', id] : ['--resume', resumeId ?? id]
  const prompt = opts?.prompt ? [...(opts.prompt.startsWith('-') ? ['--'] : []), opts.prompt] : []
  return ['claude', ...session, '--settings', hookSettings(spool), ...(opts?.name ? ['--name', opts.name] : []), ...prompt]
}
