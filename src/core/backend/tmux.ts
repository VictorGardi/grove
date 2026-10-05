import { execFile } from 'node:child_process'
import os from 'node:os'
import { promisify } from 'node:util'
import * as pty from 'node-pty'
import type { AttachHandle, SessionBackend } from './types'

const run = promisify(execFile)

export interface TmuxBackendOptions {
  tmuxPath: string
  socket: string
  confPath: string
  env: NodeJS.ProcessEnv
}

const NO_SERVER = /no server running|error connecting/

function stderrOf(e: unknown): string {
  return String((e as { stderr?: unknown }).stderr ?? '')
}

export class TmuxBackend implements SessionBackend {
  constructor(private readonly opts: TmuxBackendOptions) {}

  private tmux(...args: string[]) {
    const { tmuxPath, socket, env } = this.opts
    return run(tmuxPath, ['-L', socket, ...args], { env })
  }

  async ensureConfig(): Promise<void> {
    try {
      await this.tmux('list-sessions')
    } catch {
      return // no server yet: the next new-session gets -f
    }
    await this.tmux('source-file', this.opts.confPath)
  }

  async create(o: { name: string; cwd: string; cols: number; rows: number; argv?: string[] }): Promise<void> {
    await this.tmux(
      '-f', this.opts.confPath,
      'new-session', '-d', '-s', o.name, '-c', o.cwd, '-x', String(o.cols), '-y', String(o.rows),
      ...(o.argv ? ['--', ...o.argv] : [])
    )
  }

  async setColors(name: string, fg: string, bg: string): Promise<void> {
    // pane targets need the trailing colon: `=name` alone is read as a window name
    await this.tmux('select-pane', '-t', `=${name}:`, '-P', `fg=${fg},bg=${bg}`)
  }

  async list(): Promise<Set<string>> {
    try {
      const { stdout } = await this.tmux('list-sessions', '-F', '#{session_name}')
      return new Set(stdout.split('\n').filter(Boolean))
    } catch (e) {
      if (NO_SERVER.test(stderrOf(e))) return new Set()
      throw e
    }
  }

  async cwds(): Promise<Map<string, string>> {
    try {
      const { stdout } = await this.tmux('list-sessions', '-F', '#{session_name}\t#{pane_current_path}')
      return new Map(stdout.split('\n').filter(Boolean).map((l) => l.split('\t', 2) as [string, string]))
    } catch (e) {
      if (NO_SERVER.test(stderrOf(e))) return new Map()
      throw e
    }
  }

  async kill(name: string): Promise<void> {
    try {
      await this.tmux('kill-session', '-t', `=${name}`)
    } catch (e) {
      const err = stderrOf(e)
      if (/can't find session/.test(err) || NO_SERVER.test(err)) return
      throw e
    }
  }

  attach(name: string, cols: number, rows: number): AttachHandle {
    const { tmuxPath, socket, env } = this.opts
    const p = pty.spawn(tmuxPath, ['-L', socket, 'attach-session', '-t', `=${name}`], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: os.homedir(),
      env: { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>,
    })
    let killed = false
    return {
      onData: (cb) => { p.onData(cb) },
      onExit: (cb) => { p.onExit(() => cb()) },
      write: (d) => p.write(d),
      resize: (c, r) => p.resize(c, r),
      kill: () => {
        if (killed) return
        killed = true
        p.kill()
      },
    }
  }
}
