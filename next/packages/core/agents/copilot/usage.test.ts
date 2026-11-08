import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContextUsage } from '../../../protocol/messages.ts'
import { POLL_MS } from '../../status/spool.ts'
import { createCopilotUsageSource, usageFromLine } from './usage.ts'

// One events.jsonl line, shaped like the lines Copilot writes: a top-level type, the event data and an ISO timestamp.
let events = 0
const eventLine = (type: string, data: unknown, timestamp: string) => {
  events += 1
  return JSON.stringify({ type, data, id: `evt-${events}`, timestamp, parentId: '00000000-0000-4000-8000-000000000000' })
}

// A session.usage_record. The cache breakdown Copilot sends along every record is included by default, so most readings
// double as proof that the breakdown never reaches the tokens.
const record = (inputTokens: unknown, window: number | undefined, model: string, timestamp: string) =>
  eventLine('session.usage_record', {
    usage: {
      model,
      inputTokens,
      outputTokens: 347,
      reasoningTokens: 211,
      cacheReadTokens: 10_464,
      cacheWriteTokens: 7_639,
      ...(window === undefined ? {} : { maxPromptTokens: window }),
    },
  }, timestamp)

const checkpoint = (timestamp: string) =>
  eventLine('session.usage_checkpoint', { usage: { model: 'checkpoint-aggregate', inputTokens: 999_999, maxPromptTokens: 272_000 } }, timestamp)

const start = (timestamp: string) => eventLine('session.start', { sessionId: '00000000-0000-4000-8000-0000000000ab' }, timestamp)

const AT_A = Date.parse('2026-11-07T20:30:28.702Z')
const AT_B = Date.parse('2026-11-07T21:15:10.123Z')

describe('usageFromLine', () => {
  it('reads the input tokens only, the window, the model and the event timestamp', () => {
    expect(usageFromLine(record(18_106, 272_000, 'gpt-6-luna', '2026-11-07T20:30:28.702Z'))).toEqual({
      tokens: 18_106,
      window: 272_000,
      percent: null,
      model: 'gpt-6-luna',
      at: AT_A,
    })
  })

  it('never adds the cache breakdowns to the tokens', () => {
    const context = usageFromLine(record(18_106, 272_000, 'gpt-6-luna', '2026-11-07T20:30:28.702Z'))
    expect(context?.tokens).toBe(18_106)
    expect(context?.tokens).not.toBe(18_106 + 10_464 + 7_639)
    expect(context?.percent).toBeNull()
  })

  it('shows the tokens alone when the record has no max prompt tokens', () => {
    const context = usageFromLine(record(500, undefined, 'gpt-5-mini', '2026-11-07T20:28:00.000Z'))
    expect(context?.window).toBeNull()
    expect(context?.percent).toBeNull()
  })

  it('has no model when the record carries none', () => {
    expect(usageFromLine(eventLine('session.usage_record', { usage: { inputTokens: 50 } }, '2026-11-07T20:28:00.000Z'))).toEqual({
      tokens: 50,
      window: null,
      percent: null,
      model: null,
      at: Date.parse('2026-11-07T20:28:00.000Z'),
    })
  })

  it('is null for checkpoints, other events, and lines that are not usage records', () => {
    expect(usageFromLine(checkpoint('2026-11-07T20:30:28.702Z'))).toBeNull()
    expect(usageFromLine(start('2026-11-07T20:30:28.702Z'))).toBeNull()
    expect(usageFromLine(eventLine('hook.start', { hook: 'before' }, '2026-11-07T20:30:28.702Z'))).toBeNull()
    expect(usageFromLine('not json')).toBeNull()
    expect(usageFromLine('{"type":"session.usage_record","data":')).toBeNull()
  })
})

describe('createCopilotUsageSource', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-copilot-usage-'))
  })

  afterEach(() => {
    vi.useRealTimers()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const write = (file: string, ...lines: string[]) => fs.writeFileSync(file, lines.join('\n') + '\n')

  it('replays the newest usage record on start, one reading only', () => {
    const file = path.join(dir, 'tab-a.jsonl')
    write(
      file,
      start('2026-11-07T20:27:00.000Z'),
      checkpoint('2026-11-07T20:27:30.000Z'),
      record(12_000, 272_000, 'gpt-5-mini', '2026-11-07T20:28:00.000Z'),
      record(18_106, 272_000, 'gpt-6-luna', '2026-11-07T20:30:28.702Z'),
    )
    const seen: ContextUsage[] = []
    const source = createCopilotUsageSource({ file, onContext: (c) => seen.push(c) })
    source.close()
    // One reading: the newest record, with the checkpoint's aggregate left out.
    expect(seen).toEqual([{ tokens: 18_106, window: 272_000, percent: null, model: 'gpt-6-luna', at: AT_A }])
  })

  it('reads the event timestamp, never the poll time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'))
    const file = path.join(dir, 'tab-c.jsonl')
    write(file, record(18_106, 272_000, 'gpt-6-luna', '2026-11-07T20:30:28.702Z'))
    const seen: ContextUsage[] = []
    const source = createCopilotUsageSource({ file, onContext: (c) => seen.push(c) })
    fs.appendFileSync(file, record(9_123, 128_000, 'o4-mini', '2026-11-07T21:15:10.123Z') + '\n')
    vi.advanceTimersByTime(POLL_MS)
    source.close()
    expect(seen).toHaveLength(2)
    expect(seen.map((c) => c.at)).toEqual([AT_A, AT_B])
  })

  it('keeps two session files apart, each delivering its readings to its own callback', () => {
    vi.useFakeTimers()
    const fileA = path.join(dir, 'tab-a.jsonl')
    const fileB = path.join(dir, 'tab-b.jsonl')
    write(fileA, record(12_000, 272_000, 'gpt-5-mini', '2026-11-07T20:28:00.000Z'), record(18_106, 272_000, 'gpt-6-luna', '2026-11-07T20:30:28.702Z'))
    write(fileB, record(9_123, 128_000, 'o4-mini', '2026-11-07T21:15:10.123Z'))
    const seenA: ContextUsage[] = []
    const seenB: ContextUsage[] = []
    const sourceA = createCopilotUsageSource({ file: fileA, onContext: (c) => seenA.push(c) })
    const sourceB = createCopilotUsageSource({ file: fileB, onContext: (c) => seenB.push(c) })
    // The files start with different tokens, windows, models and timestamps; each callback gets only its own file's reading.
    expect(seenA).toEqual([{ tokens: 18_106, window: 272_000, percent: null, model: 'gpt-6-luna', at: AT_A }])
    expect(seenB).toEqual([{ tokens: 9_123, window: 128_000, percent: null, model: 'o4-mini', at: AT_B }])
    fs.appendFileSync(fileA, record(9_900, 272_000, 'gpt-6-luna', '2026-11-07T20:31:00.000Z') + '\n')
    fs.appendFileSync(fileB, record(7_777, 128_000, 'o4-mini', '2026-11-07T21:16:10.123Z') + '\n')
    vi.advanceTimersByTime(POLL_MS)
    sourceA.close()
    sourceB.close()
    expect(seenA.map((c) => [c.tokens, c.model, c.at])).toEqual([
      [18_106, 'gpt-6-luna', AT_A],
      [9_900, 'gpt-6-luna', Date.parse('2026-11-07T20:31:00.000Z')],
    ])
    expect(seenB.map((c) => [c.tokens, c.model, c.at])).toEqual([
      [9_123, 'o4-mini', AT_B],
      [7_777, 'o4-mini', Date.parse('2026-11-07T21:16:10.123Z')],
    ])
  })

  it('delivers nothing before the first usage record appears', () => {
    const file = path.join(dir, 'tab-d.jsonl')
    write(
      file,
      start('2026-11-07T20:05:00.000Z'),
      checkpoint('2026-11-07T20:05:30.000Z'),
      eventLine('hook.start', { hook: 'before' }, '2026-11-07T20:05:40.000Z'),
      'not json',
    )
    const seen: ContextUsage[] = []
    const source = createCopilotUsageSource({ file, onContext: (c) => seen.push(c) })
    expect(seen).toEqual([])
    fs.appendFileSync(file, record(58, 272_000, 'gpt-4.1-mini', '2026-11-07T20:06:00.000Z') + '\n')
    source.drain()
    source.close()
    expect(seen).toEqual([{ tokens: 58, window: 272_000, percent: null, model: 'gpt-4.1-mini', at: Date.parse('2026-11-07T20:06:00.000Z') }])
  })

  it('ignores checkpoints, unknown events and malformed lines, and keeps reading past them', () => {
    const file = path.join(dir, 'tab-e.jsonl')
    write(
      file,
      checkpoint('2026-11-07T20:10:00.000Z'),
      eventLine('hook.start', { hook: 'before' }, '2026-11-07T20:10:10.000Z'),
      'not json',
      '{"type":"session.usage_record","data":',
      record(4_321, 272_000, 'gpt-4.1-mini', '2026-11-07T20:10:20.000Z'),
    )
    const seen: ContextUsage[] = []
    const source = createCopilotUsageSource({ file, onContext: (c) => seen.push(c) })
    fs.appendFileSync(file, record(4_555, 272_000, 'gpt-4.1-mini', '2026-11-07T20:11:00.000Z') + '\n')
    source.drain()
    source.close()
    // Even with the checkpoint's 999999 in the file, only the real usage records are read, in order.
    expect(seen.map((c) => c.tokens)).toEqual([4_321, 4_555])
    expect(seen.map((c) => c.at)).toEqual([Date.parse('2026-11-07T20:10:20.000Z'), Date.parse('2026-11-07T20:11:00.000Z')])
  })

  it('ignores records whose input tokens are missing or not a usable number', () => {
    const file = path.join(dir, 'tab-f.jsonl')
    write(
      file,
      record('18106', 272_000, 'not-a-number', '2026-11-07T20:12:00.000Z'),
      record(-5, 272_000, 'negative', '2026-11-07T20:12:10.000Z'),
      eventLine('session.usage_record', { usage: { model: 'no-tokens', maxPromptTokens: 272_000, cacheReadTokens: 10 } }, '2026-11-07T20:12:20.000Z'),
      record(4_321, 272_000, 'gpt-4.1-mini', '2026-11-07T20:12:30.000Z'),
    )
    const seen: ContextUsage[] = []
    const source = createCopilotUsageSource({ file, onContext: (c) => seen.push(c) })
    source.close()
    expect(seen).toEqual([{ tokens: 4_321, window: 272_000, percent: null, model: 'gpt-4.1-mini', at: Date.parse('2026-11-07T20:12:30.000Z') }])
  })

  it('waits for a partial last line to be completed before reading it', () => {
    const file = path.join(dir, 'tab-g.jsonl')
    // The newer record is on disk but torn: Copilot has not written its newline yet.
    fs.writeFileSync(file, record(600, 272_000, 'gpt-5-mini', '2026-11-07T20:39:00.000Z') + '\n' + record(700, 272_000, 'gpt-6-luna', '2026-11-07T20:40:00.000Z'))
    const seen: ContextUsage[] = []
    const source = createCopilotUsageSource({ file, onContext: (c) => seen.push(c) })
    expect(seen).toEqual([{ tokens: 600, window: 272_000, percent: null, model: 'gpt-5-mini', at: Date.parse('2026-11-07T20:39:00.000Z') }])
    fs.appendFileSync(file, '\n')
    source.drain()
    source.close()
    expect(seen).toEqual([
      { tokens: 600, window: 272_000, percent: null, model: 'gpt-5-mini', at: Date.parse('2026-11-07T20:39:00.000Z') },
      { tokens: 700, window: 272_000, percent: null, model: 'gpt-6-luna', at: Date.parse('2026-11-07T20:40:00.000Z') },
    ])
  })

  it('reads from the start again after the file is rewritten, and takes the newest record', () => {
    const file = path.join(dir, 'tab-h.jsonl')
    write(file, record(12_000, 272_000, 'gpt-5-mini', '2026-11-07T20:28:00.000Z'))
    const seen: ContextUsage[] = []
    const source = createCopilotUsageSource({ file, onContext: (c) => seen.push(c) })
    // The session's events file is rewritten (a fresh run), so the bytes before the old read position change.
    fs.writeFileSync(file, [record(500, 256_000, 'o4-mini', '2026-11-07T22:00:00.000Z'), record(8_800, 256_000, 'o4-mini', '2026-11-07T22:01:00.000Z')].join('\n') + '\n')
    source.drain()
    source.close()
    expect(seen).toEqual([
      { tokens: 12_000, window: 272_000, percent: null, model: 'gpt-5-mini', at: Date.parse('2026-11-07T20:28:00.000Z') },
      { tokens: 8_800, window: 256_000, percent: null, model: 'o4-mini', at: Date.parse('2026-11-07T22:01:00.000Z') },
    ])
  })

  it('reads a log bigger than the first-read cap from its last megabyte, and still replays the newest record', () => {
    const file = path.join(dir, 'tab-big.jsonl')
    // Megabytes of other events before the newest record: the start of the log is never read in full.
    const filler = eventLine('session.start', { sessionId: 'x'.repeat(4096) }, '2026-11-07T19:00:00.000Z')
    const lines = Array.from({ length: 600 }, () => filler)
    write(file, record(9_000, 272_000, 'gpt-5-mini', '2026-11-07T19:30:00.000Z'), ...lines, record(18_106, 272_000, 'gpt-6-luna', '2026-11-07T20:30:28.702Z'))
    expect(fs.statSync(file).size).toBeGreaterThan(1 << 20)
    const readSync = vi.spyOn(fs, 'readSync')
    const seen: ContextUsage[] = []
    const source = createCopilotUsageSource({ file, onContext: (c) => seen.push(c) })
    source.close()
    const bytes = readSync.mock.results.reduce((sum, result) => sum + (typeof result.value === 'number' ? result.value : 0), 0)
    readSync.mockRestore()
    expect(bytes).toBeLessThanOrEqual(1 << 20)
    expect(seen).toEqual([{ tokens: 18_106, window: 272_000, percent: null, model: 'gpt-6-luna', at: AT_A }])
  })

  it('reads only the appended bytes of a long log, not the whole file on every poll', () => {
    const file = path.join(dir, 'tab-j.jsonl')
    // A long session's log: many lines before the usage record, so re-reading the whole file each poll would be real cost.
    const pad = Array.from({ length: 40 }, (_, i) => eventLine('session.start', { sessionId: `pad-${i}` }, '2026-11-07T19:00:00.000Z'))
    write(file, ...pad, record(12_000, 272_000, 'gpt-5-mini', '2026-11-07T20:28:00.000Z'))
    const readWhole = vi.spyOn(fs, 'readFileSync')
    const seen: ContextUsage[] = []
    const source = createCopilotUsageSource({ file, onContext: (c) => seen.push(c) })
    readWhole.mockClear()
    // An appended record is picked up without re-reading the file from the start.
    fs.appendFileSync(file, record(9_900, 272_000, 'gpt-6-luna', '2026-11-07T20:35:00.000Z') + '\n')
    source.drain()
    source.close()
    readWhole.mockRestore()
    expect(readWhole).not.toHaveBeenCalled()
    expect(seen).toEqual([
      { tokens: 12_000, window: 272_000, percent: null, model: 'gpt-5-mini', at: Date.parse('2026-11-07T20:28:00.000Z') },
      { tokens: 9_900, window: 272_000, percent: null, model: 'gpt-6-luna', at: Date.parse('2026-11-07T20:35:00.000Z') },
    ])
  })

  it('keeps the last reading while the file is unreadable, and neither re-delivers nor re-stamps it when the file returns', () => {
    vi.useFakeTimers()
    const file = path.join(dir, 'tab-i.jsonl')
    write(file, record(18_106, 272_000, 'gpt-6-luna', '2026-11-07T20:30:28.702Z'))
    const seen: ContextUsage[] = []
    const source = createCopilotUsageSource({ file, onContext: (c) => seen.push(c) })
    expect(seen).toHaveLength(1)
    fs.rmSync(file)
    source.drain()
    vi.advanceTimersByTime(POLL_MS)
    // Gone: not even a rewritten or clock-stamped reading arrives while the file is missing.
    expect(seen).toHaveLength(1)
    // The file comes back with the old record, then a new one arrives.
    write(file, record(18_106, 272_000, 'gpt-6-luna', '2026-11-07T20:30:28.702Z'))
    source.drain()
    // Unchanged readings are not delivered again (as in the Claude source).
    expect(seen).toHaveLength(1)
    fs.appendFileSync(file, record(9_900, 272_000, 'gpt-6-luna', '2026-11-07T20:35:00.000Z') + '\n')
    source.drain()
    source.close()
    expect(seen).toEqual([
      { tokens: 18_106, window: 272_000, percent: null, model: 'gpt-6-luna', at: AT_A },
      { tokens: 9_900, window: 272_000, percent: null, model: 'gpt-6-luna', at: Date.parse('2026-11-07T20:35:00.000Z') },
    ])
  })
})
