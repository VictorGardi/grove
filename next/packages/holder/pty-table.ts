import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { promisify } from 'node:util'
import pty from 'node-pty'
import xtermHeadless from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import type { IPty } from 'node-pty'
import type { TabInfo } from '../protocol/messages.ts'

const execFileAsync = promisify(execFile)
const { Terminal } = xtermHeadless
const SCROLLBACK = 2000
const INHERITED_CLAUDE_SESSION_VARS = [
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_BRIDGE_SESSION_ID',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
]

export interface TabSpec {
  id?: string
  command: string
  args?: string[]
  cwd: string
  env?: Record<string, string>
  cols: number
  rows: number
}

export interface AttachListener {
  onOutput: (data: string) => void
  onExit: (exitCode: number) => void
}

export interface TabStatus {
  state: string
  kind?: string
}

export interface Attachment {
  screen: string
  cols: number
  rows: number
  detach: () => void
  flush: () => void
}

interface Tab {
  info: { id: string; command: string; cwd: string }
  proc: IPty
  term: InstanceType<typeof Terminal>
  serialize: SerializeAddon
  cols: number
  rows: number
  alive: boolean
  exitCode: number | null
  status: TabStatus | null
  listeners: Set<AttachListener>
}

export class PtyTable {
  private readonly tabs = new Map<string, Tab>()
  private readonly statusListeners = new Set<(id: string, status: TabStatus) => void>()

  create(spec: TabSpec): string {
    const id = spec.id ?? randomUUID().slice(0, 8)
    if (this.tabs.has(id)) throw new TabError('tabExists', `tab ${id} already exists`)

    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value
    }
    // The tab is its own terminal: nothing of the terminal or tmux the app was started from leaks into it.
    for (const key of Object.keys(env)) {
      if (key === 'TMUX' || key === 'TMUX_PANE' || key.startsWith('TERM_PROGRAM')) delete env[key]
    }
    // Nor does the Claude Code session the app was started from: a marker like CLAUDE_CODE_CHILD_SESSION makes every claude in a tab skip saving its transcript.
    for (const key of INHERITED_CLAUDE_SESSION_VARS) delete env[key]
    env.TERM = 'xterm-256color'
    env.COLORTERM = 'truecolor'
    // An app started from the Dock has no locale, and zsh then draws the prompt's symbols wrong.
    if (!env.LANG && !env.LC_ALL) env.LANG = 'en_US.UTF-8'
    Object.assign(env, spec.env)

    const proc = pty.spawn(spec.command, spec.args ?? [], {
      name: 'xterm-256color',
      cols: spec.cols,
      rows: spec.rows,
      cwd: spec.cwd,
      env,
    })
    const term = new Terminal({ cols: spec.cols, rows: spec.rows, scrollback: SCROLLBACK, allowProposedApi: true })
    const serialize = new SerializeAddon()
    term.loadAddon(serialize)

    const tab: Tab = {
      info: { id, command: spec.command, cwd: spec.cwd },
      proc,
      term,
      serialize,
      cols: spec.cols,
      rows: spec.rows,
      alive: true,
      exitCode: null,
      status: null,
      listeners: new Set(),
    }
    term.parser.registerOscHandler(7501, (data) => {
      if (data === '?') {
        proc.write('\x1b]7501;?\x1b\\')
        return true
      }
      const status = parseStatusRecord(data)
      if (status === null) return false
      tab.status = status
      for (const listener of this.statusListeners) listener(id, status)
      return true
    })
    this.tabs.set(id, tab)

    proc.onData((data) => {
      if (this.tabs.get(id) !== tab) return
      term.write(data)
      for (const listener of tab.listeners) listener.onOutput(data)
    })
    proc.onExit(({ exitCode }) => {
      tab.alive = false
      tab.exitCode = exitCode
      for (const listener of tab.listeners) listener.onExit(exitCode)
      tab.listeners.clear()
      if (this.tabs.get(id) !== tab) term.dispose()
    })
    return id
  }

  list(): TabInfo[] {
    return [...this.tabs.values()].map((tab) => ({
      id: tab.info.id,
      command: tab.info.command,
      cwd: tab.info.cwd,
      alive: tab.alive,
      exitCode: tab.exitCode,
      status: tab.status,
      foreground: null,
      argv0: null,
    }))
  }

  onStatus(listener: (id: string, status: TabStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  // The live view: the folder the shell is in now (not where it started) and the name of the program in the
  // foreground (the shell itself when nothing else runs). A tab that has exited keeps its last cwd and has no foreground.
  async listLive(): Promise<TabInfo[]> {
    const rows = await processTable()
    return Promise.all(
      [...this.tabs.values()].map(async (tab) => {
        const alive = tab.alive
        const foreground = alive ? tab.proc.process : null
        const argv0 = alive ? argv0Of(rows, tab.proc.pid) : null
        const cwd = alive ? await liveCwd(tab.proc.pid, tab.info.cwd) : tab.info.cwd
        return {
          id: tab.info.id,
          command: tab.info.command,
          cwd,
          alive,
          exitCode: tab.exitCode,
          status: tab.status,
          foreground,
          argv0,
        }
      })
    )
  }

  write(id: string, data: string): void {
    const tab = this.get(id)
    if (tab.alive) tab.proc.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const tab = this.get(id)
    tab.cols = cols
    tab.rows = rows
    if (tab.alive) tab.proc.resize(cols, rows)
    tab.term.resize(cols, rows)
  }

  kill(id: string): void {
    const tab = this.get(id)
    this.tabs.delete(id)
    tab.listeners.clear()
    if (tab.alive) tab.proc.kill()
    else tab.term.dispose()
  }

  killAll(): void {
    for (const id of [...this.tabs.keys()]) this.kill(id)
  }

  // The visible rows of the tab's screen as plain text, one line per row. The pending writes are
  // flushed first so the text reflects every byte the shell has sent so far.
  screen(id: string): Promise<string> {
    const tab = this.get(id)
    return new Promise((resolve) => {
      tab.term.write('', () => {
        const buffer = tab.term.buffer.active
        const rows: string[] = []
        for (let row = 0; row < tab.term.rows; row++) {
          rows.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '')
        }
        resolve(rows.join('\n'))
      })
    })
  }

  // The live listener is registered now, so no chunk written after this call can be
  // missed. Its events queue until the screen snapshot is taken, and `flush` (called
  // once the attach reply is sent) delivers them in order: none is in the snapshot,
  // and none is lost.
  attach(id: string, listener: AttachListener): Promise<Attachment> {
    const tab = this.get(id)
    type Queued = { exit: boolean; run: () => void }
    let queued: Queued[] | undefined = []
    let detached = false
    const live: AttachListener = {
      onOutput: (data) =>
        queued ? queued.push({ exit: false, run: () => listener.onOutput(data) }) : listener.onOutput(data),
      onExit: (exitCode) =>
        queued ? queued.push({ exit: true, run: () => listener.onExit(exitCode) }) : listener.onExit(exitCode),
    }
    if (tab.alive) tab.listeners.add(live)
    return new Promise((resolve) => {
      tab.term.write('', () => {
        const attachment = { screen: tab.serialize.serialize(), cols: tab.cols, rows: tab.rows }
        resolve({
          ...attachment,
          detach: () => {
            detached = true
            tab.listeners.delete(live)
          },
          flush: () => {
            // An exit is always reported, even when this listener was superseded; output
            // queued before a detach is not.
            for (const event of queued ?? []) if (event.exit || !detached) event.run()
            queued = undefined
          },
        })
      })
    })
  }

  private get(id: string): Tab {
    const tab = this.tabs.get(id)
    if (!tab) throw new TabError('tabNotFound', `no tab ${id}`)
    return tab
  }
}

function parseStatusRecord(data: string): TabStatus | null {
  const fields = new Map<string, string>()
  for (const field of data.split(';')) {
    const separator = field.indexOf('=')
    if (separator <= 0) continue
    fields.set(field.slice(0, separator), field.slice(separator + 1))
  }
  const state = fields.get('state')
  if (state === undefined || fields.has('id')) return null
  const kind = fields.get('kind')
  return kind === undefined ? { state } : { state, kind }
}

export class TabError extends Error {
  constructor(
    readonly code: 'tabNotFound' | 'tabExists',
    message: string,
  ) {
    super(message)
  }
}

// The working folder of a process, read with lsof (macOS and Linux have it; no native binding is needed). A failed
// read keeps the fallback, the folder the tab started in, so a missing lsof never breaks the tab. Cached for a
// short time: the core asks on every tick.
const CWD_TTL_MS = 2000
const cwdCache = new Map<number, { at: number; cwd: string }>()

export async function liveCwd(pid: number, fallback: string): Promise<string> {
  const hit = cwdCache.get(pid)
  if (hit && Date.now() - hit.at < CWD_TTL_MS) return hit.cwd
  let cwd = fallback
  try {
    const { stdout } = await execFileAsync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { timeout: 2000 })
    const line = stdout.split('\n').find((text) => text.startsWith('n'))
    if (line !== undefined && line.length > 1) cwd = line.slice(1)
  } catch {
    // Keep the fallback.
  }
  cwdCache.set(pid, { at: Date.now(), cwd })
  return cwd
}

export interface ProcessRow {
  // The foreground process group of the process's terminal (-1 with none).
  tpgid: number
  args: string
}

// Every process's command line, read with one `ps` for all tabs. A failed read is an empty table: no tab then has an argv name.
export async function processTable(): Promise<Map<number, ProcessRow>> {
  const rows = new Map<number, ProcessRow>()
  try {
    const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,tpgid=,args='], { timeout: 2000 })
    for (const line of stdout.split('\n')) {
      const match = /^\s*(\d+)\s+(-?\d+)\s+(.*)$/.exec(line)
      if (match) rows.set(Number(match[1]), { tpgid: Number(match[2]), args: match[3] })
    }
  } catch {
    // Keep the empty table.
  }
  return rows
}

// The base name of the first word of the command line of the program in a tab's foreground: the name it was run under.
export function argv0Of(rows: Map<number, ProcessRow>, shellPid: number): string | null {
  const foreground = rows.get(shellPid)?.tpgid
  const args = foreground === undefined ? undefined : rows.get(foreground)?.args
  if (args === undefined) return null
  return path.basename(args.split(' ')[0]) || null
}
