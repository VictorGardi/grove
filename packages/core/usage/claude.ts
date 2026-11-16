import fs from 'node:fs'
import path from 'node:path'
import { sliceLines } from './fileSlice.ts'
import type { GroveSessions } from './groveSessions.ts'
import { CLAUDE_CODE, CLAUDE_DESKTOP, type UsageRequest } from './history.ts'
import type { UsageReader } from './reader.ts'

export interface ClaudeReaderOptions {
  // Claude's projects folder: <project>/<session>.jsonl, and <project>/<session>/subagents/*.jsonl for helper agents.
  projectsDir: string
  // How much of a file one step reads. Default 1 MiB.
  chunkBytes?: number
  // Grove's own records of the sessions it ran, to tell which requests were Grove's. Without it Grove cannot tell for Claude Code.
  grove?: GroveSessions
}

const CHUNK_BYTES = 1 << 20
// Bumped when the reader learns to put more in a request, so the history is read once more and the old entries gain it (the
// history's merge keeps what is already known and counts nothing twice). 2: the source from the entrypoint, the Grove flag.
const SCHEMA = 2

interface Listed {
  file: string
  size: number
  born: number
  helper: boolean
  // The session the file belongs to: its own name, or the folder a helper file sits in.
  session: string
}

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0)

// One transcript line as a request, or undefined when it is not one. A response is written as several lines (one per content
// block) with the same ids, so the key is the message id plus the request id, the message id alone when there is no request id.
// Synthetic records (Claude's own placeholders) and API-error lines are not requests. The working folder is the record's `cwd`:
// the project folder's name is a lossy encoding of it. The source comes from the record's `entrypoint`: Claude Desktop's is
// 'claude-desktop' (never run in Grove, so always known); everything else (cli, sdk-cli) is Claude Code, which Grove ran when
// Grove's own records say so (see GroveSessions.ranInGrove).
export function requestOf(line: string, inHelperFile: boolean, fileSession = '', grove?: GroveSessions): UsageRequest | undefined {
  if (!line.includes('"usage"') || !line.includes('"assistant"')) return undefined
  let record: unknown
  try {
    record = JSON.parse(line)
  } catch {
    return undefined
  }
  if (record === null || typeof record !== 'object') return undefined
  const fields = record as Record<string, unknown>
  if (fields.type !== 'assistant' || fields.isApiErrorMessage === true) return undefined
  const message = fields.message
  if (message === null || typeof message !== 'object') return undefined
  const { id, model, usage } = message as Record<string, unknown>
  if (typeof id !== 'string' || id === '' || model === '<synthetic>' || usage === null || typeof usage !== 'object') return undefined
  const at = typeof fields.timestamp === 'string' ? Date.parse(fields.timestamp) : NaN
  if (!Number.isFinite(at)) return undefined
  const tokens = usage as Record<string, unknown>
  const desktop = fields.entrypoint === 'claude-desktop'
  const sessionId = typeof fields.sessionId === 'string' && fields.sessionId !== '' ? fields.sessionId : fileSession
  const requestId = typeof fields.requestId === 'string' && fields.requestId !== '' ? fields.requestId : undefined
  const request: UsageRequest = {
    key: requestId === undefined ? id : `${id}|${requestId}`,
    agent: 'claude',
    source: desktop ? CLAUDE_DESKTOP : CLAUDE_CODE,
    model: typeof model === 'string' ? model : '',
    folder: typeof fields.cwd === 'string' ? fields.cwd : '',
    at,
    input: count(tokens.input_tokens),
    output: count(tokens.output_tokens),
    cacheRead: count(tokens.cache_read_input_tokens),
    cacheWrite: count(tokens.cache_creation_input_tokens),
    helper: inHelperFile || fields.isSidechain === true,
    nanoAiu: null,
    inGrove: desktop ? false : (grove?.ranInGrove('claude', sessionId, at) ?? null),
  }
  if (!desktop && request.inGrove !== true) grove?.doubt(request, sessionId)
  return request
}

async function listDir(dir: string): Promise<fs.Dirent[]> {
  try {
    return await fs.promises.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

async function listed(file: string, helper: boolean, session: string): Promise<Listed | undefined> {
  try {
    const stat = await fs.promises.stat(file)
    return stat.isFile() ? { file, size: stat.size, born: stat.birthtimeMs, helper, session } : undefined
  } catch {
    return undefined
  }
}

// Every transcript under the projects folder, helper agents' files included.
async function listTranscripts(projectsDir: string): Promise<Listed[]> {
  const found: Array<Promise<Listed | undefined>> = []
  for (const project of await listDir(projectsDir)) {
    if (!project.isDirectory()) continue
    const projectDir = path.join(projectsDir, project.name)
    for (const entry of await listDir(projectDir)) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) found.push(listed(path.join(projectDir, entry.name), false, entry.name.slice(0, -'.jsonl'.length)))
      else if (entry.isDirectory()) {
        for (const helper of await listDir(path.join(projectDir, entry.name, 'subagents'))) {
          if (helper.isFile() && helper.name.endsWith('.jsonl')) found.push(listed(path.join(projectDir, entry.name, 'subagents', helper.name), true, entry.name))
        }
      }
    }
  }
  return (await Promise.all(found)).filter((item): item is Listed => item !== undefined)
}

// Reads Claude's transcripts incrementally: a byte offset per file, so after the first pass only what a transcript gained is read.
// Files are read oldest first, so a resumed session that copied old history is met after the session it copied from.
export function createClaudeReader(options: ClaudeReaderOptions): UsageReader {
  const chunkBytes = options.chunkBytes ?? CHUNK_BYTES
  let offsets = new Map<string, number>()
  let queue: Listed[] | undefined
  const failed = new Set<string>()
  // Bytes of every transcript the last pass listed, and how many of them are read: what `progress` is made of. undefined before a pass has looked.
  let total: number | undefined
  let done = 0

  const pending = async (): Promise<Listed[]> => {
    const all = await listTranscripts(options.projectsDir)
    total = all.reduce((sum, item) => sum + item.size, 0)
    done = all.reduce((sum, item) => sum + Math.min(offsets.get(item.file) ?? 0, item.size), 0)
    return all.filter((item) => item.size !== (offsets.get(item.file) ?? 0)).sort((a, b) => a.born - b.born || (a.file < b.file ? -1 : 1))
  }

  // Reads the next slice of one file. False when the file has nothing complete left.
  async function slice(item: Listed, out: UsageRequest[]): Promise<boolean> {
    let offset = offsets.get(item.file) ?? 0
    if (item.size < offset) offset = 0
    const { lines, next, more } = await sliceLines(item.file, offset, item.size, chunkBytes)
    for (const line of lines) {
      const request = requestOf(line, item.helper, item.session, options.grove)
      if (request) out.push(request)
    }
    offsets.set(item.file, next)
    done += next - offset
    return more
  }

  return {
    agent: 'claude',
    async step() {
      let corrected: UsageRequest[] = []
      if (queue === undefined) {
        await options.grove?.refresh()
        corrected = options.grove?.corrections('claude') ?? []
      }
      queue ??= await pending()
      const item = queue[0]
      if (item === undefined) {
        queue = undefined
        return { requests: corrected, done: true }
      }
      const requests: UsageRequest[] = corrected
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
      if (queue === undefined) done = total ?? 0
      return { requests, done: queue === undefined }
    },
    progress: () => (total === undefined ? undefined : total === 0 ? 1 : Math.min(1, done / total)),
    state: () => ({ schema: SCHEMA, files: Object.fromEntries(offsets) }),
    restore(state) {
      const saved = state as { schema?: unknown; files?: unknown } | null
      // A position saved by an older reader is dropped: the transcripts are read once more, so the entries gain what it did not read.
      const files = saved?.schema === SCHEMA ? saved.files : undefined
      offsets = new Map(
        files !== null && typeof files === 'object' ? Object.entries(files).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] >= 0) : [],
      )
      queue = undefined
      total = undefined
    },
    async skipToEnd() {
      queue = undefined
      total = undefined
      offsets = new Map((await listTranscripts(options.projectsDir)).map((item) => [item.file, item.size]))
    },
  }
}
