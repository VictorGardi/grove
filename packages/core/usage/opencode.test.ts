import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClaudeReader } from './claude.ts'
import { createCopilotReader } from './copilot.ts'
import { createOpencodeReader, opencodeDataDir } from './opencode.ts'
import { STALL_LIMIT_MS, calmest, worstStall } from './loopProbe.ts'
import { UsageService, usageHistoryFile } from './service.ts'

// OpenCode's requests on Copilot's models, from a fixture database in both table generations to the summary. The only proof there is:
// this machine has no Copilot-provider OpenCode requests.

// What a conversation says. It sits in the fixture's content and titles and must never reach the saved history.
const SECRET = 'my password is hunter2'

const ms = (day: number, hour = 10, month = 10) => new Date(2026, month, day, hour).getTime()
// 2026-11-16, local noon.
const NOW = ms(16, 12)

interface Row {
  id: string
  session: string
  provider?: string
  model?: string
  // The message's own time, which is its row's `time_created` too. `completed` undefined: still in progress.
  created?: number
  completed?: number | null
  tokens?: { input: number; output: number; reasoning?: number; read?: number; write?: number } | null
  updated?: number
}

const tokensOf = (r: Row) =>
  r.tokens === null ? undefined : { input: r.tokens?.input ?? 1000, output: r.tokens?.output ?? 50, reasoning: r.tokens?.reasoning ?? 0, cache: { read: r.tokens?.read ?? 600, write: r.tokens?.write ?? 300 } }

const COPILOT = 'github-copilot'

// OpenCode's two table generations, with the columns the reader uses and the rest of what a row holds (content, titles).
const SCHEMA = `
  CREATE TABLE session (id text PRIMARY KEY, parent_id text, directory text NOT NULL, title text NOT NULL, time_created integer NOT NULL);
  CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL);
  CREATE TABLE session_v2 (id text PRIMARY KEY, parent_id text, fork_session_id text, directory text NOT NULL, title text, time_created integer NOT NULL);
  CREATE TABLE session_message (id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL, seq integer NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL);
  CREATE INDEX session_message_time_created_idx ON session_message (time_created);
`

class Fixture {
  readonly db: DatabaseSync
  private seq = 0

  constructor(readonly file: string) {
    this.db = new DatabaseSync(file)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec(SCHEMA)
  }

  session(v: 1 | 2, id: string, directory: string, created: number, more: { parent?: string; fork?: string } = {}): void {
    if (v === 1) this.db.prepare('INSERT INTO session VALUES (?, ?, ?, ?, ?)').run(id, more.parent ?? null, directory, SECRET, created)
    else this.db.prepare('INSERT INTO session_v2 VALUES (?, ?, ?, ?, ?, ?)').run(id, more.parent ?? null, more.fork ?? null, directory, SECRET, created)
  }

  // An assistant message in the generation's own shape: v1 has flat providerID and modelID, v2 a model object.
  assistant(v: 1 | 2, r: Row): void {
    const created = r.created ?? ms(15)
    const completed = r.completed === undefined ? created + 4000 : r.completed
    const time = completed === null ? { created } : { created, completed }
    const common = { cost: 0.42, tokens: tokensOf(r), time }
    const provider = r.provider ?? COPILOT
    const model = r.model ?? 'gpt-6-luna'
    if (v === 1) {
      this.db
        .prepare('INSERT OR REPLACE INTO message VALUES (?, ?, ?, ?, ?)')
        .run(r.id, r.session, created, r.updated ?? created, JSON.stringify({ role: 'assistant', providerID: provider, modelID: model, ...common }))
    } else {
      this.db
        .prepare('INSERT OR REPLACE INTO session_message VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(r.id, r.session, 'assistant', ++this.seq, created, r.updated ?? created, JSON.stringify({ model: { id: model, providerID: provider }, content: [{ type: 'text', text: SECRET }], ...common }))
    }
  }

  // The user's turn, which is no request.
  user(v: 1 | 2, id: string, session: string, created = ms(15)): void {
    if (v === 1) this.db.prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?)').run(id, session, created, created, JSON.stringify({ role: 'user', time: { created } }))
    else this.db.prepare('INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, session, 'user', ++this.seq, created, created, JSON.stringify({ content: SECRET }))
  }

  close(): void {
    this.db.close()
  }
}

const copilotLine = (id: string, ts: string, nano = 2_000_000_000): string =>
  JSON.stringify({
    type: 'session.usage_record',
    data: { usage: { model: 'gpt-6-luna', inputTokens: 1000, outputTokens: 50, cacheReadTokens: 600, cacheWriteTokens: 300, initiator: 'agent', accounting: { usageId: `usage-${id}` }, copilotUsage: { totalNanoAiu: nano }, aiCreditsStatus: 'complete' } },
    timestamp: ts,
  })
const copilotStart = (cwd: string): string => JSON.stringify({ type: 'session.start', data: { context: { cwd } }, timestamp: new Date(ms(1)).toISOString() })

describe('usage history from OpenCode’s database, to the summary', () => {
  let dir: string
  let dataDir: string
  let copilotHome: string
  let projects: string
  let home: string
  let fixture: Fixture
  let service: UsageService | undefined

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-usage-opencode-'))
    dataDir = path.join(dir, 'opencode')
    copilotHome = path.join(dir, 'copilot')
    projects = path.join(dir, 'projects')
    home = path.join(dir, 'home')
    for (const folder of [dataDir, copilotHome, projects, home]) fs.mkdirSync(folder, { recursive: true })
    fixture = new Fixture(path.join(dataDir, 'opencode.db'))
    fixture.session(2, 's2', '/work/app', ms(1))
  })

  afterEach(() => {
    service?.close()
    service = undefined
    try {
      fixture.close()
    } catch {}
    vi.restoreAllMocks()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const make = (readers = ['claude', 'copilot', 'opencode']): UsageService =>
    (service = new UsageService({
      home,
      readers: [
        ...(readers.includes('claude') ? [createClaudeReader({ projectsDir: projects })] : []),
        ...(readers.includes('copilot') ? [createCopilotReader({ copilotHome })] : []),
        ...(readers.includes('opencode') ? [createOpencodeReader({ dataDir, clock: () => NOW })] : []),
      ],
      clock: () => NOW,
      saveMs: 10,
      notifyMs: 10,
    }))

  const copilot = (s: UsageService, days?: number) => s.summary(days).agents.find((a) => a.agent === 'copilot')

  const cliSession = (id: string, lines: string[]): void => {
    const folder = path.join(copilotHome, 'session-state', id)
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(folder, 'events.jsonl'), `${lines.join('\n')}\n`)
  }

  it('counts a request on Copilot’s models under Copilot, as via OpenCode, with its tokens, model and folder, and no credit figure', async () => {
    fixture.assistant(2, { id: 'm1', session: 's2', tokens: { input: 120, output: 40, reasoning: 10, read: 3000, write: 200 }, completed: ms(15, 10) + 5000 })
    const s = make()
    await s.drain()
    const agent = copilot(s)
    expect(agent?.last7).toMatchObject({ requests: 1, input: 120, output: 50, cacheRead: 3000, cacheWrite: 200, credits: 0, withoutCredits: 1 })
    expect(agent?.models).toMatchObject([{ model: 'gpt-6-luna', requests: 1 }])
    expect(agent?.sources).toMatchObject([{ split: 'opencode', requests: 1, withoutCredits: 1 }])
    expect(agent?.days).toMatchObject([{ day: '2026-11-15', requests: 1, sources: [{ split: 'opencode', requests: 1 }] }])
    expect(agent?.repositories).toMatchObject([{ requests: 1 }])
    expect(s.summary().agents.map((a) => a.agent)).toEqual(['copilot'])
  })

  it('takes the time of the request as when it completed', async () => {
    // Created on the 15th late in the evening, completed after midnight: it is the 16th's.
    fixture.assistant(2, { id: 'm1', session: 's2', created: new Date(2026, 10, 15, 23, 59, 58).getTime(), completed: new Date(2026, 10, 16, 0, 0, 5).getTime() })
    const s = make()
    await s.drain()
    expect(copilot(s)?.days).toMatchObject([{ day: '2026-11-16', requests: 1 }])
  })

  it('ignores every other provider, and what is not an assistant’s turn', async () => {
    fixture.assistant(2, { id: 'a', session: 's2', provider: 'opencode', model: 'big-pickle' })
    fixture.assistant(2, { id: 'b', session: 's2', provider: 'anthropic', model: 'claude-opus' })
    fixture.assistant(2, { id: 'c', session: 's2', provider: 'github-copilot-enterprise' })
    fixture.user(2, 'u', 's2')
    fixture.assistant(2, { id: 'k', session: 's2' })
    const s = make()
    await s.drain()
    expect(copilot(s)?.last7.requests).toBe(1)
    expect(s.summary().agents.map((a) => a.agent)).toEqual(['copilot'])
  })

  it('reads the first generation too, and counts a request once where both generations hold it', async () => {
    fixture.session(1, 's1', '/work/old', ms(2))
    fixture.assistant(1, { id: 'only-v1', session: 's1' })
    fixture.assistant(1, { id: 'both', session: 's1', created: ms(14), completed: ms(14) + 3000 })
    fixture.user(1, 'u1', 's1')
    fixture.session(2, 's1', '/work/old', ms(2))
    fixture.assistant(2, { id: 'both', session: 's1', created: ms(14), completed: ms(14) + 3000 })
    fixture.assistant(2, { id: 'only-v2', session: 's1' })
    const s = make()
    await s.drain()
    await s.drain()
    expect(copilot(s)?.last7.requests).toBe(3)
    expect(copilot(s)?.repositories.map((r) => r.requests)).toEqual([3])
  })

  it('skips a request still in progress or failed, and counts it when it completes', async () => {
    fixture.assistant(2, { id: 'running', session: 's2', completed: null, tokens: null })
    fixture.assistant(2, { id: 'no-tokens', session: 's2', tokens: null })
    fixture.assistant(1, { id: 'old-running', session: 's2', completed: null })
    const s = make()
    await s.drain()
    expect(copilot(s)).toBeUndefined()
    // The messages complete: OpenCode rewrites their rows.
    fixture.assistant(2, { id: 'running', session: 's2', updated: ms(15) + 9000 })
    fixture.assistant(2, { id: 'no-tokens', session: 's2', updated: ms(15) + 9000 })
    fixture.assistant(1, { id: 'old-running', session: 's2', updated: ms(15) + 9000 })
    await s.drain()
    expect(copilot(s)?.last7.requests).toBe(3)
    await s.drain()
    expect(copilot(s)?.last7.requests).toBe(3)
  })

  it('picks up only what is new on the next pass, and finds a request that completes later', async () => {
    fixture.assistant(2, { id: 'm1', session: 's2' })
    fixture.assistant(2, { id: 'late', session: 's2', completed: null, tokens: null })
    const s = make()
    await s.drain()
    fixture.assistant(2, { id: 'm2', session: 's2' })
    await s.drain()
    expect(copilot(s)?.last7.requests).toBe(2)
    fixture.assistant(2, { id: 'late', session: 's2' })
    await s.drain()
    expect(copilot(s)?.last7.requests).toBe(3)
  })

  it('keeps its place across a restart, and a place saved by an older reader is read again', async () => {
    fixture.assistant(2, { id: 'm1', session: 's2' })
    const first = make()
    await first.drain()
    first.close()
    expect(JSON.parse(fs.readFileSync(usageHistoryFile(home), 'utf8')).readers.opencode).toBeDefined()
    expect(JSON.parse(fs.readFileSync(usageHistoryFile(home), 'utf8')).readers.copilot).toBeDefined()
    // Nothing changed: a new core reads nothing more and counts the same.
    fixture.assistant(2, { id: 'm2', session: 's2' })
    const second = make()
    await second.drain()
    expect(copilot(second)?.last7.requests).toBe(2)
    second.close()
    // A history from before the schema marker: the position is dropped and the database is read once more, with no double count.
    const file = JSON.parse(fs.readFileSync(usageHistoryFile(home), 'utf8'))
    file.readers.opencode = { files: {} }
    fs.writeFileSync(usageHistoryFile(home), JSON.stringify(file))
    const third = make()
    await third.drain()
    expect(copilot(third)?.last7.requests).toBe(2)
  })

  it('does not count what a forked session inherited from its parent, in either generation', async () => {
    fixture.assistant(2, { id: 'parent-1', session: 's2', created: ms(10), completed: ms(10) + 3000 })
    fixture.session(2, 'fork2', '/work/app', ms(12), { fork: 's2' })
    // Copied rows keep their time and get new ids.
    fixture.assistant(2, { id: 'copy-1', session: 'fork2', created: ms(10), completed: ms(10) + 3000 })
    fixture.assistant(2, { id: 'own-1', session: 'fork2', created: ms(13), completed: ms(13) + 3000 })
    fixture.session(1, 's1', '/work/app', ms(2))
    fixture.assistant(1, { id: 'v1-parent', session: 's1', created: ms(9), completed: ms(9) + 3000 })
    fixture.session(1, 'fork1', '/work/app', ms(11))
    fixture.assistant(1, { id: 'v1-copy', session: 'fork1', created: ms(9), completed: ms(9) + 3000 })
    fixture.assistant(1, { id: 'v1-own', session: 'fork1', created: ms(14), completed: ms(14) + 3000 })
    const s = make()
    await s.drain()
    expect(copilot(s, 30)?.last30.requests).toBe(4)
  })

  it('flags a request in a child session as a helper’s', async () => {
    fixture.session(2, 'child', '/work/app', ms(2), { parent: 's2' })
    fixture.session(1, 'child1', '/work/app', ms(2), { parent: 's2' })
    fixture.assistant(2, { id: 'main', session: 's2' })
    fixture.assistant(2, { id: 'sub', session: 'child' })
    fixture.assistant(1, { id: 'sub-v1', session: 'child1' })
    const s = make()
    await s.drain()
    expect(copilot(s)?.days).toMatchObject([{ requests: 3, helperRequests: 2 }])
  })

  it('adds up with Copilot’s own requests: credits, plus the requests without credits, and the places side by side', async () => {
    cliSession('a', [copilotStart('/work/app'), copilotLine('1', new Date(ms(15)).toISOString()), copilotLine('2', new Date(ms(15, 11)).toISOString(), 3_000_000_000)])
    fixture.assistant(2, { id: 'oc1', session: 's2' })
    fixture.assistant(2, { id: 'oc2', session: 's2' })
    const s = make()
    await s.drain()
    const agent = copilot(s)
    expect(agent?.last7).toMatchObject({ requests: 4, credits: 5, withoutCredits: 2 })
    expect(agent?.days).toMatchObject([{ requests: 4, credits: 5, withoutCredits: 2 }])
    expect(agent?.sources.map((x) => [x.split, x.requests, x.withoutCredits])).toEqual([
      ['other', 2, 0],
      ['opencode', 2, 2],
    ])
    expect(agent?.sources.find((x) => x.split === 'other')?.credits).toBe(5)
    expect(agent?.models).toMatchObject([{ model: 'gpt-6-luna', requests: 4 }])
  })

  it('is not split into Grove and not tracked: a via OpenCode request is its own place', async () => {
    fixture.assistant(2, { id: 'oc1', session: 's2' })
    const s = make()
    await s.drain()
    expect(copilot(s)?.sources.map((x) => x.split)).toEqual(['opencode'])
  })

  it('counts nothing and breaks nothing when there is no database, and the other agents are still counted', async () => {
    fixture.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
    cliSession('a', [copilotStart('/work/app'), copilotLine('1', new Date(ms(15)).toISOString())])
    const s = make()
    await s.drain()
    expect(copilot(s)?.last7).toMatchObject({ requests: 1, credits: 2 })
    expect(s.summary().building).toBe(false)
  })

  it('counts nothing and breaks nothing when the database is not a database, is empty, or lacks the tables', async () => {
    fixture.close()
    fs.writeFileSync(path.join(dataDir, 'opencode.db'), 'this is not a database at all, '.repeat(200))
    fs.writeFileSync(path.join(dataDir, 'opencode-dev.db'), '')
    const other = new DatabaseSync(path.join(dataDir, 'opencode-beta.db'))
    other.exec('CREATE TABLE unrelated (x text)')
    other.close()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    cliSession('a', [copilotStart('/work/app'), copilotLine('1', new Date(ms(15)).toISOString())])
    const s = make()
    await s.drain()
    await s.drain()
    expect(copilot(s)?.last7).toMatchObject({ requests: 1, credits: 2, withoutCredits: 0 })
    expect(s.summary().building).toBe(false)
    // The unreadable one is reported once, not on every pass.
    expect(error.mock.calls.filter((call) => String(call[0]).includes('opencode.db')).length).toBeLessThanOrEqual(1)
  })

  it('reads the database of a channel next to the main one, and none of the other files in the folder', async () => {
    const beta = new Fixture(path.join(dataDir, 'opencode-beta.db'))
    beta.session(2, 'b', '/work/beta', ms(2))
    beta.assistant(2, { id: 'beta-1', session: 'b' })
    beta.close()
    fs.writeFileSync(path.join(dataDir, 'other.db'), 'not ours')
    fixture.assistant(2, { id: 'm1', session: 's2' })
    const s = make()
    await s.drain()
    expect(copilot(s)?.last7.requests).toBe(2)
  })

  it('stores no conversation text, and does not change the database', async () => {
    fixture.assistant(2, { id: 'm1', session: 's2' })
    fixture.assistant(1, { id: 'm2', session: 's2' })
    fixture.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    const before = fs.readFileSync(path.join(dataDir, 'opencode.db'))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const s = make()
    await s.drain()
    s.close()
    expect(copilot(s)?.last7.requests).toBe(2)
    const saved = fs.readFileSync(usageHistoryFile(home), 'utf8')
    expect(saved).toContain('opencode')
    expect(saved).not.toContain(SECRET)
    expect(JSON.stringify(logged.mock.calls)).not.toContain(SECRET)
    expect(fs.readFileSync(path.join(dataDir, 'opencode.db')).equals(before)).toBe(true)
  })

  it('does not wait for a running OpenCode: it reads what is committed while a write is open', async () => {
    fixture.assistant(2, { id: 'm1', session: 's2' })
    fixture.db.exec('BEGIN IMMEDIATE')
    fixture.assistant(2, { id: 'uncommitted', session: 's2' })
    const s = make()
    await s.drain()
    expect(copilot(s)?.last7.requests).toBe(1)
    fixture.db.exec('COMMIT')
    await s.drain()
    expect(copilot(s)?.last7.requests).toBe(2)
  })

  it('does not read it again after a wipe', async () => {
    fixture.assistant(2, { id: 'm1', session: 's2' })
    const s = make()
    await s.drain()
    await s.wipe()
    expect(copilot(s)).toBeUndefined()
    await s.drain()
    expect(copilot(s)).toBeUndefined()
    fixture.assistant(2, { id: 'm2', session: 's2', created: NOW + 100, completed: NOW + 500 })
    await s.drain()
    expect(copilot(s)?.last7.requests).toBe(1)
  })

  it('stays responsive while a large database is scanned for the first time', async () => {
    fixture.db.exec('BEGIN')
    for (let s = 0; s < 40; s++) {
      fixture.session(2, `big${s}`, '/work/app', ms(1))
      fixture.session(1, `bigv1-${s}`, '/work/app', ms(1))
      for (let i = 0; i < 200; i++) {
        fixture.assistant(2, { id: `v2-${s}-${i}`, session: `big${s}`, provider: i % 50 === 0 ? COPILOT : 'opencode', created: ms(15) + i })
        fixture.assistant(1, { id: `v1-${s}-${i}`, session: `bigv1-${s}`, provider: i % 50 === 0 ? COPILOT : 'opencode', created: ms(14) + i })
      }
    }
    fixture.db.exec('COMMIT')
    const inner = createOpencodeReader({ dataDir, clock: () => NOW })
    let steps = 0
    let buildingMidScan: boolean | undefined
    const s = (service = new UsageService({
      home,
      readers: [
        {
          ...inner,
          step: async () => {
            const result = await inner.step()
            if (++steps === 3) buildingMidScan = s.summary().building
            return result
          },
        },
      ],
      clock: () => NOW,
    }))
    let worst = await worstStall(() => s.drain())
    expect(steps).toBeGreaterThan(10)
    expect(buildingMidScan).toBe(true)
    expect(s.summary().building).toBe(false)
    expect(copilot(s, 30)?.last30.requests).toBe(40 * 4 * 2)
    worst = await calmest(worst, async () => {
      s.close()
      fs.rmSync(home, { recursive: true, force: true })
      fs.mkdirSync(home)
      const next = (service = new UsageService({ home, readers: [createOpencodeReader({ dataDir, clock: () => NOW })], clock: () => NOW }))
      return worstStall(() => next.drain())
    })
    expect(worst).toBeLessThan(STALL_LIMIT_MS)
  })
})

describe('where OpenCode keeps its database', () => {
  it('is OPENCODE_DATA_DIR, else XDG_DATA_HOME, else ~/.local/share, in a folder named opencode', () => {
    expect(opencodeDataDir({ OPENCODE_DATA_DIR: '/data/oc', XDG_DATA_HOME: '/xdg' }, '/home/me')).toBe('/data/oc')
    expect(opencodeDataDir({ XDG_DATA_HOME: '/xdg' }, '/home/me')).toBe('/xdg/opencode')
    expect(opencodeDataDir({}, '/home/me')).toBe('/home/me/.local/share/opencode')
  })
})
