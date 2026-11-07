import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StatusEvent } from '../../status/contract.ts'
import { createClaudeSource, eventsFor, POLL_MS, replaySpool, type SpoolRecord } from './source.ts'

const record = (event: string, payload: unknown = null, at = 1000): string => JSON.stringify({ event, at, payload }) + '\n'
const id = (n: number) => `0d1c2b3a-4f5e-4a6b-8c7d-9e0f1a2b3c${String(n).padStart(2, '0')}`
const start = (n: number, at = 1000): string => record('SessionStart', { session_id: id(n) }, at)
const session = (n: number): StatusEvent => ({ kind: 'session', resumeId: id(n) })

describe('createClaudeSource', () => {
  let dir: string
  let spool: string
  let offsetFile: string
  let now: number
  const sources: Array<{ close: () => void }> = []

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-claude-source-'))
    spool = path.join(dir, 'agents', 'tab.jsonl')
    offsetFile = path.join(dir, 'agents', 'tab.offset')
    fs.mkdirSync(path.dirname(spool), { recursive: true })
    now = 5000
  })

  afterEach(() => {
    for (const source of sources.splice(0)) source.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  function open(onEvent: (event: StatusEvent, at: number) => void = () => {}) {
    const source = createClaudeSource({ spoolFile: spool, offsetFile, clock: () => now, onEvent })
    sources.push(source)
    return source
  }

  it('delivers session events in order, each with its own time, and nothing for other hooks', () => {
    fs.writeFileSync(spool, start(1, 1) + record('UserPromptSubmit', null, 2) + record('Stop', null, 3) + start(2, 4))
    const seen: Array<[StatusEvent, number]> = []
    open((event, at) => seen.push([event, at]))
    expect(seen).toEqual([[session(1), 1], [session(2), 4]])
  })

  it('reports nothing from the poll while the spool is quiet', () => {
    vi.useFakeTimers()
    try {
      const seen: StatusEvent[] = []
      open((event) => seen.push(event))
      vi.advanceTimersByTime(POLL_MS * 5)
      expect(seen).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('does nothing and starts clean when the spool does not exist yet', () => {
    const seen: StatusEvent[] = []
    const source = open((event) => seen.push(event))
    expect(seen).toEqual([])
    expect(source.corruptLines()).toBe(0)
    fs.writeFileSync(spool, start(1))
    source.drain()
    expect(seen).toEqual([session(1)])
  })

  it('resumes from the saved offset and does not redeliver old events', () => {
    fs.writeFileSync(spool, start(1, 1) + start(2, 2))
    const first = open()
    first.close()
    sources.pop()
    expect(JSON.parse(fs.readFileSync(offsetFile, 'utf8'))).toEqual({ offset: fs.statSync(spool).size })

    fs.appendFileSync(spool, start(3, 3))
    const seen: StatusEvent[] = []
    open((event) => seen.push(event))
    expect(seen).toEqual([session(3)])
  })

  it('skips and counts a corrupt line, and keeps reading after it', () => {
    fs.writeFileSync(spool, start(1, 1) + '{not json\n' + start(2, 2) + '[1,2]\n')
    const seen: StatusEvent[] = []
    const source = open((event) => seen.push(event))
    expect(source.corruptLines()).toBe(2)
    expect(seen).toEqual([session(1), session(2)])
  })

  it('waits for the newline before reading a partly written line', () => {
    const line = start(2, 2)
    fs.writeFileSync(spool, start(1, 1) + line.slice(0, 10))
    const seen: StatusEvent[] = []
    const source = open((event) => seen.push(event))
    expect(seen).toEqual([session(1)])
    expect(source.corruptLines()).toBe(0)

    fs.appendFileSync(spool, line.slice(10))
    source.drain()
    expect(seen).toEqual([session(1), session(2)])
  })

  it('replays rather than skips when delivery fails part way, and does not throw out of the source', () => {
    fs.writeFileSync(spool, start(1, 1) + start(2, 2))
    let calls = 0
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const failing = open(() => {
        calls += 1
        if (calls === 2) throw new Error('crash')
      })
      expect(errors).toHaveBeenCalledOnce()
      expect(fs.existsSync(offsetFile)).toBe(false)
    } finally {
      errors.mockRestore()
    }

    const seen: StatusEvent[] = []
    open((event) => seen.push(event))
    expect(seen).toEqual([session(1), session(2)])
  })

  it('does not throw when the offset save fails, and later events are still delivered', () => {
    fs.writeFileSync(spool, start(1, 1))
    // A directory where the offset file should be makes the save fail on every drain.
    fs.mkdirSync(offsetFile, { recursive: true })
    const seen: StatusEvent[] = []
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const source = open((event) => seen.push(event))
      expect(seen).toEqual([session(1)])
      fs.appendFileSync(spool, start(2, 2))
      expect(() => source.drain()).not.toThrow()
      expect(seen).toEqual([session(1), session(2)])
      expect(errors).toHaveBeenCalled()
    } finally {
      errors.mockRestore()
    }
  })

  it('keeps the poll running when a tick cannot read the spool', () => {
    vi.useFakeTimers()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const seen: StatusEvent[] = []
      const source = open((event) => seen.push(event))
      fs.writeFileSync(spool, start(2, 2))
      fs.rmSync(spool)
      fs.mkdirSync(spool)
      vi.advanceTimersByTime(POLL_MS)
      expect(seen).toEqual([])
      fs.rmSync(spool, { recursive: true })
      fs.writeFileSync(spool, start(3, 3))
      vi.advanceTimersByTime(POLL_MS)
      expect(seen).toEqual([session(3)])
      source.close()
    } finally {
      errors.mockRestore()
      vi.useRealTimers()
    }
  })

  it('reads from the start when the spool was replaced by a shorter file', () => {
    fs.writeFileSync(offsetFile, JSON.stringify({ offset: 9999 }))
    fs.writeFileSync(spool, start(1, 1))
    const seen: StatusEvent[] = []
    open((event) => seen.push(event))
    expect(seen).toEqual([session(1)])
  })

  it('treats an unreadable offset file as offset zero', () => {
    fs.writeFileSync(offsetFile, 'garbage')
    fs.writeFileSync(spool, start(1, 1))
    const seen: StatusEvent[] = []
    open((event) => seen.push(event))
    expect(seen).toEqual([session(1)])
  })

  it('stamps a record without a time with the clock', () => {
    now = 7777
    fs.writeFileSync(spool, JSON.stringify({ event: 'SessionStart', payload: { session_id: id(1) } }) + '\n')
    const seen: Array<[StatusEvent, number]> = []
    open((event, at) => seen.push([event, at]))
    expect(seen[0]).toEqual([session(1), 7777])
  })
})

describe('eventsFor', () => {
  const rec = (event: string, payload: unknown = null): SpoolRecord => ({ event, at: 1, payload })

  it.each(['UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'Notification', 'Stop', 'StopFailure', 'SessionEnd', 'SubagentStop', 'CwdChanged'])(
    'ignores %s: status is not read from hooks',
    (event) => {
      expect(eventsFor(rec(event, { session_id: id(1), notification_type: 'permission_prompt' }))).toEqual([])
    }
  )

  it('maps SessionStart to the resume id, and nothing without one', () => {
    expect(eventsFor(rec('SessionStart', { session_id: id(1) }))).toEqual([session(1)])
    expect(eventsFor(rec('SessionStart', {}))).toEqual([])
  })

  it('ignores a SessionStart id that is not a UUID, so it can never become a flag', () => {
    expect(eventsFor(rec('SessionStart', { session_id: '--dangerously-skip-permissions' }))).toEqual([])
    expect(eventsFor(rec('SessionStart', { session_id: 'sess-2' }))).toEqual([])
  })
})

describe('replaySpool', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-claude-replay-spool-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('returns the events, the offset past the last line and the corrupt count, without keeping state', () => {
    const spool = path.join(dir, 'tab.jsonl')
    const body = start(1, 4) + 'junk\n'
    fs.writeFileSync(spool, body)
    const result = replaySpool(spool, 0)
    expect(result.offset).toBe(Buffer.byteLength(body))
    expect(result.corrupt).toBe(1)
    expect(result.events.map((e) => e.event)).toEqual([session(1)])
    expect(replaySpool(spool, result.offset).events).toEqual([])
  })
})
