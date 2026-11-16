import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClaudeReader } from './claude.ts'
import type { UsageReader } from './reader.ts'
import { STALL_LIMIT_MS, calmest, worstStall } from './loopProbe.ts'
import { UsageService, usageHistoryFile } from './service.ts'

// What a conversation says. It sits in every fixture line and must never reach the saved history.
const SECRET = 'my password is hunter2'

const at = (day: number, hour = 10, month = 10) => new Date(2026, month, day, hour).toISOString()
// 2026-11-16, local noon.
const NOW = new Date(2026, 10, 16, 12).getTime()

interface Line {
  id: string
  req?: string | null
  ts: string
  out?: number
  cwd?: string
  model?: string
  sidechain?: boolean
  error?: boolean
}

const line = (l: Line): string =>
  JSON.stringify({
    type: 'assistant',
    timestamp: l.ts,
    cwd: l.cwd ?? '/work/app',
    sessionId: 's',
    ...(l.req === null ? {} : { requestId: l.req ?? `req-${l.id}` }),
    ...(l.sidechain ? { isSidechain: true } : {}),
    ...(l.error ? { isApiErrorMessage: true } : {}),
    message: {
      id: l.id,
      model: l.model ?? 'claude-opus',
      content: [{ type: 'text', text: SECRET }],
      usage: { input_tokens: 3, output_tokens: l.out ?? 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 },
    },
  })

describe('usage history from Claude files, to the summary', () => {
  let dir: string
  let projects: string
  let home: string
  let service: UsageService | undefined
  let now = NOW

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-usage-'))
    projects = path.join(dir, 'projects')
    home = path.join(dir, 'home')
    fs.mkdirSync(projects, { recursive: true })
    fs.mkdirSync(home, { recursive: true })
    now = NOW
  })

  afterEach(() => {
    service?.close()
    service = undefined
    vi.restoreAllMocks()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const write = (rel: string, lines: string[], append = false): string => {
    const file = path.join(projects, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    ;(append ? fs.appendFileSync : fs.writeFileSync)(file, `${lines.join('\n')}\n`)
    return file
  }

  const make = (readers: UsageReader[] = [createClaudeReader({ projectsDir: projects })]): UsageService =>
    (service = new UsageService({ home, readers, clock: () => now, saveMs: 10, notifyMs: 10 }))

  const claude = (s: UsageService, days?: number) => s.summary(days).agents.find((a) => a.agent === 'claude')

  it('counts a request once however many lines and files repeat it', async () => {
    write('p/a.jsonl', [line({ id: 'm1', ts: at(15) }), line({ id: 'm1', ts: at(15) }), line({ id: 'm2', ts: at(15) })])
    write('p/b.jsonl', [line({ id: 'm1', ts: at(15) })])
    const s = make()
    await s.drain()
    expect(claude(s)?.today.requests).toBe(0)
    expect(claude(s)?.last7.requests).toBe(2)
    expect(claude(s)?.days).toMatchObject([{ day: '2026-11-15', requests: 2, input: 6, output: 20, cacheRead: 200, cacheWrite: 10, credits: 0, withoutCredits: 0 }])
  })

  it('counts a request without a request id by its message id alone', async () => {
    write('p/a.jsonl', [line({ id: 'm1', req: null, ts: at(15) }), line({ id: 'm1', req: null, ts: at(15) })])
    const s = make()
    await s.drain()
    expect(claude(s)?.last7.requests).toBe(1)
  })

  it('lets a later, larger count replace a partial one, also across passes', async () => {
    write('p/a.jsonl', [line({ id: 'm1', ts: at(15), out: 4 })])
    const s = make()
    await s.drain()
    expect(claude(s)?.last7.output).toBe(4)
    write('p/a.jsonl', [line({ id: 'm1', ts: at(15), out: 90 }), line({ id: 'm1', ts: at(15), out: 60 })], true)
    await s.drain()
    expect(claude(s)?.last7).toMatchObject({ requests: 1, output: 90 })
  })

  it('does not count a copied request in a resumed session twice, and keeps where it first happened', async () => {
    const original = write('p/orig.jsonl', [line({ id: 'm1', ts: at(14), cwd: '/work/first' })])
    write('q/resumed.jsonl', [line({ id: 'm1', ts: at(14), cwd: '/work/second' }), line({ id: 'm2', ts: at(15) })])
    // The resumed file is the newer one.
    fs.utimesSync(original, new Date(2026, 10, 14), new Date(2026, 10, 14))
    const s = make()
    await s.drain()
    expect(claude(s)?.last7.requests).toBe(2)
    expect(claude(s)?.days.map((d) => [d.day, d.requests])).toEqual([
      ['2026-11-14', 1],
      ['2026-11-15', 1],
    ])
  })

  it('includes the helper agents’ files', async () => {
    write('p/a.jsonl', [line({ id: 'm1', ts: at(15) })])
    write('p/a/subagents/agent-1.jsonl', [line({ id: 'h1', ts: at(15), sidechain: true }), line({ id: 'h2', ts: at(15), sidechain: true })])
    const s = make()
    await s.drain()
    expect(claude(s)?.last7.requests).toBe(3)
  })

  it('drops synthetic records and API errors', async () => {
    write('p/a.jsonl', [line({ id: 'm1', ts: at(15) }), line({ id: 'm2', ts: at(15), model: '<synthetic>' }), line({ id: 'm3', ts: at(15), error: true })])
    const s = make()
    await s.drain()
    expect(claude(s)?.last7.requests).toBe(1)
  })

  it('splits today, the last 7 days and the last 30 days, and returns the days asked for', async () => {
    write('p/a.jsonl', [
      line({ id: 't', ts: at(16, 9) }),
      line({ id: 'w', ts: at(10) }),
      line({ id: 'edge', ts: at(18, 10, 9) }),
      line({ id: 'out', ts: at(17, 10, 9) }),
    ])
    const s = make()
    await s.drain()
    const agent = claude(s, 10)!
    expect([agent.today.requests, agent.last7.requests, agent.last30.requests]).toEqual([1, 2, 3])
    expect(agent.days.map((d) => d.day)).toEqual(['2026-11-10', '2026-11-16'])
    expect(s.summary().today).toBe('2026-11-16')
  })

  it('keeps the history when the agent deletes its files, also across a restart', async () => {
    const file = write('p/a.jsonl', [line({ id: 'm1', ts: at(15) }), line({ id: 'm2', ts: at(14) })])
    const s = make()
    await s.drain()
    s.close()
    fs.rmSync(file)
    const again = make()
    await again.drain()
    expect(claude(again)?.last7.requests).toBe(2)
    expect(again.summary().historyFrom).toBe('2026-11-14')
  })

  it('reads only what is new after a restart', async () => {
    write('p/a.jsonl', [line({ id: 'm1', ts: at(15) })])
    const s = make()
    await s.drain()
    s.close()
    const reader = createClaudeReader({ projectsDir: projects })
    const step = vi.spyOn(reader, 'step')
    const again = make([reader])
    await again.drain()
    expect(step).toHaveBeenCalledTimes(1)
    expect((await step.mock.results[0].value).requests).toEqual([])
    write('p/a.jsonl', [line({ id: 'm2', ts: at(15) })], true)
    await again.drain()
    expect(claude(again)?.last7.requests).toBe(2)
  })

  it('leaves an agent out when it made no request in the last 30 days, and brings it back with its history', async () => {
    write('p/a.jsonl', [line({ id: 'old', ts: at(1, 10, 8) })])
    const s = make()
    await s.drain()
    expect(s.summary().agents).toEqual([])
    expect(s.summary().ready).toEqual({ from: '2026-09-01', to: '2026-09-01' })
    write('p/a.jsonl', [line({ id: 'new', ts: at(16, 11) })], true)
    await s.drain()
    expect(claude(s, 100)?.days.map((d) => d.day)).toEqual(['2026-09-01', '2026-11-16'])
  })

  it('reports no ready range for an empty history, from the day it was started', async () => {
    const s = make()
    await s.drain()
    expect(s.summary()).toMatchObject({ agents: [], ready: null, historyFrom: '2026-11-16', building: false })
  })

  it('wipes the history, resets "history from", and does not read the old files again', async () => {
    write('p/a.jsonl', [line({ id: 'm1', ts: at(3) })])
    const s = make()
    await s.drain()
    expect(s.summary().historyFrom).toBe('2026-11-03')
    now = new Date(2026, 10, 20, 9).getTime()
    await s.wipe()
    expect(s.summary()).toMatchObject({ agents: [], historyFrom: '2026-11-20', building: false })
    await s.drain()
    expect(s.summary().agents).toEqual([])
    // A session resumed after the wipe copies old history: it stays out. New requests come in.
    write('q/resumed.jsonl', [line({ id: 'm1', ts: at(3) }), line({ id: 'm9', ts: new Date(2026, 10, 20, 10).toISOString() })])
    await s.drain()
    expect(claude(s, 30)?.days.map((d) => d.day)).toEqual(['2026-11-20'])
    expect(s.summary().historyFrom).toBe('2026-11-20')
  })

  it('gives no value for a corrupt or unreadable file without breaking the others', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    write('p/good.jsonl', [line({ id: 'm1', ts: at(15) })])
    write('p/garbage.jsonl', ['{"usage": "assistant" not json', '\u0000\u0001 "usage" "assistant"', '{"type":"assistant","message":"usage"}'])
    const locked = write('p/locked.jsonl', [line({ id: 'm2', ts: at(15) })])
    fs.chmodSync(locked, 0o000)
    const s = make()
    await s.drain()
    fs.chmodSync(locked, 0o600)
    const count = claude(s)?.last7.requests
    // The locked file gives nothing when this process cannot be denied it (root); either way the good one counts.
    expect([1, 2]).toContain(count)
    expect(errors.mock.calls.flat().join(' ')).not.toContain(SECRET)
  })

  it('has no value, and no error, when Claude has no projects folder', async () => {
    fs.rmSync(projects, { recursive: true })
    const s = make()
    await s.drain()
    expect(s.summary()).toMatchObject({ agents: [], building: false })
  })

  it('saves the history owner-only, with no conversation text', async () => {
    write('p/a.jsonl', [line({ id: 'm1', ts: at(15) })])
    const s = make()
    await s.drain()
    s.close()
    const file = usageHistoryFile(home)
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    const saved = fs.readFileSync(file, 'utf8')
    expect(saved).not.toContain(SECRET)
    expect(saved).toContain('/work/app')
    expect(fs.readdirSync(home).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('sets a history it cannot read aside and starts a new one', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    fs.writeFileSync(usageHistoryFile(home), '{ not json')
    write('p/a.jsonl', [line({ id: 'm1', ts: at(15) })])
    const s = make()
    await s.drain()
    expect(claude(s)?.last7.requests).toBe(1)
    expect(fs.readdirSync(home).some((name) => name.startsWith('usage-history.json.corrupt-'))).toBe(true)
  })

  it('tells the window once for a burst of changes', async () => {
    write('p/a.jsonl', Array.from({ length: 50 }, (_, i) => line({ id: `m${i}`, ts: at(15) })))
    const s = make()
    const changed = vi.fn()
    s.subscribe(changed)
    await s.drain()
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('a failing reader gives nothing and does not stop the others', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    write('p/a.jsonl', [line({ id: 'm1', ts: at(15) })])
    const broken: UsageReader = { agent: 'claude', step: () => Promise.reject(new Error('boom')), state: () => ({}), restore: () => undefined, skipToEnd: async () => undefined }
    const s = make([broken, createClaudeReader({ projectsDir: projects })])
    await s.drain()
    expect(claude(s)?.last7.requests).toBe(1)
  })

  describe('the first scan of a large history', () => {
    it('says it is still building, keeps the core responsive, and finishes', async () => {
      const filler = JSON.stringify({ type: 'user', message: { content: 'x'.repeat(2000) } })
      for (let f = 0; f < 150; f++) {
        const lines: string[] = []
        for (let i = 0; i < 120; i++) lines.push(i % 40 === 0 ? line({ id: `m${f}-${i}`, ts: at(15) }) : filler)
        write(`proj${f % 10}/s${f}.jsonl`, lines)
      }
      const inner = createClaudeReader({ projectsDir: projects })
      let steps = 0
      let buildingMidScan: boolean | undefined
      let readyMidScan: unknown
      const spy: UsageReader = {
        ...inner,
        step: async () => {
          const result = await inner.step()
          if (++steps === 5) {
            buildingMidScan = s.summary().building
            readyMidScan = s.summary().ready
          }
          return result
        },
      }
      const s = make([spy])
      let worst = await worstStall(() => s.drain())
      expect(steps).toBeGreaterThan(100)
      expect(buildingMidScan).toBe(true)
      expect(readyMidScan).not.toBeNull()
      expect(s.summary().building).toBe(false)
      expect(claude(s)?.last7.requests).toBe(150 * 3)
      // The loop was never held for long.
      worst = await calmest(worst, async () => {
        s.close()
        fs.rmSync(home, { recursive: true, force: true })
        fs.mkdirSync(home)
        const next = make([createClaudeReader({ projectsDir: projects })])
        return worstStall(() => next.drain())
      })
      expect(worst).toBeLessThan(STALL_LIMIT_MS)
    })

    // A fixture of `files` transcripts of 120 lines each, three of which are requests: files * 3 requests in all.
    const fixture = (files: number): number => {
      const filler = JSON.stringify({ type: 'user', message: { content: 'x'.repeat(2000) } })
      for (let f = 0; f < files; f++) {
        const lines: string[] = []
        for (let i = 0; i < 120; i++) lines.push(i % 40 === 0 ? line({ id: `m${f}-${i}`, ts: at(15) }) : filler)
        write(`proj${f % 10}/s${f}.jsonl`, lines)
      }
      return files * 3
    }
    const progressOf = (s: UsageService): number | undefined => s.summary().progress.find((p) => p.agent === 'claude')?.fraction

    it('says how far the first read has got, growing until it is built and then gone', async () => {
      const total = fixture(30)
      const inner = createClaudeReader({ projectsDir: projects, chunkBytes: 64 * 1024 })
      const seen: Array<number | undefined> = []
      const ready: Array<string | undefined> = []
      const s = make([
        {
          ...inner,
          step: async () => {
            const result = await inner.step()
            seen.push(progressOf(s))
            ready.push(s.summary().ready?.to)
            return result
          },
        },
      ])
      expect(progressOf(s)).toBe(0)
      await s.drain()
      const fractions = seen.filter((value): value is number => value !== undefined)
      expect(fractions.length).toBeGreaterThan(5)
      expect(fractions[0]).toBeGreaterThan(0)
      expect(fractions.slice(1)).toEqual([...fractions.slice(1)].sort((a, b) => a - b))
      expect(fractions.at(-1)).toBeLessThanOrEqual(1)
      expect(new Set(fractions).size).toBeGreaterThan(3)
      expect(ready.at(-1)).toBe('2026-11-15')
      expect(s.summary()).toMatchObject({ building: false, progress: [] })
      expect(claude(s)?.last7.requests).toBe(total)
    })

    it('carries on from where it was after a restart in the middle of the first scan, without counting anything twice', async () => {
      const total = fixture(30)
      const first = createClaudeReader({ projectsDir: projects, chunkBytes: 64 * 1024 })
      let steps = 0
      const interrupted: UsageReader = {
        ...first,
        step: async () => {
          if (++steps > 40) throw new Error('killed')
          return first.step()
        },
      }
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const s = make([interrupted])
      await s.drain()
      const before = progressOf(s)
      const partial = claude(s)?.last7.requests ?? 0
      expect(s.summary().building).toBe(true)
      expect(partial).toBeGreaterThan(0)
      expect(partial).toBeLessThan(total)
      s.close()

      // What reading everything from nothing takes.
      const fresh = createClaudeReader({ projectsDir: projects, chunkBytes: 64 * 1024 })
      let full = 0
      for (let done = false; !done; full++) done = (await fresh.step()).done

      const reader = createClaudeReader({ projectsDir: projects, chunkBytes: 64 * 1024 })
      const step = vi.spyOn(reader, 'step')
      const again = make([reader])
      // The numbers it had are back at once, and it knows how far it was.
      expect(claude(again)?.last7.requests).toBe(partial)
      await again.drain()
      expect(claude(again)?.last7.requests).toBe(total)
      expect(again.summary()).toMatchObject({ building: false, progress: [] })
      // It did not start over: the files it had read are not read again.
      expect(step.mock.calls.length).toBeLessThan(full)
      expect(before).toBeGreaterThan(0)
    })

    it('never lets a pass that was cut short back into the numbers after a wipe', async () => {
      fixture(10)
      const s = make([createClaudeReader({ projectsDir: projects, chunkBytes: 64 * 1024 })])
      const pass = s.drain()
      await s.wipe()
      await pass
      expect(s.summary()).toMatchObject({ agents: [], building: false, progress: [] })
    })

    it('stays building after a restart in the middle of the first scan', async () => {
      write('p/a.jsonl', [line({ id: 'm1', ts: at(15) })])
      const never: UsageReader = { agent: 'claude', step: () => Promise.reject(new Error('stop')), state: () => ({}), restore: () => undefined, skipToEnd: async () => undefined }
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const s = make([never])
      await s.drain()
      expect(s.summary().building).toBe(true)
      s.close()
      expect(make().summary().building).toBe(true)
    })
  })

  describe('saving the history', () => {
    const many = (n: number): string[] => Array.from({ length: n }, (_, i) => line({ id: `m${i}`, ts: at(15), cwd: `/work/app${i % 7}` }))
    const leftovers = (): string[] => fs.readdirSync(home).filter((name) => name.endsWith('.tmp'))
    interface Saving {
      saveAsync(pause: () => Promise<void>): Promise<boolean>
      save(): void
    }
    // A service that never saves by itself, so the saves below are the only writer.
    const quiet = (): { s: UsageService; history: Saving } => {
      const s = (service = new UsageService({ home, readers: [createClaudeReader({ projectsDir: projects })], clock: () => now, saveMs: 600_000 }))
      return { s, history: (s as unknown as { history: Saving }).history }
    }

    it('saves without holding the loop: the file is written in slices with the loop given back between them', async () => {
      write('p/a.jsonl', many(6000))
      const { s, history } = quiet()
      await s.drain()
      let yields = 0
      expect(await history.saveAsync(async () => void yields++)).toBe(true)
      expect(yields).toBeGreaterThan(2)
      s.close()
      expect(claude(make())?.last7.requests).toBe(6000)
    })

    it('leaves the last good history readable when the writer is killed part way, and clears what it left behind', async () => {
      write('p/a.jsonl', many(300))
      const first = make()
      await first.drain()
      first.close()
      const file = usageHistoryFile(home)
      const good = fs.readFileSync(file, 'utf8')
      write('p/b.jsonl', many(6000))
      const { s, history } = quiet()
      await s.drain()
      let slices = 0
      await expect(
        history.saveAsync(async () => {
          if (++slices === 2) throw new Error('killed')
        }),
      ).rejects.toThrow('killed')
      // The file on disk is still the whole of the one before: not cut, not mixed.
      expect(fs.readFileSync(file, 'utf8')).toBe(good)
      // A real kill cannot clean up after itself: a temp file stays. The next start sweeps it and reads the good file.
      const stale = `${file}.deadbeef.tmp`
      fs.writeFileSync(stale, good.slice(0, good.length >> 1))
      service = undefined
      const next = make()
      expect(claude(next)?.last7.requests).toBe(300)
      expect(leftovers()).toEqual([])
    })

    it('does not let a slow save that a later one overtook put its older numbers back', async () => {
      write('p/a.jsonl', many(6000))
      const { s, history } = quiet()
      await s.drain()
      expect(
        await history.saveAsync(async () => {
          history.save()
        }),
      ).toBe(false)
      expect(leftovers()).toEqual([])
      s.close()
      expect(claude(make())?.last7.requests).toBe(6000)
    })

    it('never lets a save that was under way when the history was wiped bring the old days back', async () => {
      write('p/a.jsonl', many(6000))
      const s = (service = new UsageService({ home, readers: [createClaudeReader({ projectsDir: projects })], clock: () => now, saveMs: 1, notifyMs: 1 }))
      await s.drain()
      // The save has begun (its first slice is out) when the wipe comes.
      await new Promise((resolve) => setTimeout(resolve, 3))
      now = new Date(2026, 10, 20, 9).getTime()
      await s.wipe()
      await new Promise((resolve) => setTimeout(resolve, 80))
      s.close()
      expect(leftovers()).toEqual([])
      const again = make()
      expect(again.summary()).toMatchObject({ agents: [], historyFrom: '2026-11-20', ready: null })
      await again.drain()
      expect(again.summary().agents).toEqual([])
    })

    it('saves the history owner-only, with no conversation text, whichever agent it came from', async () => {
      write('p/a.jsonl', many(50))
      const s = make()
      await s.drain()
      await new Promise((resolve) => setTimeout(resolve, 60))
      s.close()
      const file = usageHistoryFile(home)
      expect(fs.statSync(file).mode & 0o777).toBe(0o600)
      const saved = fs.readFileSync(file, 'utf8')
      for (const forbidden of [SECRET, 'hunter2', '"text"', '"content"', '"prompt"', '"title"', '$', 'cost']) expect(saved).not.toContain(forbidden)
    })
  })
})
