import { randomUUID } from 'node:crypto'
import pty from 'node-pty'
import xtermHeadless from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import type { IPty } from 'node-pty'
import type { TabInfo } from '../protocol/messages.ts'

const { Terminal } = xtermHeadless
const SCROLLBACK = 2000

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
  listeners: Set<AttachListener>
}

export class PtyTable {
  private readonly tabs = new Map<string, Tab>()

  create(spec: TabSpec): string {
    const id = spec.id ?? randomUUID().slice(0, 8)
    if (this.tabs.has(id)) throw new TabError('tabExists', `tab ${id} already exists`)

    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value
    }
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
      listeners: new Set(),
    }
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
    }))
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

export class TabError extends Error {
  constructor(
    readonly code: 'tabNotFound' | 'tabExists',
    message: string,
  ) {
    super(message)
  }
}
