import fs from 'node:fs'
import path from 'node:path'

// One hook call as the hook command appends it: {"t": <UTC, s>, "e": <hook stdin JSON>}.
export interface SpoolRecord { t: string; e: unknown }

const START = '{"t":"' // inside e, a quote is always escaped, so this only starts a record (or an object keyed "t")

// Index after the brace closing the object at `from`, or -1 if it doesn't close in `text`.
function objectEnd(text: string, from: number): number {
  let depth = 0
  let inString = false
  for (let i = from; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (c === '\\') i++
      else if (c === '"') inString = false
    } else if (c === '"') inString = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return i + 1
  }
  return -1
}

function parseRecord(span: string): SpoolRecord | null {
  try {
    const v = JSON.parse(span) as { t?: unknown; e?: unknown }
    return typeof v.t === 'string' && typeof v.e === 'object' && v.e !== null ? { t: v.t, e: v.e } : null
  } catch {
    return null
  }
}

// Newline-agnostic (decision 6): glued records split, a corrupt span (interleaved appends) is skipped,
// and a trailing incomplete record is left unconsumed for the next read.
export function scanRecords(text: string): { records: SpoolRecord[]; consumed: number } {
  const records: SpoolRecord[] = []
  let consumed = 0
  let i = text.indexOf(START)
  while (i !== -1) {
    const end = objectEnd(text, i)
    const next = text.indexOf(START, i + 1)
    if (end === -1) {
      if (next === -1) break // still being written
      consumed = i = next // never closed before the next record: corrupt
      continue
    }
    const r = parseRecord(text.slice(i, end))
    if (r) {
      records.push(r)
      consumed = end
      i = text.indexOf(START, end)
    } else {
      consumed = next === -1 ? end : next
      i = next
    }
  }
  return { records, consumed }
}

// Tails every <id>.jsonl in `dir` by byte offset: fs.watch on the dir plus a 1 s poll as fallback.
// Records present at start() are delivered once with `initial`; later ones as they are appended.
export class SpoolTail {
  private offsets = new Map<string, number>()
  private watcher: fs.FSWatcher | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private stopped = false

  constructor(
    private readonly dir: string,
    private readonly onRecords: (id: string, records: SpoolRecord[], initial: boolean) => void,
  ) {}

  start(): void {
    try {
      fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    } catch {
      // unreadable dir: nothing to tail
    }
    for (const id of this.ids()) this.read(id, true)
    try {
      this.watcher = fs.watch(this.dir, (_, name) => {
        if (name?.endsWith('.jsonl')) this.read(name.slice(0, -'.jsonl'.length), false)
      })
      this.watcher.on('error', () => {})
    } catch {
      // the poll still runs
    }
    this.timer = setInterval(() => this.poll(), 1000)
  }

  poll(): void {
    for (const id of this.ids()) this.read(id, false)
  }

  forget(id: string): void {
    this.offsets.delete(id)
  }

  stop(): void {
    this.stopped = true
    this.watcher?.close()
    clearInterval(this.timer)
  }

  private ids(): string[] {
    try {
      return fs.readdirSync(this.dir).filter((n) => n.endsWith('.jsonl')).map((n) => n.slice(0, -'.jsonl'.length))
    } catch {
      return []
    }
  }

  private read(id: string, initial: boolean): void {
    if (this.stopped) return
    const offset = this.offsets.get(id) ?? 0
    let buf: Buffer
    try {
      const fd = fs.openSync(path.join(this.dir, `${id}.jsonl`), 'r')
      try {
        const size = fs.fstatSync(fd).size
        if (size <= offset) return
        buf = Buffer.alloc(size - offset)
        fs.readSync(fd, buf, 0, buf.length, offset)
      } finally {
        fs.closeSync(fd)
      }
    } catch {
      return // gone or unreadable; retried by the next poll
    }
    const text = buf.toString('utf8')
    const { records, consumed } = scanRecords(text)
    this.offsets.set(id, offset + Buffer.byteLength(text.slice(0, consumed)))
    if (records.length) this.onRecords(id, records, initial)
  }
}
