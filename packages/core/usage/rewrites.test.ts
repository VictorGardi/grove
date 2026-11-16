import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createClaudeReader } from './claude.ts'
import { changed, replaced, type FilePlace } from './fileSlice.ts'
import { createCopilotReader } from './copilot.ts'
import type { UsageReader } from './reader.ts'

// How a reader tells a file that was appended to from one that was replaced or rewritten: by the file's stat (size, inode, time) and
// its first bytes. Every first line here is longer than the 256 bytes that are compared, so only the stat can tell a replacement that
// keeps them.

const LONG = 'x'.repeat(400)
const ts = (n: number): string => new Date(2026, 10, 15, 10, n).toISOString()

interface Flavour {
  name: string
  // A file that starts with the same long first line however its requests differ.
  lines: (ids: string[]) => string[]
  file: (dir: string) => string
  reader: (dir: string) => UsageReader
}

const FLAVOURS: Flavour[] = [
  {
    name: 'Claude transcript',
    lines: (ids) => [
      JSON.stringify({ type: 'user', cwd: `/work/${LONG}`, message: { content: 'hello' } }),
      ...ids.map((id, i) => JSON.stringify({ type: 'assistant', timestamp: ts(i), cwd: '/work/app', requestId: `r-${id}`, message: { id, model: 'claude-opus', usage: { input_tokens: 3, output_tokens: 10 } } })),
    ],
    file: (dir) => path.join(dir, 'projects', 'p', 'a.jsonl'),
    reader: (dir) => createClaudeReader({ projectsDir: path.join(dir, 'projects') }),
  },
  {
    name: 'Copilot session',
    lines: (ids) => [
      JSON.stringify({ type: 'session.start', data: { context: { cwd: `/work/${LONG}` } }, timestamp: ts(0) }),
      ...ids.map((id, i) => JSON.stringify({ type: 'session.usage_record', data: { usage: { model: 'gpt-6-luna', inputTokens: 10, outputTokens: 5, accounting: { usageId: `usage-${id}` } } }, timestamp: ts(i) })),
    ],
    file: (dir) => path.join(dir, 'copilot', 'session-state', 'a', 'events.jsonl'),
    reader: (dir) => createCopilotReader({ copilotHome: path.join(dir, 'copilot') }),
  },
]

// One whole pass: the requests the reader returns, as how many came back and which.
async function pass(reader: UsageReader): Promise<{ keys: string[]; steps: number }> {
  const keys: string[] = []
  let steps = 0
  for (;;) {
    steps++
    const { requests, done } = await reader.step()
    keys.push(...requests.map((r) => r.key))
    if (done) return { keys, steps }
  }
}

const SECOND = 1000

describe.each(FLAVOURS)('rewrite detection: $name', (flavour) => {
  let dir: string
  let file: string
  let reader: UsageReader

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-usage-rewrite-'))
    file = flavour.file(dir)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    reader = flavour.reader(dir)
  })

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  const write = (ids: string[], mtime: number): void => {
    fs.writeFileSync(file, `${flavour.lines(ids).join('\n')}\n`)
    fs.utimesSync(file, mtime / SECOND, mtime / SECOND)
  }
  const append = (ids: string[], mtime: number): void => {
    fs.appendFileSync(file, `${flavour.lines(ids).slice(1).join('\n')}\n`)
    fs.utimesSync(file, mtime / SECOND, mtime / SECOND)
  }
  // Writes a new file and renames it over the old one: a new inode, as an atomic save does.
  const replace = (ids: string[], mtime: number): void => {
    const temp = `${file}.tmp`
    fs.writeFileSync(temp, `${flavour.lines(ids).join('\n')}\n`)
    fs.utimesSync(temp, mtime / SECOND, mtime / SECOND)
    fs.renameSync(temp, file)
  }
  const T = Date.now() - 3600 * SECOND

  it('reads only what an append added: same file, longer, newer', async () => {
    write(['a', 'b'], T)
    expect((await pass(reader)).keys).toHaveLength(2)
    append(['c'], T + 10 * SECOND)
    expect((await pass(reader)).keys).toHaveLength(1)
  })

  it('reads nothing on a pass when nothing changed', async () => {
    write(['a', 'b'], T)
    await pass(reader)
    expect((await pass(reader)).keys).toEqual([])
    expect((await pass(reader)).keys).toEqual([])
  })

  it('reads a file again from the start when a new file took its place and kept the first bytes and grew', async () => {
    write(['a', 'b'], T)
    await pass(reader)
    replace(['p', 'q', 'r', 's', 't'], T + 10 * SECOND)
    const { keys } = await pass(reader)
    expect(keys).toHaveLength(5)
  })

  it('reads a file again when a new file took its place and has the same size', async () => {
    write(['a', 'b'], T)
    const size = fs.statSync(file).size
    await pass(reader)
    replace(['x', 'y'], T + 10 * SECOND)
    expect(fs.statSync(file).size).toBe(size)
    expect((await pass(reader)).keys).toHaveLength(2)
  })

  it('reads a file again when it was rewritten in place and its time went backwards', async () => {
    write(['a', 'b'], T)
    await pass(reader)
    write(['x', 'y'], T - 600 * SECOND)
    expect((await pass(reader)).keys).toHaveLength(2)
  })

  it('reads a file again when it shrank', async () => {
    write(['a', 'b', 'c'], T)
    await pass(reader)
    write(['d'], T + 10 * SECOND)
    expect((await pass(reader)).keys).toHaveLength(1)
  })

  it('does not read a file again for a newer time alone', async () => {
    write(['a', 'b'], T)
    await pass(reader)
    fs.utimesSync(file, (T + 99 * SECOND) / SECOND, (T + 99 * SECOND) / SECOND)
    expect((await pass(reader)).keys).toEqual([])
  })
})

describe('what the stat says', () => {
  const place: FilePlace = { offset: 100, head: '', ino: 7, mtimeMs: 1000 }

  it('calls a longer file with the same inode and a newer time an append', () => {
    expect(replaced(place, { size: 150, ino: 7, mtimeMs: 2000 })).toBe(false)
  })

  it('calls a shorter file, another inode and an earlier time a replacement', () => {
    expect(replaced(place, { size: 99, ino: 7, mtimeMs: 2000 })).toBe(true)
    expect(replaced(place, { size: 150, ino: 8, mtimeMs: 2000 })).toBe(true)
    expect(replaced(place, { size: 150, ino: 7, mtimeMs: 999 })).toBe(true)
  })

  it('does not go by an inode that is not known', () => {
    expect(replaced(place, { size: 150, ino: 0, mtimeMs: 2000 })).toBe(false)
    expect(replaced({ ...place, ino: 0 }, { size: 150, ino: 8, mtimeMs: 2000 })).toBe(false)
  })

  it('has nothing to replace before anything was read', () => {
    expect(replaced({ ...place, offset: 0 }, { size: 0, ino: 8, mtimeMs: 1 })).toBe(false)
    expect(changed(undefined, { size: 0, ino: 8, mtimeMs: 1 })).toBe(false)
    expect(changed(undefined, { size: 1, ino: 8, mtimeMs: 1 })).toBe(true)
  })
})
