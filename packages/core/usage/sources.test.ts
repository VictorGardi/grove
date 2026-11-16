import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UsageAgentSummary, UsageSplit } from '../../protocol/messages.ts'
import { createClaudeReader } from './claude.ts'
import { createCopilotReader } from './copilot.ts'
import { GroveSessions } from './groveSessions.ts'
import { UsageService } from './service.ts'

// Where requests ran: Claude Desktop as its own slice, and what Grove ran against what it did not, from the agents' files and
// Grove's own per-tab records to the summary.

const SECRET = 'my password is hunter2'
const ms = (day: number, hour = 10, month = 10) => new Date(2026, month, day, hour).getTime()
const iso = (day: number, hour = 10, month = 10) => new Date(ms(day, hour, month)).toISOString()
// 2026-11-16, local noon. Grove began recording Claude sessions on the 5th, at 08:00.
const NOW = ms(16, 12)
const BEGAN = ms(5, 8)

interface ClaudeLine {
  id: string
  ts: string
  session?: string
  entrypoint?: string
  out?: number
  sidechain?: boolean
}

const claudeLine = (l: ClaudeLine): string =>
  JSON.stringify({
    type: 'assistant',
    timestamp: l.ts,
    cwd: '/work/app',
    sessionId: l.session ?? 'session-a',
    requestId: `req-${l.id}`,
    ...(l.entrypoint === undefined ? {} : { entrypoint: l.entrypoint }),
    ...(l.sidechain ? { isSidechain: true } : {}),
    message: { id: l.id, model: 'claude-opus', content: [{ type: 'text', text: SECRET }], usage: { input_tokens: 3, output_tokens: l.out ?? 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 } },
  })

interface CopilotUsage {
  id: string
  ts: string
  nano?: number | null
}

const copilotLine = (r: CopilotUsage): string =>
  JSON.stringify({
    type: 'session.usage_record',
    data: {
      usage: {
        model: 'gpt-6-luna',
        inputTokens: 1000,
        outputTokens: 50,
        cacheReadTokens: 600,
        cacheWriteTokens: 300,
        initiator: 'agent',
        accounting: { usageId: `usage-${r.id}` },
        ...(r.nano === null ? {} : { copilotUsage: { totalNanoAiu: r.nano ?? 2_000_000_000 } }),
        aiCreditsStatus: 'complete',
      },
    },
    timestamp: r.ts,
  })
const copilotStart = (cwd: string): string => JSON.stringify({ type: 'session.start', data: { sessionId: 's', context: { cwd } }, timestamp: iso(1, 9, 9) })

describe('where requests ran: Claude Desktop and the Grove split', () => {
  let dir: string
  let projects: string
  let copilotHome: string
  let home: string
  let service: UsageService | undefined
  // The sessions of the tabs open now, as Grove's saved state names them.
  let live: Array<{ agent: 'claude' | 'copilot'; sessionId: string }>
  let now = NOW

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-usage-sources-'))
    projects = path.join(dir, 'projects')
    copilotHome = path.join(dir, 'copilot')
    home = path.join(dir, 'home')
    for (const folder of [projects, copilotHome, home]) fs.mkdirSync(folder, { recursive: true })
    live = []
    now = NOW
  })

  afterEach(() => {
    service?.close()
    service = undefined
    vi.restoreAllMocks()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const transcript = (rel: string, lines: string[], append = false): void => {
    const file = path.join(projects, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    ;(append ? fs.appendFileSync : fs.writeFileSync)(file, `${lines.join('\n')}\n`)
  }

  const copilotSession = (id: string, lines: string[]): void => {
    const folder = path.join(copilotHome, 'session-state', id)
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(folder, 'events.jsonl'), `${lines.join('\n')}\n`)
  }

  // Grove's own per-tab records, the way Grove writes them.
  const groveFile = (agent: string, name: string, body: string): void => {
    fs.mkdirSync(path.join(home, 'agents', agent), { recursive: true })
    fs.writeFileSync(path.join(home, 'agents', agent, name), body)
  }
  const claudeHook = (tab: string, session: string, at: number, event = 'SessionStart'): void =>
    groveFile('claude', `${tab}.jsonl`, `${JSON.stringify({ event, at, payload: { session_id: session, hook_event_name: event, prompt: SECRET } })}\n`)
  const copilotHook = (tab: string, session: string, timestamp: number): void =>
    groveFile('copilot', `${tab}.jsonl`, `${JSON.stringify({ t: new Date(timestamp).toISOString(), e: { hook_event_name: 'sessionStart', sessionId: session, timestamp, initialPrompt: SECRET } })}\n`)

  const make = (): UsageService => {
    const grove = new GroveSessions({ home, live: () => live, now: () => now })
    return (service = new UsageService({
      home,
      grove,
      readers: [createClaudeReader({ projectsDir: projects, grove }), createCopilotReader({ copilotHome, grove })],
      clock: () => now,
      notifyMs: 10,
    }))
  }

  const agentOf = (s: UsageService, agent: 'claude' | 'copilot'): UsageAgentSummary | undefined => s.summary(30).agents.find((a) => a.agent === agent)
  const split = (agent: UsageAgentSummary | undefined): Partial<Record<UsageSplit, number>> => Object.fromEntries((agent?.sources ?? []).map((s) => [s.split, s.requests]))
  const dayOf = (agent: UsageAgentSummary | undefined, day: string) => agent?.days.find((d) => d.day === day)
  const read = async (): Promise<UsageService> => {
    const s = make()
    await s.drain()
    return s
  }

  describe('Claude Desktop', () => {
    it('is its own slice, counted in Claude’s total, and told from Claude Code by the record’s entrypoint', async () => {
      transcript('p/a.jsonl', [
        claudeLine({ id: 'm1', ts: iso(15), entrypoint: 'claude-desktop' }),
        claudeLine({ id: 'm2', ts: iso(15), entrypoint: 'claude-desktop' }),
        claudeLine({ id: 'm3', ts: iso(15), entrypoint: 'cli' }),
        claudeLine({ id: 'm4', ts: iso(15), entrypoint: 'sdk-cli' }),
        claudeLine({ id: 'm5', ts: iso(15) }),
      ])
      claudeHook('tab', 'other-session', BEGAN)
      const claude = agentOf(await read(), 'claude')
      expect(claude?.last30.requests).toBe(5)
      // Desktop is known, never Grove's; the three Claude Code requests are after Grove began recording and in no Grove session.
      expect(split(claude)).toEqual({ desktop: 2, other: 3 })
      expect(dayOf(claude, '2026-11-15')?.sources.map((s) => [s.split, s.requests])).toEqual([
        ['desktop', 2],
        ['other', 3],
      ])
    })

    it('is known and never Grove’s, even before Grove began recording and even inside a session Grove has a record of', async () => {
      transcript('p/a.jsonl', [
        claudeLine({ id: 'old', ts: iso(2), entrypoint: 'claude-desktop' }),
        claudeLine({ id: 'new', ts: iso(15), entrypoint: 'claude-desktop', session: 'in-grove' }),
      ])
      claudeHook('tab', 'in-grove', BEGAN)
      const claude = agentOf(await read(), 'claude')
      expect(split(claude)).toEqual({ desktop: 2 })
    })

    it('keeps a Desktop helper agent’s requests in the Desktop slice', async () => {
      transcript('p/s1/subagents/agent-1.jsonl', [claudeLine({ id: 'h1', ts: iso(15), entrypoint: 'claude-desktop', sidechain: true })])
      const claude = agentOf(await read(), 'claude')
      expect(split(claude)).toEqual({ desktop: 1 })
      expect(claude?.days[0].helperRequests).toBe(1)
    })
  })

  describe('what the history holds', () => {
    it('is figures, a model, a folder and a source for every request, and no conversation text, whichever agent made it', async () => {
      claudeHook('tab-1', 'session-a', BEGAN)
      transcript('p/s1.jsonl', [claudeLine({ id: 'c1', ts: iso(15) }), claudeLine({ id: 'c2', ts: iso(15), entrypoint: 'claude-desktop' })])
      transcript('p/s1/subagents/agent-1.jsonl', [claudeLine({ id: 'h1', ts: iso(15), sidechain: true })])
      copilotHook('tab-2', 's', ms(1, 9, 9))
      copilotSession('s', [copilotStart('/work/app'), copilotLine({ id: 'u1', ts: iso(15) }), JSON.stringify({ type: 'user.message', data: { content: SECRET }, timestamp: iso(15) })])
      const s = await read()
      const shown = JSON.stringify(s.summary(30, 30))
      expect(shown).not.toContain(SECRET)
      expect(shown).not.toMatch(/hunter2|password|initialPrompt|prompt|content|"text"/)
      expect(shown).not.toMatch(/[$€£]|usd|dollar|cost|price/i)
      expect(agentOf(s, 'claude')?.last30.requests).toBe(3)
      expect(agentOf(s, 'copilot')?.last30.requests).toBe(1)
      expect(agentOf(s, 'claude')?.repositories.map((r) => r.requests)).toEqual([3])
      // Nothing of it is saved: the home holds only the per-tab records Grove itself wrote.
      s.close()
      expect(fs.readdirSync(home)).toEqual(['agents'])
    })
  })

  describe('Claude Code run in Grove', () => {
    it('is the sessions Grove has a record of, and the rest are not tracked by Grove', async () => {
      transcript('p/a.jsonl', [claudeLine({ id: 'g1', ts: iso(15), session: 'in-grove' }), claudeLine({ id: 'o1', ts: iso(15), session: 'by-hand' })])
      transcript('p/in-grove/subagents/agent-1.jsonl', [claudeLine({ id: 'g2', ts: iso(15), session: 'in-grove', sidechain: true })])
      claudeHook('tab', 'in-grove', ms(15, 9))
      claudeHook('early', 'earlier', BEGAN)
      const claude = agentOf(await read(), 'claude')
      expect(split(claude)).toEqual({ grove: 2, other: 1 })
    })

    it('counts a closed or killed tab as Grove: its records stay when the tab goes', async () => {
      transcript('p/a.jsonl', [claudeLine({ id: 'g1', ts: iso(15), session: 'closed' })])
      claudeHook('tab', 'closed', ms(15, 9))
      // No tab is open (live is empty) and the tab left only its records behind.
      expect(split(agentOf(await read(), 'claude'))).toEqual({ grove: 1 })
    })

    it('keeps what it learnt in memory while the core runs when Grove’s per-tab files are removed', async () => {
      transcript('p/a.jsonl', [claudeLine({ id: 'g1', ts: iso(15), session: 'closed' })])
      claudeHook('tab', 'closed', ms(15, 9))
      const s = await read()
      fs.rmSync(path.join(home, 'agents'), { recursive: true })
      transcript('p/a.jsonl', [claudeLine({ id: 'g2', ts: iso(15, 11), session: 'closed' })], true)
      await s.drain()
      expect(split(agentOf(s, 'claude'))).toEqual({ grove: 2 })
      expect(agentOf(s, 'claude')?.trackedSince).toBe('2026-11-15')
    })

    it('cannot tell after a restart once Grove’s per-tab files are gone: nothing about them is saved', async () => {
      transcript('p/a.jsonl', [claudeLine({ id: 'g1', ts: iso(15), session: 'closed' })])
      claudeHook('tab', 'closed', ms(15, 9))
      const first = await read()
      first.close()
      fs.rmSync(path.join(home, 'agents'), { recursive: true })
      const again = await read()
      expect(split(agentOf(again, 'claude'))).toEqual({ unknown: 1 })
      expect(agentOf(again, 'claude')?.trackedSince).toBeNull()
    })

    it('knows a session from the tab’s status file, and from a tab that is open now', async () => {
      transcript('p/a.jsonl', [claudeLine({ id: 'a', ts: iso(15), session: 'by-status' }), claudeLine({ id: 'b', ts: iso(15), session: 'by-state' }), claudeLine({ id: 'c', ts: iso(15), session: 'nobody' })])
      claudeHook('early', 'earlier', BEGAN)
      groveFile('claude', 'tab-a.status.json', JSON.stringify({ resumeId: 'by-status' }))
      live = [{ agent: 'claude', sessionId: 'by-state' }]
      expect(split(agentOf(await read(), 'claude'))).toEqual({ grove: 2, other: 1 })
    })

    it('splits a session resumed in Grove by each record’s time against its first Grove record', async () => {
      transcript('p/a.jsonl', [
        claudeLine({ id: 'before-tracking', ts: iso(2), session: 'resumed' }),
        claudeLine({ id: 'by-hand', ts: iso(10), session: 'resumed' }),
        claudeLine({ id: 'in-grove', ts: iso(12), session: 'resumed' }),
      ])
      claudeHook('tab', 'resumed', ms(11, 9), 'SessionStart')
      claudeHook('early', 'earlier', BEGAN)
      const claude = agentOf(await read(), 'claude')
      expect(split(claude)).toEqual({ unknown: 1, other: 1, grove: 1 })
    })
  })

  describe('a session Grove’s records had not caught up with', () => {
    // The clock sits where the requests are: they were made after the pass began, so the pass could not know their session.
    const LATE = NOW + 1000

    it('corrects Claude Code requests first tagged not Grove’s once the hook record is in, and not those made before the pass', async () => {
      claudeHook('early', 'earlier', BEGAN)
      transcript('p/a.jsonl', [claudeLine({ id: 'late', ts: new Date(LATE).toISOString(), session: 'late' }), claudeLine({ id: 'old', ts: iso(15), session: 'by-hand' })])
      const s = await read()
      expect(split(agentOf(s, 'claude'))).toEqual({ other: 2 })
      claudeHook('tab', 'late', LATE - 500)
      now = LATE + 1000
      await s.drain()
      expect(split(agentOf(s, 'claude'))).toEqual({ grove: 1, other: 1 })
    })

    it('does the same for Copilot, and for a request that was unknown', async () => {
      copilotSession('late', [copilotStart('/work/app'), copilotLine({ id: 'a', ts: new Date(LATE).toISOString() })])
      transcript('p/a.jsonl', [claudeLine({ id: 'unknown', ts: new Date(LATE).toISOString(), session: 'late' })])
      const s = await read()
      expect(split(agentOf(s, 'copilot'))).toEqual({ other: 1 })
      expect(split(agentOf(s, 'claude'))).toEqual({ unknown: 1 })
      copilotHook('tab', 'late', LATE - 500)
      claudeHook('tab', 'late', LATE - 500)
      now = LATE + 1000
      await s.drain()
      expect(split(agentOf(s, 'copilot'))).toEqual({ grove: 1 })
      expect(split(agentOf(s, 'claude'))).toEqual({ grove: 1 })
    })

    it('still keeps a time-less record from widening a resumed session’s Grove part', async () => {
      claudeHook('early', 'earlier', BEGAN)
      transcript('p/a.jsonl', [claudeLine({ id: 'by-hand', ts: new Date(LATE).toISOString(), session: 'resumed' })])
      const s = await read()
      claudeHook('tab', 'resumed', LATE + 5000)
      groveFile('claude', 'tab.status.json', JSON.stringify({ resumeId: 'resumed' }))
      now = LATE + 1000
      await s.drain()
      expect(split(agentOf(s, 'claude'))).toEqual({ other: 1 })
    })
  })

  it('keeps the split of a resumed session when the tab’s status file and an open tab also name it', async () => {
    transcript('p/a.jsonl', [claudeLine({ id: 'by-hand', ts: iso(10), session: 'resumed' }), claudeLine({ id: 'in-grove', ts: iso(12), session: 'resumed' })])
    copilotSession('resumed', [copilotStart('/work/app'), copilotLine({ id: 'a', ts: iso(10) }), copilotLine({ id: 'b', ts: iso(12) })])
    claudeHook('tab', 'resumed', ms(11, 9))
    claudeHook('early', 'earlier', BEGAN)
    copilotHook('tab', 'resumed', ms(11, 9))
    groveFile('claude', 'tab.status.json', JSON.stringify({ resumeId: 'resumed' }))
    groveFile('copilot', 'tab.status.json', JSON.stringify({ resumeId: 'resumed' }))
    live = [{ agent: 'claude', sessionId: 'resumed' }, { agent: 'copilot', sessionId: 'resumed' }]
    const s = await read()
    expect(split(agentOf(s, 'claude'))).toEqual({ other: 1, grove: 1 })
    expect(split(agentOf(s, 'copilot'))).toEqual({ other: 1, grove: 1 })
  })

  describe('before Grove recorded Claude sessions', () => {
    it('says it cannot tell for Claude Code, from the earliest Grove record on this machine and not a fixed date', async () => {
      transcript('p/a.jsonl', [
        claudeLine({ id: 'old', ts: iso(3), session: 'by-hand' }),
        claudeLine({ id: 'new', ts: iso(6), session: 'by-hand' }),
        claudeLine({ id: 'desktop', ts: iso(3), entrypoint: 'claude-desktop' }),
      ])
      claudeHook('tab', 'later', ms(9, 9))
      claudeHook('first', 'first-ever', ms(5, 8))
      const claude = agentOf(await read(), 'claude')
      expect(claude?.trackedSince).toBe('2026-11-05')
      expect(split(claude)).toEqual({ unknown: 1, other: 1, desktop: 1 })
    })

    it('uses a different date when Grove began recording on a different day', async () => {
      transcript('p/a.jsonl', [claudeLine({ id: 'a', ts: iso(6), session: 'by-hand' })])
      claudeHook('first', 'first-ever', ms(9, 9))
      const claude = agentOf(await read(), 'claude')
      expect(claude?.trackedSince).toBe('2026-11-09')
      expect(split(claude)).toEqual({ unknown: 1 })
    })

    it('cannot tell for any Claude Code request when Grove has no record at all, and says no date', async () => {
      transcript('p/a.jsonl', [claudeLine({ id: 'a', ts: iso(15), session: 'x' })])
      const claude = agentOf(await read(), 'claude')
      expect(claude?.trackedSince).toBeNull()
      expect(split(claude)).toEqual({ unknown: 1 })
    })
  })

  describe('Copilot run in Grove', () => {
    it('joins each session against Grove’s own records, back to the session’s start, with credits carried per split', async () => {
      copilotSession('in-grove', [copilotStart('/work/app'), copilotLine({ id: 'a', ts: iso(15), nano: 3_000_000_000 }), copilotLine({ id: 'b', ts: iso(15), nano: null })])
      copilotSession('by-hand', [copilotStart('/work/app'), copilotLine({ id: 'c', ts: iso(14), nano: 1_000_000_000 }), copilotLine({ id: 'd', ts: iso(14), nano: null })])
      copilotHook('tab', 'in-grove', ms(15, 9))
      const copilot = agentOf(await read(), 'copilot')
      expect(split(copilot)).toEqual({ grove: 2, other: 2 })
      expect(copilot?.sources.map((s) => ({ split: s.split, credits: s.credits, withoutCredits: s.withoutCredits }))).toEqual([
        { split: 'grove', credits: 3, withoutCredits: 1 },
        { split: 'other', credits: 1, withoutCredits: 1 },
      ])
      expect(copilot?.last30).toMatchObject({ requests: 4, credits: 4, withoutCredits: 2 })
      expect(copilot?.trackedSince).toBeNull()
    })

    it('counts a closed or killed tab’s session as Grove, and one only the tab’s status file or state names', async () => {
      copilotSession('closed', [copilotStart('/work/app'), copilotLine({ id: 'a', ts: iso(15) })])
      copilotSession('by-status', [copilotStart('/work/app'), copilotLine({ id: 'b', ts: iso(15) })])
      copilotSession('by-state', [copilotStart('/work/app'), copilotLine({ id: 'c', ts: iso(15) })])
      copilotSession('nobody', [copilotStart('/work/app'), copilotLine({ id: 'd', ts: iso(15) })])
      copilotHook('tab', 'closed', ms(15, 9))
      groveFile('copilot', 'tab-b.status.json', JSON.stringify({ status: { state: 'idle', since: 1 }, resumeId: 'by-status' }))
      live = [{ agent: 'copilot', sessionId: 'by-state' }]
      expect(split(agentOf(await read(), 'copilot'))).toEqual({ grove: 3, other: 1 })
    })

    it('splits a resumed session by each record’s time', async () => {
      copilotSession('resumed', [copilotStart('/work/app'), copilotLine({ id: 'a', ts: iso(3) }), copilotLine({ id: 'b', ts: iso(14, 10) }), copilotLine({ id: 'c', ts: iso(14, 12) })])
      copilotHook('tab', 'resumed', ms(14, 11))
      const copilot = agentOf(await read(), 'copilot')
      expect(split(copilot)).toEqual({ grove: 1, other: 2 })
    })
  })

  describe('when Grove’s records are missing or broken', () => {
    it('gives not tracked for Copilot and can’t tell for Claude Code, and breaks nothing, when Grove’s home holds no agents folder', async () => {
      transcript('p/a.jsonl', [claudeLine({ id: 'a', ts: iso(15) }), claudeLine({ id: 'd', ts: iso(15), entrypoint: 'claude-desktop' })])
      copilotSession('c', [copilotStart('/work/app'), copilotLine({ id: 'a', ts: iso(15) })])
      const s = await read()
      expect(split(agentOf(s, 'claude'))).toEqual({ unknown: 1, desktop: 1 })
      expect(split(agentOf(s, 'copilot'))).toEqual({ other: 1 })
    })

    it('skips corrupt lines and files and still reads the good ones', async () => {
      transcript('p/a.jsonl', [claudeLine({ id: 'a', ts: iso(15), session: 'good' }), claudeLine({ id: 'b', ts: iso(15), session: 'by-hand' })])
      copilotSession('good', [copilotStart('/work/app'), copilotLine({ id: 'a', ts: iso(15) })])
      groveFile('claude', 'bad.jsonl', `not json\n{"event":"SessionStart"}\n{"event":"SessionStart","at":"soon","payload":{"session_id":"x"}}\n{"at":1,"payload":null}\n`)
      groveFile('claude', 'bad.status.json', '{ this is not json')
      groveFile('claude', 'bad.usage.json', '[]')
      groveFile('claude', 'binary.jsonl', '\u0000\u0001\u0002')
      groveFile('copilot', 'bad.jsonl', `{"e":{"sessionId":"x"}}\n}{\n`)
      groveFile('copilot', 'bad.status.json', '')
      claudeHook('tab', 'good', BEGAN)
      copilotHook('tab', 'good', ms(15, 9))
      const s = await read()
      expect(split(agentOf(s, 'claude'))).toEqual({ grove: 1, other: 1 })
      expect(split(agentOf(s, 'copilot'))).toEqual({ grove: 1 })
    })

    it('treats a Grove folder that is a file, not a folder, as no record', async () => {
      transcript('p/a.jsonl', [claudeLine({ id: 'a', ts: iso(15) })])
      fs.writeFileSync(path.join(home, 'agents'), 'not a folder')
      expect(split(agentOf(await read(), 'claude'))).toEqual({ unknown: 1 })
    })

    it('does not keep conversation text from Grove’s records or from the agents’ files', async () => {
      transcript('p/a.jsonl', [claudeLine({ id: 'a', ts: iso(15), session: 'in-grove' })])
      claudeHook('tab', 'in-grove', BEGAN)
      copilotSession('c', [copilotStart('/work/app'), copilotLine({ id: 'a', ts: iso(15) })])
      copilotHook('tab', 'c', ms(15, 9))
      const s = await read()
      expect(JSON.stringify(s.summary(30, 30))).not.toContain(SECRET)
      s.close()
      expect(fs.readdirSync(home)).toEqual(['agents'])
    })
  })

  describe('the selected range', () => {
    it('adds up each split over the range and carries it per day, leaving out a split with no request', async () => {
      transcript('p/a.jsonl', [
        claudeLine({ id: 'd1', ts: iso(15), entrypoint: 'claude-desktop' }),
        claudeLine({ id: 'g1', ts: iso(14), session: 'in-grove' }),
        claudeLine({ id: 'g2', ts: iso(15), session: 'in-grove' }),
      ])
      claudeHook('tab', 'in-grove', ms(13, 9))
      const s = await read()
      const claude = agentOf(s, 'claude')
      expect(claude?.sources.map((x) => [x.split, x.requests])).toEqual([
        ['desktop', 1],
        ['grove', 2],
      ])
      expect(dayOf(claude, '2026-11-14')?.sources.map((x) => x.split)).toEqual(['grove'])
      // A range of one day covers today only, and the day before is out of it.
      now = ms(15, 12)
      expect(s.summary(30, 1).agents[0].sources.map((x) => [x.split, x.requests])).toEqual([
        ['desktop', 1],
        ['grove', 1],
      ])
    })
  })
})
