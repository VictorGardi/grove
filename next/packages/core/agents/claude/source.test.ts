import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StatusEvent } from '../../status/contract.ts'
import { createClaudeSource, eventsFor, POLL_MS, replaySpool, type SpoolRecord } from './source.ts'

const record = (event: string, payload: unknown = null, at = 1000): string => JSON.stringify({ event, at, payload }) + '\n'

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

  it('delivers mapped events in order, each with its own time', () => {
    fs.writeFileSync(spool, record('UserPromptSubmit', null, 1) + record('PermissionRequest', null, 2) + record('Stop', null, 3))
    const seen: Array<[StatusEvent, number]> = []
    open((event, at) => seen.push([event, at]))
    expect(seen).toEqual([
      [{ kind: 'working' }, 1],
      [{ kind: 'needs-you', reason: 'permission' }, 2],
      [{ kind: 'finished' }, 3],
    ])
  })

  it('does not report a heartbeat for hook records, only from the poll after a drain that worked', () => {
    vi.useFakeTimers()
    try {
      fs.writeFileSync(spool, record('Stop', null, 1))
      const seen: StatusEvent[] = []
      open((event) => seen.push(event))
      expect(seen).toEqual([{ kind: 'finished' }])
      expect(seen).not.toContainEqual({ kind: 'heartbeat' })

      vi.advanceTimersByTime(POLL_MS)
      expect(seen).toEqual([{ kind: 'finished' }, { kind: 'heartbeat' }])
      vi.advanceTimersByTime(POLL_MS * 2)
      expect(seen.filter((event) => event.kind === 'heartbeat')).toHaveLength(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps reporting a heartbeat while the spool is quiet', () => {
    vi.useFakeTimers()
    try {
      const seen: StatusEvent[] = []
      open((event) => seen.push(event))
      vi.advanceTimersByTime(POLL_MS * 5)
      expect(seen).toEqual(Array(5).fill({ kind: 'heartbeat' }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('does nothing and starts clean when the spool does not exist yet', () => {
    const seen: StatusEvent[] = []
    const source = open((event) => seen.push(event))
    expect(seen).toEqual([])
    expect(source.corruptLines()).toBe(0)
    fs.writeFileSync(spool, record('Stop'))
    source.drain()
    expect(seen).toEqual([{ kind: 'finished' }])
  })

  it('resumes from the saved offset and does not redeliver old events', () => {
    fs.writeFileSync(spool, record('UserPromptSubmit', null, 1) + record('Stop', null, 2))
    const first = open()
    first.close()
    sources.pop()
    expect(JSON.parse(fs.readFileSync(offsetFile, 'utf8'))).toEqual({ offset: fs.statSync(spool).size })

    fs.appendFileSync(spool, record('PreToolUse', null, 3))
    const seen: StatusEvent[] = []
    open((event) => seen.push(event))
    expect(seen).toEqual([{ kind: 'working' }])
  })

  it('skips and counts a corrupt line, and keeps reading after it', () => {
    fs.writeFileSync(spool, record('UserPromptSubmit', null, 1) + '{not json\n' + record('Stop', null, 2) + '[1,2]\n')
    const seen: StatusEvent[] = []
    const source = open((event) => seen.push(event))
    expect(source.corruptLines()).toBe(2)
    expect(seen).toEqual([{ kind: 'working' }, { kind: 'finished' }])
  })

  it('waits for the newline before reading a partly written line', () => {
    const line = record('Stop', null, 2)
    fs.writeFileSync(spool, record('UserPromptSubmit', null, 1) + line.slice(0, 10))
    const seen: StatusEvent[] = []
    const source = open((event) => seen.push(event))
    expect(seen).toEqual([{ kind: 'working' }])
    expect(source.corruptLines()).toBe(0)

    fs.appendFileSync(spool, line.slice(10))
    source.drain()
    expect(seen).toEqual([{ kind: 'working' }, { kind: 'finished' }])
  })

  it('replays rather than skips when delivery fails part way, and does not throw out of the source', () => {
    fs.writeFileSync(spool, record('UserPromptSubmit', null, 1) + record('Stop', null, 2))
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
    expect(seen).toEqual([{ kind: 'working' }, { kind: 'finished' }])
  })

  it('does not throw when the offset save fails, and later events are still delivered', () => {
    fs.writeFileSync(spool, record('UserPromptSubmit', null, 1))
    // A directory where the offset file should be makes the save fail on every drain.
    fs.mkdirSync(offsetFile, { recursive: true })
    const seen: StatusEvent[] = []
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const source = open((event) => seen.push(event))
      expect(seen).toEqual([{ kind: 'working' }])
      fs.appendFileSync(spool, record('Stop', null, 2))
      expect(() => source.drain()).not.toThrow()
      expect(seen).toEqual([{ kind: 'working' }, { kind: 'finished' }])
      expect(errors).toHaveBeenCalled()
    } finally {
      errors.mockRestore()
    }
  })

  it('keeps the poll running when a tick cannot read the spool, and does not heartbeat that tick', () => {
    vi.useFakeTimers()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const seen: StatusEvent[] = []
      const source = open((event) => seen.push(event))
      fs.writeFileSync(spool, record('Stop', null, 2))
      fs.rmSync(spool)
      fs.mkdirSync(spool)
      vi.advanceTimersByTime(POLL_MS)
      expect(seen).toEqual([])
      fs.rmSync(spool, { recursive: true })
      fs.writeFileSync(spool, record('Stop', null, 3))
      vi.advanceTimersByTime(POLL_MS)
      expect(seen).toEqual([{ kind: 'finished' }, { kind: 'heartbeat' }])
      source.close()
    } finally {
      errors.mockRestore()
      vi.useRealTimers()
    }
  })

  it('reads from the start when the spool was replaced by a shorter file', () => {
    fs.writeFileSync(offsetFile, JSON.stringify({ offset: 9999 }))
    fs.writeFileSync(spool, record('SessionEnd', null, 1))
    const seen: StatusEvent[] = []
    open((event) => seen.push(event))
    expect(seen).toEqual([{ kind: 'idle' }])
  })

  it('treats an unreadable offset file as offset zero', () => {
    fs.writeFileSync(offsetFile, 'garbage')
    fs.writeFileSync(spool, record('Stop', null, 1))
    const seen: StatusEvent[] = []
    open((event) => seen.push(event))
    expect(seen).toEqual([{ kind: 'finished' }])
  })

  it('stamps a record without a time with the clock', () => {
    now = 7777
    fs.writeFileSync(spool, JSON.stringify({ event: 'Stop', payload: null }) + '\n')
    const seen: Array<[StatusEvent, number]> = []
    open((event, at) => seen.push([event, at]))
    expect(seen[0]).toEqual([{ kind: 'finished' }, 7777])
  })
})

describe('eventsFor', () => {
  const rec = (event: string, payload: unknown = null): SpoolRecord => ({ event, at: 1, payload })

  it.each([
    ['UserPromptSubmit', [{ kind: 'working' }]],
    ['PreToolUse', [{ kind: 'working' }]],
    ['PostToolUse', [{ kind: 'working' }]],
    ['PostToolUseFailure', [{ kind: 'working' }]],
    ['SubagentStart', [{ kind: 'working' }]],
    ['PermissionRequest', [{ kind: 'needs-you', reason: 'permission' }]],
    ['StopFailure', [{ kind: 'needs-you', reason: 'error' }]],
    ['Stop', [{ kind: 'finished' }]],
    ['SessionEnd', [{ kind: 'idle' }]],
    ['SubagentStop', []],
    ['CwdChanged', []],
  ])('maps %s', (event, expected) => {
    expect(eventsFor(rec(event))).toEqual(expected)
  })

  it('maps Notification by notification_type', () => {
    expect(eventsFor(rec('Notification', { notification_type: 'permission_prompt' }))).toEqual([{ kind: 'needs-you', reason: 'permission' }])
    expect(eventsFor(rec('Notification', { notification_type: 'elicitation_dialog' }))).toEqual([{ kind: 'needs-you', reason: 'question' }])
    expect(eventsFor(rec('Notification'))).toEqual([])
  })

  it('maps idle_prompt to idle-prompt, and another Notification type to nothing', () => {
    expect(eventsFor(rec('Notification', { notification_type: 'idle_prompt' }))).toEqual([{ kind: 'idle-prompt' }])
    expect(eventsFor(rec('Notification', { notification_type: 'auth_success' }))).toEqual([])
  })

  it("ignores a subagent's Stop or StopFailure, but not one from 'main', as the old Grove does", () => {
    expect(eventsFor(rec('Stop', { agent_id: 'a1' }))).toEqual([])
    expect(eventsFor(rec('StopFailure', { agent_id: 'a1' }))).toEqual([])
    expect(eventsFor(rec('Stop', { agent_id: 'main' }))).toEqual([{ kind: 'finished' }])
    expect(eventsFor(rec('StopFailure', { agent_id: 'main' }))).toEqual([{ kind: 'needs-you', reason: 'error' }])
  })

  it('maps PreToolUse of AskUserQuestion to a question, and any other tool to working', () => {
    expect(eventsFor(rec('PreToolUse', { tool_name: 'AskUserQuestion' }))).toEqual([{ kind: 'needs-you', reason: 'question' }])
    expect(eventsFor(rec('PreToolUse', { tool_name: 'Bash' }))).toEqual([{ kind: 'working' }])
  })

  it('ignores PermissionRequest for AskUserQuestion, and maps any other tool to a permission', () => {
    expect(eventsFor(rec('PermissionRequest', { tool_name: 'AskUserQuestion' }))).toEqual([])
    expect(eventsFor(rec('PermissionRequest', { tool_name: 'Bash' }))).toEqual([{ kind: 'needs-you', reason: 'permission' }])
  })

  it('maps SessionStart to the resume id, and nothing without one', () => {
    const id = '0d1c2b3a-4f5e-4a6b-8c7d-9e0f1a2b3c4d'
    expect(eventsFor(rec('SessionStart', { session_id: id }))).toEqual([{ kind: 'session', resumeId: id }])
    expect(eventsFor(rec('SessionStart', {}))).toEqual([])
  })

  it('ignores a SessionStart id that is not a UUID, so it can never become a flag', () => {
    expect(eventsFor(rec('SessionStart', { session_id: '--dangerously-skip-permissions' }))).toEqual([])
    expect(eventsFor(rec('SessionStart', { session_id: 'sess-2' }))).toEqual([])
  })

  it('gives working for a PreToolUse with no prompt before it (a turn woken by a background task)', () => {
    expect(eventsFor(rec('PreToolUse', { tool_name: 'Bash' }))).toEqual([{ kind: 'working' }])
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
    const body = record('Stop', null, 4) + 'junk\n'
    fs.writeFileSync(spool, body)
    const result = replaySpool(spool, 0)
    expect(result.offset).toBe(Buffer.byteLength(body))
    expect(result.corrupt).toBe(1)
    expect(result.events.map((e) => e.event)).toEqual([{ kind: 'finished' }])
    expect(replaySpool(spool, result.offset).events).toEqual([])
  })

  it('counts bytes, not characters, for multi-byte text', () => {
    const spool = path.join(dir, 'tab.jsonl')
    fs.writeFileSync(spool, record('UserPromptSubmit', { prompt: 'héllo ❯' }, 1))
    const result = replaySpool(spool, 0)
    expect(result.offset).toBe(fs.statSync(spool).size)
    expect(result.events[0].event).toEqual({ kind: 'working' })
  })
})
