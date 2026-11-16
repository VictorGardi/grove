import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClaudeReader } from './claude.ts'
import { createCopilotReader } from './copilot.ts'
import { createOpencodeReader } from './opencode.ts'
import type { UsageReader } from './reader.ts'

// A reader keeps a place per file in memory; a file the agent deleted must not keep one for as long as the core runs.

const claudeLine = (id: string): string =>
  JSON.stringify({ type: 'assistant', timestamp: new Date(2026, 10, 15, 10).toISOString(), cwd: '/work/app', requestId: `req-${id}`, message: { id, model: 'claude-opus', usage: { input_tokens: 3, output_tokens: 10 } } })
const copilotLine = (id: string): string =>
  JSON.stringify({ type: 'session.usage_record', data: { usage: { model: 'gpt-6-luna', inputTokens: 10, outputTokens: 5, accounting: { usageId: `usage-${id}` } } }, timestamp: new Date(2026, 10, 15, 10).toISOString() })

async function pass(reader: UsageReader): Promise<void> {
  for (;;) if ((await reader.step()).done) return
}

describe('the places readers keep', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-usage-places-'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const put = (file: string, lines: string[]): string => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `${lines.join('\n')}\n`)
    return file
  }

  it('drops a Claude transcript’s place on the pass after the file is deleted, and keeps the others', async () => {
    const projects = path.join(dir, 'projects')
    const a = put(path.join(projects, 'p', 'a.jsonl'), [claudeLine('1')])
    put(path.join(projects, 'p', 'b.jsonl'), [claudeLine('2')])
    put(path.join(projects, 'p', 'a', 'subagents', 'h.jsonl'), [claudeLine('3')])
    const reader = createClaudeReader({ projectsDir: projects })
    await pass(reader)
    expect(reader.tracked?.()).toBe(3)
    fs.rmSync(a)
    await pass(reader)
    expect(reader.tracked?.()).toBe(2)
    fs.rmSync(projects, { recursive: true })
    await pass(reader)
    expect(reader.tracked?.()).toBe(0)
  })

  it('drops a Copilot session’s place on the pass after its events are deleted', async () => {
    const copilotHome = path.join(dir, 'copilot')
    put(path.join(copilotHome, 'session-state', 'a', 'events.jsonl'), [copilotLine('1')])
    put(path.join(copilotHome, 'session-state', 'b', 'events.jsonl'), [copilotLine('2')])
    const reader = createCopilotReader({ copilotHome })
    await pass(reader)
    expect(reader.tracked?.()).toBe(2)
    fs.rmSync(path.join(copilotHome, 'session-state', 'a'), { recursive: true })
    await pass(reader)
    expect(reader.tracked?.()).toBe(1)
  })

  it('drops an OpenCode database’s place on the pass after the database is deleted', async () => {
    const dataDir = path.join(dir, 'opencode')
    fs.mkdirSync(dataDir)
    for (const name of ['opencode.db', 'opencode-beta.db']) {
      const db = new DatabaseSync(path.join(dataDir, name))
      db.exec('CREATE TABLE session (id text PRIMARY KEY, parent_id text, directory text NOT NULL, title text NOT NULL, time_created integer NOT NULL)')
      db.exec('CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL)')
      db.close()
    }
    const reader = createOpencodeReader({ dataDir })
    await pass(reader)
    expect(reader.tracked?.()).toBe(2)
    fs.rmSync(path.join(dataDir, 'opencode-beta.db'))
    await pass(reader)
    expect(reader.tracked?.()).toBe(1)
  })

  it('reports an unreadable file once however many passes see it', async () => {
    const projects = path.join(dir, 'projects')
    const file = put(path.join(projects, 'p', 'a.jsonl'), [claudeLine('1')])
    fs.chmodSync(file, 0)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const reader = createClaudeReader({ projectsDir: projects })
    for (let i = 0; i < 3; i++) await pass(reader)
    fs.chmodSync(file, 0o644)
    // Root can read anything; the check only means something where the file is really unreadable.
    if (process.getuid?.() !== 0) expect(error.mock.calls.filter((call) => String(call[0]).includes('a.jsonl'))).toHaveLength(1)
  })
})
