import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { UsageRequest } from './history.ts'
import { OPENCODE_SOURCE } from './history.ts'
import type { UsageReader } from './reader.ts'

export interface OpencodeReaderOptions {
  // OpenCode's data folder, which holds its database. The caller resolves it (opencodeDataDir).
  dataDir: string
  // How many rows of a table one step looks at. Default 500.
  rangeRows?: number
  // The time that tells a request given up on from one still in progress. Default the system clock.
  clock?: () => number
}

// What OpenCode's database holds for a request on Copilot's models, and what this reader keeps of it: the provider, the model, the
// tokens, the time and the session's folder and parent. No conversation text is ever selected: a message's row holds its content
// beside the figures, so the query names each figure it needs (json_extract) and never `data` itself.
const COPILOT_PROVIDER = 'github-copilot'
const RANGE_ROWS = 500
// A slice is held to about this long: rows of very different size make a fixed row count a slice of very different length (500 rows took
// 5 ms in one place and 90 ms in another), so the count starts small, halves after a slice that took longer and doubles after a short one.
const SLICE_MS = 20
const MIN_ROWS = 10
const START_ROWS = 100
// A request that has not completed after this long is given up on: its row failed or was left behind.
const PENDING_MS = 7 * 24 * 60 * 60 * 1000
const PENDING_MAX = 1000
const PENDING_CHUNK = 100

// OpenCode's data folder: $OPENCODE_DATA_DIR, else its XDG data home (~/.local/share) in a folder named opencode.
export const opencodeDataDir = (env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string =>
  env.OPENCODE_DATA_DIR || path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'opencode')

// The two table generations that live side by side in one database. 1: `message` with flat providerID and modelID, and `session`. 2:
// `session_message` with a model object, and `session_v2`. Both keep the message's own figures in `data` and its creation time in the row.
interface Generation {
  gen: 1 | 2
  messages: string
  sessions: string
  assistant: string
  provider: string
  model: string
}

// A value in the message's JSON, or NULL for a row whose JSON is not valid (one bad row must not fail the slice).
const field = (path: string): string => `CASE WHEN json_valid(m.data) THEN json_extract(m.data, '${path}') END`

const GENERATIONS: Generation[] = [
  { gen: 1, messages: 'message', sessions: 'session', assistant: `${field('$.role')} = 'assistant'`, provider: field('$.providerID'), model: field('$.modelID') },
  { gen: 2, messages: 'session_message', sessions: 'session_v2', assistant: "m.type = 'assistant'", provider: field('$.model.providerID'), model: field('$.model.id') },
]

const select = (g: Generation): string => `
  SELECT m.rowid AS rid, m.id AS id, m.time_created AS created,
    ${field('$.time.completed')} AS completed, ${g.provider} AS provider, ${g.model} AS model,
    ${field('$.tokens.input')} AS input, ${field('$.tokens.output')} AS output, ${field('$.tokens.reasoning')} AS reasoning,
    ${field('$.tokens.cache.read')} AS cacheRead, ${field('$.tokens.cache.write')} AS cacheWrite,
    s.directory AS directory, s.parent_id AS parent, s.time_created AS sessionCreated
  FROM ${g.messages} m LEFT JOIN ${g.sessions} s ON s.id = m.session_id
  WHERE ${g.assistant} AND (${g.provider} = '${COPILOT_PROVIDER}' OR ${g.provider} IS NULL)`

interface Pending {
  // Requests seen in progress, by message id, with when they began.
  [id: string]: number
}

interface TablePlace {
  // The highest row (rowid) looked at. Rows are added in order, so everything up to it has been seen.
  rid: number
  pending: Pending
}

interface Place {
  1: TablePlace
  2: TablePlace
}

interface Item {
  file: string
  generation: Generation
  started: boolean
  // The last row there was when the item began: rows added during a pass are for the next pass.
  max: number
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const count = (value: unknown): number => (finite(value) && value >= 0 ? value : 0)
const emptyPlace = (): Place => ({ 1: { rid: 0, pending: {} }, 2: { rid: 0, pending: {} } })
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

// OpenCode's main database, and the ones its release channels keep beside it (opencode-<channel>.db).
async function listDatabases(dataDir: string): Promise<string[]> {
  try {
    const entries = await fs.promises.readdir(dataDir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && /^opencode(-[\w.]+)?\.db$/.test(entry.name))
      .map((entry) => path.join(dataDir, entry.name))
      .sort()
  } catch {
    return []
  }
}

// Read-only, so a running OpenCode is never modified, and not waited for: a lock gives an error and the pass tries again later.
function open(file: string): DatabaseSync {
  const db = new DatabaseSync(file, { readOnly: true, timeout: 250 })
  db.exec('PRAGMA query_only = ON')
  return db
}

const hasTables = (db: DatabaseSync, g: Generation): boolean =>
  db.prepare('SELECT count(*) AS n FROM sqlite_master WHERE type = ? AND name IN (?, ?)').get('table', g.messages, g.sessions)?.n === 2

const maxRow = (db: DatabaseSync, g: Generation): number => {
  const max = db.prepare(`SELECT max(rowid) AS max FROM ${g.messages}`).get()?.max
  return finite(max) ? max : 0
}

// One row as a request, or undefined while it is not one yet: not Copilot's, not an assistant's request, still in progress, or a copy
// a fork inherited. `unfinished` says the row may complete later and is to be looked at again.
function requestOf(row: Record<string, unknown>): { request?: UsageRequest; unfinished: boolean } {
  const { id, created, completed, provider, model } = row
  if (typeof id !== 'string' || !finite(created) || (provider !== COPILOT_PROVIDER && provider !== null)) return { unfinished: false }
  // Fresh input (OpenCode's input already leaves out what the cache read and wrote), output, and the cache's. Any of them missing is
  // a request in progress or one that failed. Reasoning is generated text OpenCode keeps apart from `output`, so it is output here.
  const whole = [row.input, row.output, row.cacheRead, row.cacheWrite].every(finite)
  if (!whole || !finite(completed) || completed <= 0) return { unfinished: true }
  if (provider === null) return { unfinished: false }
  // A fork copies its parent's rows, with their own times: nothing in a session was made before the session.
  if (finite(row.sessionCreated) && created < row.sessionCreated) return { unfinished: false }
  return {
    unfinished: false,
    request: {
      key: id,
      agent: 'copilot',
      source: OPENCODE_SOURCE,
      model: typeof model === 'string' ? model : '',
      folder: typeof row.directory === 'string' ? row.directory : '',
      at: completed,
      input: count(row.input),
      output: count(row.output) + count(row.reasoning),
      cacheRead: count(row.cacheRead),
      cacheWrite: count(row.cacheWrite),
      helper: typeof row.parent === 'string' && row.parent !== '',
      nanoAiu: null,
      inGrove: null,
    },
  }
}

// Reads OpenCode's own database for the requests it made on Copilot's models (they are in no Copilot record). Read-only and by
// position: after the first pass only the rows added since are looked at, plus the requests that were still in progress.
export function createOpencodeReader(options: OpencodeReaderOptions): UsageReader {
  const rangeRows = options.rangeRows ?? RANGE_ROWS
  const places = new Map<string, Place>()
  let queue: Item[] | undefined
  const failed = new Set<string>()
  // How many rows the next slice looks at (never more than `rangeRows`), and how many tables the pass in progress has: what `progress` is made of.
  let rows = Math.min(rangeRows, START_ROWS)
  let tables: number | undefined

  const placeOf = (file: string): Place => {
    let place = places.get(file)
    if (place === undefined) places.set(file, (place = emptyPlace()))
    return place
  }

  // Looks at the rows (with this where-clause) and returns the requests among them; the rows still in progress are remembered.
  function look(db: DatabaseSync, g: Generation, where: string, values: SQLInputValue[], table: TablePlace, out: UsageRequest[]): Set<string> {
    const seen = new Set<string>()
    for (const row of db.prepare(`${select(g)} AND ${where} ORDER BY m.rowid`).all(...values)) {
      const { request, unfinished } = requestOf(row)
      const id = String(row.id)
      seen.add(id)
      if (request) out.push(request)
      if (unfinished && finite(row.created)) table.pending[id] = row.created
      else delete table.pending[id]
    }
    return seen
  }

  // Looks again at the requests that were in progress, in groups; one that is gone or older than PENDING_MS is dropped.
  function recheck(db: DatabaseSync, g: Generation, table: TablePlace, now: number, out: UsageRequest[]): void {
    let ids = Object.keys(table.pending)
    for (const id of ids) if (now - table.pending[id] > PENDING_MS) delete table.pending[id]
    ids = Object.keys(table.pending)
    if (ids.length > PENDING_MAX) for (const id of ids.sort((a, b) => table.pending[a] - table.pending[b]).slice(0, ids.length - PENDING_MAX)) delete table.pending[id]
    ids = Object.keys(table.pending)
    for (let i = 0; i < ids.length; i += PENDING_CHUNK) {
      const group = ids.slice(i, i + PENDING_CHUNK)
      const seen = look(db, g, `m.id IN (${group.map(() => '?').join(', ')})`, group, table, out)
      for (const id of group) if (!seen.has(id)) delete table.pending[id]
    }
  }

  async function begin(): Promise<Item[]> {
    const items: Item[] = []
    const files = await listDatabases(options.dataDir)
    // A database that is gone loses its place and its failure.
    for (const file of places.keys()) if (!files.includes(file)) places.delete(file)
    for (const file of failed) if (!files.includes(file)) failed.delete(file)
    for (const file of files) for (const generation of GENERATIONS) items.push({ file, generation, started: false, max: 0 })
    return items
  }

  return {
    agent: 'copilot',
    id: OPENCODE_SOURCE,
    async step() {
      if (queue === undefined) {
        queue = await begin()
        tables = queue.length
      }
      const item = queue[0]
      if (item === undefined) {
        queue = undefined
        return { requests: [], done: true }
      }
      const requests: UsageRequest[] = []
      const g = item.generation
      let db: DatabaseSync | undefined
      try {
        db = open(item.file)
        const table = placeOf(item.file)[g.gen]
        if (!hasTables(db, g)) {
          queue.shift()
        } else {
          if (!item.started) {
            item.started = true
            item.max = maxRow(db, g)
            // A database made again (vacuumed, restored) numbers its rows from the start: begin again, and the history merges repeats.
            if (item.max < table.rid) table.rid = 0
            recheck(db, g, table, (options.clock ?? Date.now)(), requests)
          }
          const to = Math.min(table.rid + rows, item.max)
          const began = performance.now()
          if (to > table.rid) look(db, g, 'm.rowid > ? AND m.rowid <= ?', [table.rid, to], table, requests)
          const took = performance.now() - began
          if (took > SLICE_MS) rows = Math.max(Math.min(MIN_ROWS, rangeRows), rows >> 1)
          else if (took < SLICE_MS / 4) rows = Math.min(rangeRows, rows * 2)
          table.rid = to
          if (to >= item.max) queue.shift()
        }
        failed.delete(item.file)
      } catch (error) {
        // An unreadable, locked or damaged database gives nothing and does not stop the others; its place stays, so a later pass tries again.
        const file = item.file
        queue = queue.filter((other) => other.file !== file)
        if (!failed.has(file)) {
          failed.add(file)
          console.error(`core: could not read ${path.basename(file)} for usage: ${message(error)}`)
        }
      } finally {
        try {
          db?.close()
        } catch {}
      }
      if (queue.length === 0) queue = undefined
      return { requests, done: queue === undefined }
    },
    tracked: () => places.size,
    progress() {
      if (tables === undefined) return undefined
      if (queue === undefined || tables === 0) return 1
      const current = queue[0]
      const table = current?.started && current.max > 0 ? placeOf(current.file)[current.generation.gen].rid / current.max : 0
      return Math.min(1, (tables - queue.length + table) / tables)
    },
  }
}
