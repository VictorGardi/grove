import fs from 'node:fs'
import path from 'node:path'
import type { StatusEvent } from './contract.ts'

// The poll is the backstop for a missed fs.watch event and for a spool that does not exist yet.
export const POLL_MS = 1000

// One spool record. `at` is missing only in a hand-edited line; then the clock stands in.
export interface SpoolRecord {
  event: string
  at: number | undefined
  payload: unknown
}

export interface SpoolRead {
  records: SpoolRecord[]
  // Byte offset just past the last complete line read. A partial last line waits for its newline.
  offset: number
  corrupt: number
}

// Turns one complete line into a record, or null when the line is corrupt.
export type SpoolParser = (line: string) => SpoolRecord | null

export interface SpoolSourceOptions {
  spoolFile: string
  offsetFile: string
  clock: () => number
  onEvent: (event: StatusEvent, at: number) => void
  // The status events one record means, in order. Called once per record, so an adapter may keep state between them.
  toEvents: (record: SpoolRecord) => StatusEvent[]
  parse?: SpoolParser
}

export interface SpoolSource {
  // Delivers anything new and reports whether the read worked. Runs on creation and on each fs.watch event.
  drain: () => boolean
  // Complete lines that did not parse, counted since this source was created.
  corruptLines: () => number
  close: () => void
}

// Reads complete lines from a byte offset. A line that `parse` rejects is corrupt.
export function readSpool(spoolFile: string, fromOffset: number, parse: SpoolParser = parseSpoolLine): SpoolRead {
  let size: number
  try {
    size = fs.statSync(spoolFile).size
  } catch {
    return { records: [], offset: fromOffset, corrupt: 0 }
  }
  // A spool shorter than the saved offset was replaced, so it is read from the start.
  const start = size < fromOffset ? 0 : fromOffset
  if (size === start) return { records: [], offset: start, corrupt: 0 }

  const buffer = Buffer.alloc(size - start)
  let filled = 0
  let fd: number | undefined
  try {
    fd = fs.openSync(spoolFile, 'r')
    while (filled < buffer.length) {
      const n = fs.readSync(fd, buffer, filled, buffer.length - filled, start + filled)
      if (n === 0) break
      filled += n
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }

  const lastNewline = buffer.subarray(0, filled).lastIndexOf(0x0a)
  if (lastNewline === -1) return { records: [], offset: start, corrupt: 0 }

  const records: SpoolRecord[] = []
  let corrupt = 0
  for (const line of buffer.subarray(0, lastNewline).toString('utf8').split('\n')) {
    if (line.trim() === '') continue
    const record = parse(line)
    if (record === null) corrupt += 1
    else records.push(record)
  }
  return { records, offset: start + lastNewline + 1, corrupt }
}

// The line shape hook.mjs writes: a JSON object with a string `event`, an optional `at` and a `payload`.
export function parseSpoolLine(line: string): SpoolRecord | null {
  try {
    const value = JSON.parse(line)
    if (value === null || typeof value !== 'object' || typeof value.event !== 'string') return null
    return {
      event: value.event,
      at: typeof value.at === 'number' ? value.at : undefined,
      payload: value.payload ?? null,
    }
  } catch {
    return null
  }
}

// A source that reads a spool from its saved offset, delivers each new record's events, and beats the heartbeat.
export function createSpoolSource(options: SpoolSourceOptions): SpoolSource {
  const { spoolFile, offsetFile, clock, onEvent, toEvents, parse = parseSpoolLine } = options
  let offset = loadOffset(offsetFile)
  let corrupt = 0
  let watcher: fs.FSWatcher | null = null

  // Never throws: one failed read or save is logged and the next drain tries again.
  const drain = (): boolean => {
    try {
      const read = readSpool(spoolFile, offset, parse)
      corrupt += read.corrupt
      const fallbackAt = clock()
      for (const record of read.records) {
        const at = record.at ?? fallbackAt
        for (const event of toEvents(record)) onEvent(event, at)
      }
      // Saved only after delivery: a crash in between replays lines rather than skipping them.
      if (read.offset !== offset) {
        offset = read.offset
        saveOffset(offsetFile, offset)
      }
      return true
    } catch (error) {
      console.error(`core: could not read the agent spool ${spoolFile}: ${errorText(error)}`)
      return false
    }
  }

  // A watch that fails is closed; the poll goes on and recreates it.
  const watch = (): void => {
    if (watcher !== null || !fs.existsSync(spoolFile)) return
    try {
      const current: fs.FSWatcher = fs.watch(spoolFile, (eventType) => {
        if (eventType === 'rename') {
          current.close()
          if (watcher === current) watcher = null
        }
        drain()
      })
      current.on('error', (error) => {
        console.error(`core: the agent spool watch failed: ${errorText(error)}`)
        current.close()
        if (watcher === current) watcher = null
      })
      watcher = current
    } catch {
      watcher = null
    }
  }

  drain()
  watch()
  // The poll is the reader's heartbeat: it reports only after a drain that worked, never on hook activity.
  const timer = setInterval(() => {
    watch()
    if (!drain()) return
    try {
      onEvent({ kind: 'heartbeat' }, clock())
    } catch (error) {
      console.error(`core: could not report the agent spool heartbeat: ${errorText(error)}`)
    }
  }, POLL_MS)

  return {
    drain,
    corruptLines: () => corrupt,
    close: () => {
      clearInterval(timer)
      watcher?.close()
      watcher = null
    },
  }
}

function loadOffset(file: string): number {
  try {
    const value = (JSON.parse(fs.readFileSync(file, 'utf8')) as { offset?: unknown }).offset
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0
  } catch {
    return 0
  }
}

function saveOffset(file: string, offset: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ offset }) + '\n', { mode: 0o600 })
  fs.renameSync(tmp, file)
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
