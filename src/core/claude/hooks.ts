// Per-launch hooks (E-D10, ADR 0016): every hook appends {"t": <UTC, s>, "e": <stdin JSON>} to the session's spool.
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
  const command = `x=$(cat); printf '{"t":"%s","e":%s}\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$x" >> ${shQuote(spool)}`
  const hooks = Object.fromEntries(HOOKS.map(([event, matcher]) => [
    event,
    [{ ...(matcher && { matcher }), hooks: [{ type: 'command', command, timeout: 5 }] }],
  ]))
  return JSON.stringify({ hooks })
}

// Before loginShellArgv. Resume uses the spool's latest SessionStart id when known (after /clear).
export function claudeArgv(id: string, spool: string, mode: 'start' | 'resume', resumeId?: string): string[] {
  const session = mode === 'start' ? ['--session-id', id] : ['--resume', resumeId ?? id]
  return ['claude', ...session, '--settings', hookSettings(spool)]
}
