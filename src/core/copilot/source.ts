import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { AgentEvent, AgentSource, SessionSnapshot } from '../agents/types'

// GitHub Copilot CLI sessions, launch only: no events yet, so a card has no status (statusNeedsEvent).
// Verified on copilot 1.0.102: `--session-id <uuid>` sets the id of a new session; `--resume=<id>` resumes it.
const PROBE_TIMEOUT_MS = 5_000

// Whether `copilot` is on the PATH of the login shell the pane is built on (`loginShellArgv`), never a throw:
// a probe that fails to run counts as missing, so the human is told rather than left with a dead pane.
export function copilotOnPath(shell: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(shell, ['-l', '-i', '-c', 'command -v copilot'], { timeout: PROBE_TIMEOUT_MS }, (err, stdout) => resolve(!err && stdout.trim() !== ''))
  })
}

export class CopilotSource implements AgentSource {
  readonly kind = 'copilot' as const
  readonly statusNeedsEvent = true

  // `onPath` is injected for tests; the default asks the login shell.
  constructor(private readonly opts: { shell?: string; onPath?: () => Promise<boolean> } = {}) {}

  mintId(): string {
    return randomUUID()
  }

  argv(id: string, mode: 'start' | 'resume'): string[] {
    return mode === 'start' ? ['copilot', '--session-id', id] : ['copilot', `--resume=${id}`]
  }

  // The error code a create is refused with, or null when it can go ahead. Copilot keeps its sign-in in the
  // system keychain and offers no cheap way to read it, so a signed-out Copilot says so itself in its pane.
  async preflight(): Promise<string | null> {
    const found = await (this.opts.onPath ?? (() => copilotOnPath(this.opts.shell ?? process.env.SHELL ?? '/bin/zsh')))()
    return found ? null : 'no-copilot'
  }

  start(onEvent: (e: AgentEvent) => void): void {
    onEvent({ type: 'connected', version: 'launch-only' })
  }

  async snapshot(_ids: string[]): Promise<Map<string, SessionSnapshot>> {
    return new Map()
  }

  async lastWrites(_id: string): Promise<string[]> {
    return []
  }

  forget(_id: string): void {}

  stop(): void {}
}
