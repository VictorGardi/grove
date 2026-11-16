import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { sliceLines } from './fileSlice.ts'
import type { UsageRequest } from './history.ts'
import type { UsageReader } from './reader.ts'

export interface CopilotReaderOptions {
  // Copilot's own folder: <copilotHome>/session-state/<id>/events.jsonl. The caller resolves $COPILOT_HOME.
  copilotHome: string
  // How much of a file one step reads. Default 1 MiB.
  chunkBytes?: number
}

const CHUNK_BYTES = 1 << 20

interface Listed {
  file: string
  size: number
}

interface Place {
  offset: number
  // The session's working folder, as last seen on a start or resume line, kept so a later pass reading only new lines knows it.
  cwd: string
}

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0)
const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)
const record = (value: unknown): Record<string, unknown> | undefined => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined)

// The working folder a start or resume line names, or undefined for any other line.
export function cwdOf(line: string): string | undefined {
  if (!line.includes('"session.start"') && !line.includes('"session.resume"')) return undefined
  const parsed = parse(line)
  if (parsed === undefined || (parsed.type !== 'session.start' && parsed.type !== 'session.resume')) return undefined
  return text(record(record(parsed.data)?.context)?.cwd)
}

function parse(line: string): Record<string, unknown> | undefined {
  try {
    return record(JSON.parse(line))
  } catch {
    return undefined
  }
}

// One per-request usage record as a request, or undefined when the line is not one. Only `session.usage_record` counts: the
// checkpoint and shutdown records are running totals of the same requests. The key is the record's accounting usage id, unique
// across all records, shortened by a hash (the id is a long base64 string). Fresh input is the input count without what the cache
// read and wrote. A record is a helper's when Copilot says it came from a subagent, by its initiator, its interaction type or an
// agent id on the line. No conversation text is read: only the usage figures, the model, the time and the ids.
export function requestOf(line: string, folder: string): UsageRequest | undefined {
  if (!line.includes('"session.usage_record"')) return undefined
  const parsed = parse(line)
  if (parsed === undefined || parsed.type !== 'session.usage_record') return undefined
  const usage = record(record(parsed.data)?.usage)
  const usageId = text(record(usage?.accounting)?.usageId)
  const at = typeof parsed.timestamp === 'string' ? Date.parse(parsed.timestamp) : NaN
  if (usage === undefined || usageId === undefined || !Number.isFinite(at)) return undefined
  const cacheRead = count(usage.cacheReadTokens)
  const cacheWrite = count(usage.cacheWriteTokens)
  // A credit figure counts only when Copilot says it is complete (or says nothing about it).
  const nano = record(usage.copilotUsage)?.totalNanoAiu
  const credited = typeof nano === 'number' && Number.isFinite(nano) && nano >= 0 && (usage.aiCreditsStatus === undefined || usage.aiCreditsStatus === 'complete')
  return {
    key: crypto.createHash('sha256').update(usageId).digest('base64url').slice(0, 22),
    agent: 'copilot',
    source: 'copilot',
    model: text(usage.model) ?? '',
    folder,
    at,
    input: Math.max(0, count(usage.inputTokens) - cacheRead - cacheWrite),
    output: count(usage.outputTokens),
    cacheRead,
    cacheWrite,
    helper: usage.initiator === 'sub-agent' || usage.interactionType === 'conversation-subagent' || text(parsed.agentId) !== undefined || text(usage.agentId) !== undefined,
    nanoAiu: credited ? nano : null,
  }
}

// The `cwd:` of a session's workspace file, the fallback for a session whose events name no folder. Nothing else in it is read.
async function workspaceCwd(dir: string): Promise<string> {
  try {
    const match = /^cwd:[ \t]*(.+?)[ \t]*$/m.exec(await fs.promises.readFile(path.join(dir, 'workspace.yaml'), 'utf8'))
    return match === null ? '' : match[1].replace(/^(['"])(.*)\1$/, '$2')
  } catch {
    return ''
  }
}

async function listEvents(copilotHome: string): Promise<Listed[]> {
  const root = path.join(copilotHome, 'session-state')
  let sessions: fs.Dirent[]
  try {
    sessions = await fs.promises.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const found = await Promise.all(
    sessions
      .filter((entry) => entry.isDirectory())
      .map(async (entry): Promise<Listed | undefined> => {
        const file = path.join(root, entry.name, 'events.jsonl')
        try {
          const stat = await fs.promises.stat(file)
          return stat.isFile() ? { file, size: stat.size } : undefined
        } catch {
          return undefined
        }
      }),
  )
  return found.filter((item): item is Listed => item !== undefined).sort((a, b) => (a.file < b.file ? -1 : 1))
}

// Reads Copilot's session events incrementally, by file position: after the first pass only what a session's events gained is read.
export function createCopilotReader(options: CopilotReaderOptions): UsageReader {
  const chunkBytes = options.chunkBytes ?? CHUNK_BYTES
  let places = new Map<string, Place>()
  let queue: Listed[] | undefined
  const failed = new Set<string>()

  const pending = async (): Promise<Listed[]> => (await listEvents(options.copilotHome)).filter((item) => item.size !== (places.get(item.file)?.offset ?? 0))

  async function slice(item: Listed, out: UsageRequest[]): Promise<boolean> {
    let place = places.get(item.file) ?? { offset: 0, cwd: '' }
    if (item.size < place.offset) place = { offset: 0, cwd: '' }
    const { lines, next, more } = await sliceLines(item.file, place.offset, item.size, chunkBytes)
    let cwd = place.cwd
    let fallback = false
    for (const line of lines) {
      cwd = cwdOf(line) ?? cwd
      if (!line.includes('"session.usage_record"')) continue
      if (cwd === '' && !fallback) {
        fallback = true
        cwd = await workspaceCwd(path.dirname(item.file))
      }
      const request = requestOf(line, cwd)
      if (request) out.push(request)
    }
    places.set(item.file, { offset: next, cwd })
    return more
  }

  return {
    agent: 'copilot',
    async step() {
      queue ??= await pending()
      const item = queue[0]
      if (item === undefined) {
        queue = undefined
        return { requests: [], done: true }
      }
      const requests: UsageRequest[] = []
      try {
        if (!(await slice(item, requests))) queue.shift()
      } catch (error) {
        // An unreadable file gives nothing and does not stop the others; it is reported once.
        queue.shift()
        if (!failed.has(item.file)) {
          failed.add(item.file)
          console.error(`core: could not read ${item.file} for usage: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      if (queue.length === 0) queue = undefined
      return { requests, done: queue === undefined }
    },
    state: () => ({ files: Object.fromEntries(places) }),
    restore(state) {
      const files = (state as { files?: unknown } | null)?.files
      places = new Map()
      if (files !== null && typeof files === 'object') {
        for (const [file, place] of Object.entries(files)) {
          const { offset, cwd } = (place ?? {}) as Partial<Place>
          if (typeof offset === 'number' && offset >= 0) places.set(file, { offset, cwd: typeof cwd === 'string' ? cwd : '' })
        }
      }
      queue = undefined
    },
    async skipToEnd() {
      queue = undefined
      places = new Map((await listEvents(options.copilotHome)).map((item) => [item.file, { offset: item.size, cwd: places.get(item.file)?.cwd ?? '' }]))
    },
  }
}
