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

export function hookSettings(spool: string): string {
  const stamp = '"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'
  const record = `x=$(cat); printf '{"t":"%s","e":%s}\\n' ${stamp} "$x" >> ${shQuote(spool)}`
  const marker = `cat >/dev/null; printf '{"t":"%s","e":{"hook_event_name":"PostToolBatch"}}\\n' ${stamp} >> ${shQuote(spool)}`
  const hooks = Object.fromEntries(HOOKS.map(([event, matcher]) => [
    event,
    [{ ...(matcher && { matcher }), hooks: [{ type: 'command', command: event === 'PostToolBatch' ? marker : record, timeout: 5 }] }],
  ]))
  return JSON.stringify({ hooks })
}

// Before loginShellArgv. Resume uses the spool's latest SessionStart id when known (after /clear).
export function claudeArgv(id: string, spool: string, mode: 'start' | 'resume', resumeId?: string, opts?: { prompt?: string; name?: string }): string[] {
  const session = mode === 'start' ? ['--session-id', id] : ['--resume', resumeId ?? id]
  const prompt = opts?.prompt ? [...(opts.prompt.startsWith('-') ? ['--'] : []), opts.prompt] : []
  return ['claude', ...session, '--settings', hookSettings(spool), ...(opts?.name ? ['--name', opts.name] : []), ...prompt]
}
