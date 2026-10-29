import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AgentEvent, AgentSource, SessionSnapshot } from '../agents/types'
import { SpoolTail, type SpoolRecord } from '../claude/spool'
import { CopilotEventLog } from './events'
import { hooksJson, pluginJson } from './hooks'
import { emptyFold, step, type CopilotFold } from './normalise'

// GitHub Copilot CLI sessions: a per-launch plugin (`--plugin-dir`) whose hooks append to <dir>/<id>.jsonl, tailed
// and folded like Claude's spool. Copilot's own events.jsonl also supplies root turn boundaries, abort/shutdown and
// context readings when hooks are unavailable. Hooks supply attention and write paths. Not signalled: subagents.
// Verified on copilot 1.0.102: `--session-id <uuid>` sets the id of a new session; `--resume=<id>` resumes it.
const PROBE_TIMEOUT_MS = 5_000
// Whether `copilot` is on the PATH of the login shell the pane is built on (`loginShellArgv`), never a throw:
// a probe that fails to run counts as missing, so the human is told rather than left with a dead pane. A probe
// killed by its timeout (a slow rc file) proves nothing, so it does not refuse: the pane shows any real error.
export function copilotOnPath(shell: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(shell, ['-l', '-i', '-c', 'command -v copilot'], { timeout: timeoutMs }, (err, stdout) =>
      resolve(err ? (err as { killed?: boolean }).killed === true : stdout.trim() !== '')
    )
  })
}

export class CopilotSource implements AgentSource {
  readonly kind = 'copilot' as const
  readonly statusNeedsEvent = true
  private readonly folds = new Map<string, CopilotFold>()
  private readonly watched = new Set<string>()
  private readonly tail: SpoolTail
  private readonly log: CopilotEventLog
  private timer: ReturnType<typeof setInterval> | undefined
  private onEvent: ((e: AgentEvent) => void) | null = null
  private found = false // a positive probe is kept: the login-shell start-up costs time on every create

  // `dir` holds the spools and one plugin folder per session. `home` is Copilot's own dir (default $COPILOT_HOME or
  // ~/.copilot). `onPath` is injected for tests; the default asks the login shell.
  constructor(private readonly opts: { dir: string; home?: string; shell?: string; onPath?: () => Promise<boolean> }) {
    this.tail = new SpoolTail(opts.dir, (id, records, initial) => this.fold(id, records, initial))
    this.log = new CopilotEventLog(opts.home ?? process.env.COPILOT_HOME ?? path.join(os.homedir(), '.copilot'))
  }

  mintId(): string {
    return randomUUID()
  }

  // `--interactive=<prompt>` (`-i`) starts the interactive UI and runs the prompt; the `=` form keeps a prompt that starts with `-` from reading as a flag.
  argv(id: string, mode: 'start' | 'resume', opts?: { prompt?: string; name?: string; model?: string }): string[] {
    this.watched.add(id)
    const session = mode === 'start' ? ['--session-id', id] : [`--resume=${id}`]
    const prompt = mode === 'start' && opts?.prompt ? [`--interactive=${opts.prompt}`] : []
    return ['copilot', ...session, '--plugin-dir', this.writePlugin(id), ...(opts?.model ? ['--model', opts.model] : []), ...prompt]
  }

  // The error code a create is refused with, or null when it can go ahead. Copilot keeps its sign-in in the
  // system keychain and offers no cheap way to read it, so a signed-out Copilot says so itself in its pane.
  async preflight(): Promise<string | null> {
    if (this.found) return null
    this.found = await (this.opts.onPath ?? (() => copilotOnPath(this.opts.shell ?? process.env.SHELL ?? '/bin/zsh')))()
    return this.found ? null : 'no-copilot'
  }

  start(onEvent: (e: AgentEvent) => void): void {
    this.onEvent = onEvent
    this.tail.start() // records already there are folded without events
    for (const id of new Set([...this.watched, ...this.folds.keys()])) this.fold(id, this.log.read(id), true)
    onEvent({ type: 'connected', version: 'spool' })
    this.timer = setInterval(() => this.pollLog(), 1000)
  }

  // Keep watching idle sessions too: their next turn can start without another hook or resync.
  pollLog(): void {
    for (const id of this.watched) this.fold(id, this.log.read(id), false)
  }

  async snapshot(ids: string[]): Promise<Map<string, SessionSnapshot>> {
    const out = new Map<string, SessionSnapshot>()
    for (const id of ids) {
      this.watched.add(id)
      this.fold(id, this.log.read(id), !this.folds.has(id))
      const f = this.folds.get(id)
      if (!f) continue // no record yet: no status (live gate)
      out.set(id, { running: f.running, idleAt: f.idleAt, pending: [...f.pending].map(([id, kind]) => ({ id, kind })), children: [], ...(f.context && { context: f.context }) })
    }
    return out
  }

  async lastWrites(id: string): Promise<string[]> {
    return this.folds.get(id)?.lastWrite ?? []
  }

  // The session was removed: its spool and plugin folder go with it.
  forget(id: string): void {
    this.watched.delete(id)
    this.folds.delete(id)
    this.tail.forget(id)
    this.log.forget(id)
    fs.rmSync(this.spool(id), { force: true })
    fs.rmSync(this.pluginDir(id), { recursive: true, force: true })
  }

  stop(): void {
    this.tail.stop()
    clearInterval(this.timer)
  }

  private spool(id: string): string {
    return path.join(this.opts.dir, `${id}.jsonl`)
  }

  private pluginDir(id: string): string {
    return path.join(this.opts.dir, `${id}.plugin`)
  }

  // The plugin folder holds only the hooks for this session's spool; rewritten at every launch so a moved app dir stays right.
  private writePlugin(id: string): string {
    const dir = this.pluginDir(id)
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    fs.writeFileSync(path.join(dir, 'plugin.json'), pluginJson)
    fs.writeFileSync(path.join(dir, 'hooks.json'), hooksJson(this.spool(id)))
    return dir
  }

  private fold(id: string, records: SpoolRecord[], initial: boolean): void {
    let f = this.folds.get(id) ?? emptyFold(id)
    for (const r of records) {
      const out = step(f, r)
      f = out.fold
      this.folds.set(id, f)
      if (!initial) for (const e of out.events) this.onEvent?.(e)
    }
  }
}
