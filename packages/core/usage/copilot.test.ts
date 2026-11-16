import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClaudeReader } from './claude.ts'
import { createCopilotReader, requestOf } from './copilot.ts'
import { UsageService, usageHistoryFile } from './service.ts'

// What a conversation says. It sits in the fixture's conversation events and workspace file and must never reach the saved history.
const SECRET = 'my password is hunter2'

const iso = (day: number, hour = 10, month = 10) => new Date(2026, month, day, hour).toISOString()
// 2026-11-16, local noon.
const NOW = new Date(2026, 10, 16, 12).getTime()

interface UsageLine {
  id: string
  ts: string
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  nano?: number | null
  status?: string
  initiator?: string
  interaction?: string
  agentId?: string
  model?: string
}

// A `session.usage_record` line in the shape Copilot writes (invented values).
const usage = (r: UsageLine): string =>
  JSON.stringify({
    type: 'session.usage_record',
    data: {
      usage: {
        model: r.model ?? 'gpt-6-luna',
        provider: { id: 'copilot', kind: 'copilot', label: 'GitHub Copilot' },
        inputTokens: r.input ?? 1000,
        outputTokens: r.output ?? 50,
        cacheReadTokens: r.cacheRead ?? 600,
        cacheWriteTokens: r.cacheWrite ?? 300,
        cost: 1.0,
        initiator: r.initiator ?? 'agent',
        interactionType: r.interaction ?? 'conversation-agent',
        accounting: { sourceSessionId: 's', sequence: 1, usageId: `usage-${r.id}` },
        ...(r.nano === null ? {} : { copilotUsage: { tokenDetails: [{ batchSize: 1000000, costPerBatch: 10000000000, tokenCount: 100, tokenType: 'input', model: 'gpt-6-luna' }], totalNanoAiu: r.nano ?? 1_000_000_000 } }),
        aiCreditsStatus: r.status ?? 'complete',
      },
    },
    id: `event-${r.id}`,
    timestamp: r.ts,
    parentId: null,
    ...(r.agentId ? { agentId: r.agentId } : {}),
  })

const start = (cwd: string, ts = iso(1, 9, 9)): string =>
  JSON.stringify({ type: 'session.start', data: { sessionId: 's', version: 1, producer: 'copilot-agent', startTime: ts, context: { cwd } }, id: 'start', timestamp: ts, parentId: null })
const resume = (cwd: string, ts: string): string =>
  JSON.stringify({ type: 'session.resume', data: { resumeTime: ts, eventCount: 3, context: { cwd, gitRoot: cwd } }, id: 'resume', timestamp: ts, parentId: null })
const checkpoint = (nano: number): string => JSON.stringify({ type: 'session.usage_checkpoint', data: { accountingSnapshot: { totalNanoAiu: nano, totalUserRequests: 1 } }, timestamp: iso(15) })
const shutdown = (nano: number): string => JSON.stringify({ type: 'session.shutdown', data: { accountingSnapshot: { totalNanoAiu: nano, modelMetrics: { 'gpt-6-luna': { totalNanoAiu: nano } } } }, timestamp: iso(15, 23) })
const chat = (): string => JSON.stringify({ type: 'user.message', data: { content: SECRET }, timestamp: iso(15) })

const claudeLine = (id: string, ts: string): string =>
  JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    cwd: '/work/app',
    requestId: `req-${id}`,
    message: { id, model: 'claude-opus', content: [{ type: 'text', text: SECRET }], usage: { input_tokens: 3, output_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 } },
  })

describe('usage history from Copilot session files, to the summary', () => {
  let dir: string
  let copilotHome: string
  let projects: string
  let home: string
  let service: UsageService | undefined

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-usage-copilot-'))
    copilotHome = path.join(dir, 'copilot')
    projects = path.join(dir, 'projects')
    home = path.join(dir, 'home')
    for (const folder of [copilotHome, projects, home]) fs.mkdirSync(folder, { recursive: true })
  })

  afterEach(() => {
    service?.close()
    service = undefined
    vi.restoreAllMocks()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const session = (id: string, lines: string[], append = false, workspace?: string): string => {
    const folder = path.join(copilotHome, 'session-state', id)
    fs.mkdirSync(folder, { recursive: true })
    const file = path.join(folder, 'events.jsonl')
    ;(append ? fs.appendFileSync : fs.writeFileSync)(file, `${lines.join('\n')}\n`)
    if (workspace !== undefined) fs.writeFileSync(path.join(folder, 'workspace.yaml'), workspace)
    return file
  }

  const make = (): UsageService =>
    (service = new UsageService({
      home,
      readers: [createClaudeReader({ projectsDir: projects }), createCopilotReader({ copilotHome })],
      clock: () => NOW,
      saveMs: 10,
      notifyMs: 10,
    }))

  const copilot = (s: UsageService, days?: number) => s.summary(days).agents.find((a) => a.agent === 'copilot')

  it('counts a request once however many lines and files repeat it', async () => {
    session('a', [start('/work/app'), usage({ id: '1', ts: iso(15) }), usage({ id: '1', ts: iso(15) }), usage({ id: '2', ts: iso(15) })])
    session('b', [start('/work/app'), usage({ id: '1', ts: iso(15) })])
    const s = make()
    await s.drain()
    await s.drain()
    expect(copilot(s)?.last7).toMatchObject({ requests: 2, credits: 2 })
  })

  it('ignores the checkpoint and shutdown records, which total the same requests', async () => {
    session('a', [start('/work/app'), usage({ id: '1', ts: iso(15), nano: 2_000_000_000 }), checkpoint(2_000_000_000), shutdown(2_000_000_000), checkpoint(2_000_000_000)])
    const s = make()
    await s.drain()
    expect(copilot(s)?.last7).toMatchObject({ requests: 1, credits: 2, withoutCredits: 0 })
  })

  it('takes fresh input as the input count without what the cache read and wrote', async () => {
    session('a', [start('/work/app'), usage({ id: '1', ts: iso(15), input: 17224, output: 74, cacheRead: 10464, cacheWrite: 6757 })])
    const s = make()
    await s.drain()
    expect(copilot(s)?.days).toEqual([{ day: '2026-11-15', requests: 1, input: 3, output: 74, cacheRead: 10464, cacheWrite: 6757, credits: 1, withoutCredits: 0 }])
  })

  it('includes the subagents’ requests and flags them as helpers, however Copilot marks them', () => {
    const line = (r: UsageLine) => requestOf(usage(r), '/work/app')
    expect(line({ id: 'u', ts: iso(15), initiator: 'user' })?.helper).toBe(false)
    expect(line({ id: 'a', ts: iso(15), initiator: 'agent' })?.helper).toBe(false)
    expect(line({ id: 's1', ts: iso(15), initiator: 'sub-agent' })?.helper).toBe(true)
    expect(line({ id: 's2', ts: iso(15), interaction: 'conversation-subagent' })?.helper).toBe(true)
    expect(line({ id: 's3', ts: iso(15), agentId: 'agent-7' })?.helper).toBe(true)
  })

  it('counts the subagents’ requests in the totals and keeps the helper flag in the saved history', async () => {
    session('a', [start('/work/app'), usage({ id: '1', ts: iso(15), initiator: 'user' }), usage({ id: '2', ts: iso(15), initiator: 'sub-agent', interaction: 'conversation-subagent', agentId: 'x' })])
    const s = make()
    await s.drain()
    s.close()
    expect(copilot(s)?.last7.requests).toBe(2)
    const rows = Object.entries((JSON.parse(fs.readFileSync(usageHistoryFile(home), 'utf8')) as { requests: Record<string, unknown[]> }).requests)
    expect(rows.map(([, row]) => row[8]).sort()).toEqual([0, 1])
  })

  it('takes the folder from the session start, and from the resume that follows it', () => {
    const reader = createCopilotReader({ copilotHome })
    session('a', [start('/work/first'), usage({ id: '1', ts: iso(14) }), resume('/work/second', iso(15, 8)), usage({ id: '2', ts: iso(15) })])
    return reader.step().then(({ requests }) => {
      expect(requests.map((r) => r.folder)).toEqual(['/work/first', '/work/second'])
    })
  })

  it('falls back to the session’s workspace file for the folder, and reads nothing else from it', async () => {
    session('a', [usage({ id: '1', ts: iso(15) })], false, `id: a\ncwd: "/work/from-workspace"\nname: ${SECRET}\nsummary_count: 0\n`)
    const s = make()
    await s.drain()
    s.close()
    const saved = fs.readFileSync(usageHistoryFile(home), 'utf8')
    expect(saved).toContain('/work/from-workspace')
    expect(saved).not.toContain(SECRET)
  })

  it('keeps the folder across passes and restarts that read only new lines', async () => {
    session('a', [start('/work/app'), usage({ id: '1', ts: iso(15) })])
    const s = make()
    await s.drain()
    s.close()
    session('a', [usage({ id: '2', ts: iso(15) })], true)
    const again = make()
    await again.drain()
    again.close()
    const saved = JSON.parse(fs.readFileSync(usageHistoryFile(home), 'utf8')) as { requests: Record<string, unknown[]> }
    expect(Object.values(saved.requests).map((row) => row[3])).toEqual(['/work/app', '/work/app'])
  })

  it('spreads a resumed session’s requests across the days they were made, by their own timestamps', async () => {
    session('a', [start('/work/app'), usage({ id: '1', ts: iso(13) }), usage({ id: '2', ts: iso(13, 20) }), resume('/work/app', iso(15, 8)), usage({ id: '3', ts: iso(15, 9) }), shutdown(3_000_000_000)])
    const s = make()
    await s.drain()
    expect(copilot(s)?.days.map((d) => [d.day, d.requests, d.credits])).toEqual([
      ['2026-11-13', 2, 2],
      ['2026-11-15', 1, 1],
    ])
  })

  it('sums credits per day and in each total, to what the session’s shutdown says', async () => {
    const nanos = [98_656_500, 250_000_000, 1_000_000_000, 3_411_200_000]
    session('a', [
      start('/work/app'),
      usage({ id: '1', ts: iso(16, 9), nano: nanos[0] }),
      usage({ id: '2', ts: iso(16, 10), nano: nanos[1] }),
      usage({ id: '3', ts: iso(12), nano: nanos[2] }),
      usage({ id: '4', ts: iso(30, 10, 9), nano: nanos[3] }),
      shutdown(nanos.reduce((a, b) => a + b)),
    ])
    const s = make()
    await s.drain()
    const agent = copilot(s, 30)!
    const total = nanos.reduce((a, b) => a + b) / 1e9
    expect(agent.today.credits).toBeCloseTo((nanos[0] + nanos[1]) / 1e9, 9)
    expect(agent.last7.credits).toBeCloseTo((nanos[0] + nanos[1] + nanos[2]) / 1e9, 9)
    expect(agent.last30.credits).toBeCloseTo(total, 9)
    expect(agent.days.reduce((sum, d) => sum + d.credits, 0)).toBeCloseTo(total, 9)
    expect(agent.hasCredits).toBe(true)
  })

  it('counts requests without a credit figure in the totals they fall in, and not as credits', async () => {
    session('a', [
      start('/work/app'),
      usage({ id: 'today', ts: iso(16, 9), nano: 500_000_000 }),
      usage({ id: 'noCopilotUsage', ts: iso(16, 10), nano: null }),
      usage({ id: 'week', ts: iso(12), nano: null }),
      usage({ id: 'unfinished', ts: iso(11), status: 'incomplete', nano: 700_000_000 }),
      usage({ id: 'month', ts: iso(30, 10, 9), nano: null }),
    ])
    const s = make()
    await s.drain()
    const agent = copilot(s)!
    expect([agent.today.withoutCredits, agent.last7.withoutCredits, agent.last30.withoutCredits]).toEqual([1, 3, 4])
    expect([agent.today.requests, agent.last7.requests, agent.last30.requests]).toEqual([2, 4, 5])
    expect(agent.last30.credits).toBe(0.5)
    expect(agent.days.find((d) => d.day === '2026-11-16')).toMatchObject({ requests: 2, credits: 0.5, withoutCredits: 1 })
  })

  it('has no credits, and no requests without credits, for Claude', async () => {
    fs.mkdirSync(path.join(projects, 'p'), { recursive: true })
    fs.writeFileSync(path.join(projects, 'p', 'a.jsonl'), `${claudeLine('m1', iso(15))}\n`)
    session('a', [start('/work/app'), usage({ id: '1', ts: iso(15) })])
    const s = make()
    await s.drain()
    const claude = s.summary().agents.find((a) => a.agent === 'claude')!
    expect(claude).toMatchObject({ hasCredits: false, last7: { requests: 1, credits: 0, withoutCredits: 0 } })
    expect(s.summary().agents.map((a) => a.agent)).toEqual(['claude', 'copilot'])
  })

  it('keeps the history when Copilot deletes its session files, also across a restart', async () => {
    const file = session('a', [start('/work/app'), usage({ id: '1', ts: iso(15), nano: 2_000_000_000 }), usage({ id: '2', ts: iso(14) })])
    const s = make()
    await s.drain()
    s.close()
    fs.rmSync(path.dirname(file), { recursive: true })
    const again = make()
    await again.drain()
    expect(copilot(again)?.last7).toMatchObject({ requests: 2, credits: 3 })
  })

  it('reads only what is new, and waits for a half-written last line', async () => {
    const file = session('a', [start('/work/app'), usage({ id: '1', ts: iso(15) })])
    const s = make()
    await s.drain()
    const whole = usage({ id: '2', ts: iso(15) })
    fs.appendFileSync(file, whole.slice(0, 80))
    await s.drain()
    expect(copilot(s)?.last7.requests).toBe(1)
    fs.appendFileSync(file, `${whole.slice(80)}\n`)
    await s.drain()
    expect(copilot(s)?.last7.requests).toBe(2)
  })

  it('gives no value for corrupt, odd or unreadable lines and files, and does not break Claude', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    fs.mkdirSync(path.join(projects, 'p'), { recursive: true })
    fs.writeFileSync(path.join(projects, 'p', 'a.jsonl'), `${claudeLine('m1', iso(15))}\n`)
    session('good', [start('/work/app'), usage({ id: '1', ts: iso(15) })])
    session('garbage', [
      '{"type":"session.usage_record" not json',
      '\u0000\u0001 "session.usage_record"',
      '{"type":"session.usage_record","data":"x"}',
      '{"type":"session.usage_record","data":{"usage":{"accounting":{}}},"timestamp":"2026-11-15T10:00:00Z"}',
      '{"type":"session.usage_record","data":{"usage":{"accounting":{"usageId":"u"}}},"timestamp":"never"}',
      JSON.stringify({ type: 'session.usage_record', data: { usage: { inputTokens: 'many', accounting: { usageId: 'unknown-format' } } }, timestamp: iso(15) }),
    ])
    fs.mkdirSync(path.join(copilotHome, 'session-state', 'empty'), { recursive: true })
    const locked = session('locked', [start('/work/app'), usage({ id: '2', ts: iso(15) })])
    fs.chmodSync(locked, 0o000)
    const s = make()
    await s.drain()
    fs.chmodSync(locked, 0o600)
    expect(s.summary().agents.find((a) => a.agent === 'claude')?.last7.requests).toBe(1)
    // The one record of an unknown format counts as a request with no figures; the locked file gives nothing when this process
    // cannot be denied it (root).
    expect([2, 3]).toContain(copilot(s)?.last7.requests)
    expect(errors.mock.calls.flat().join(' ')).not.toContain(SECRET)
  })

  it('has no value, and no error, when Copilot has no session folder', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    fs.rmSync(copilotHome, { recursive: true })
    const s = make()
    await s.drain()
    expect(s.summary()).toMatchObject({ agents: [], building: false })
    expect(errors).not.toHaveBeenCalled()
  })

  it('saves no conversation text, owner-only', async () => {
    session('a', [start('/work/app'), chat(), usage({ id: '1', ts: iso(15) }), chat(), shutdown(1_000_000_000)], false, `cwd: /work/app\nname: ${SECRET}\n`)
    const s = make()
    await s.drain()
    s.close()
    const file = usageHistoryFile(home)
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    expect(fs.readFileSync(file, 'utf8')).not.toContain(SECRET)
  })

  it('reads a history saved before credits existed, with its requests as having no credit figure', () => {
    fs.writeFileSync(
      usageHistoryFile(home),
      JSON.stringify({ version: 1, since: NOW, floor: null, built: true, readers: {}, requests: { 'claude:m1': [new Date(2026, 10, 15).getTime(), 'claude', 'claude-opus', '/work/app', 3, 10, 100, 5, 0] } }),
    )
    const s = new UsageService({ home, readers: [], clock: () => NOW })
    expect(s.summary().agents[0]).toMatchObject({ agent: 'claude', last7: { requests: 1, credits: 0, withoutCredits: 0 } })
  })

  it('stays responsive while a large history is scanned for the first time', async () => {
    const filler = JSON.stringify({ type: 'assistant.message', data: { content: 'x'.repeat(2000) }, timestamp: iso(15) })
    for (let f = 0; f < 120; f++) {
      const lines = [start('/work/app')]
      for (let i = 0; i < 120; i++) lines.push(i % 40 === 0 ? usage({ id: `${f}-${i}`, ts: iso(15) }) : filler)
      session(`s${f}`, lines)
    }
    const inner = createCopilotReader({ copilotHome })
    let steps = 0
    let buildingMidScan: boolean | undefined
    const s = (service = new UsageService({
      home,
      readers: [
        {
          ...inner,
          step: async () => {
            const result = await inner.step()
            if (++steps === 5) buildingMidScan = s.summary().building
            return result
          },
        },
      ],
      clock: () => NOW,
    }))
    let worst = 0
    let last = performance.now()
    const probe = setInterval(() => {
      const t = performance.now()
      worst = Math.max(worst, t - last)
      last = t
    }, 5)
    const began = performance.now()
    await s.drain()
    const took = performance.now() - began
    clearInterval(probe)
    expect(steps).toBeGreaterThan(100)
    expect(buildingMidScan).toBe(true)
    expect(s.summary().building).toBe(false)
    expect(copilot(s)?.last7.requests).toBe(120 * 3)
    expect(worst).toBeLessThan(Math.max(150, took / 4))
  })
})
