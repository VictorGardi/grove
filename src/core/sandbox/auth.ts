import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { AgentKind } from '../agents/types'

// A credential exists nowhere on disk on a Mac: Claude Code keeps its OAuth token in the Keychain,
// which a Linux VM cannot read (D8). So grove forwards the variable instead — and has to know
// whether the human has one, because a bare `container run -e VAR` for an absent variable does
// **not** fail the run (measured, exit 0). Absence is therefore probed here, from the same login
// shell the pane itself is built on (`loginShellArgv`), rather than discovered by attempting a run
// that would open a pane onto a login screen it cannot pass.
const PROBE_TIMEOUT_MS = 5_000

// In the order the design names them: a set token is Anthropic's documented container channel.
const CLAUDE_VARS = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']

// What the human is told the session will authenticate with, or null when nothing is reachable.
// It is a label, never the secret: grove cannot read a token's value here even if it wanted to —
// only whether the variable is set in the pane's environment.
export async function loginShellCredential(
  kind: AgentKind,
  o: { shell: string; claudeHome?: string },
): Promise<string | null> {
  // OpenCode cannot reach the no-credential state: its Zen free tier authenticates by the client
  // being opencode (measured, `0 credentials`, no auth.json), and a host `opencode auth login`
  // lands in the auth.json grove already mounts. Nothing to probe, so nothing is spawned.
  if (kind !== 'claude') return "the host's opencode auth.json, or the free tier"

  for (const name of CLAUDE_VARS) {
    if (await probe(o.shell, name)) return name
  }
  // `CLAUDE_CONFIG_DIR` already reaches this file, so its presence is a credential grove can see.
  if (o.claudeHome && fs.existsSync(path.join(o.claudeHome, '.credentials.json'))) return '~/.claude/.credentials.json'
  return null
}

// `${VAR:-}` prints the value when set and nothing when not; grove keeps only the fact, discards
// the output. A spawn error, a timeout or empty output all mean "not found" — never a throw,
// because a probe that throws would fail a create for a reason the human cannot act on.
function probe(shell: string, name: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(shell, ['-l', '-i', '-c', `echo \${${name}:-}`], { timeout: PROBE_TIMEOUT_MS }, (err, stdout) =>
      resolve(!err && stdout.trim() !== ''),
    )
  })
}