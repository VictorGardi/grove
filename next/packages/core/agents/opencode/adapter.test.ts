import { describe, expect, it, vi } from 'vitest'
import type { AdapterWatchInput } from '../../status/adapter.ts'
import type { StatusEvent } from '../../status/contract.ts'
import { createOpenCodeAdapter, mintSessionId } from './adapter.ts'
import type { OpenCodeHub } from './hub.ts'

// Port of src/core/opencodeId.test.ts.
const T = 1776959130999 // time_created of ses_244fb7288ffe7YEch15CUa2BbN on this machine

describe('mintSessionId', () => {
  it('matches the time prefix of a real OpenCode id', () => {
    expect(mintSessionId(T).slice(0, 16)).toBe('ses_244fb7288ffe')
  })

  it('has the OpenCode shape', () => {
    const id = mintSessionId(T)
    expect(id).toMatch(/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/)
    expect(id).toHaveLength(30)
  })

  it('sorts newer ids first', () => {
    expect(mintSessionId(T + 1000) < mintSessionId(T)).toBe(true)
  })

  it('differs in the random part at the same time', () => {
    expect(mintSessionId(T)).not.toBe(mintSessionId(T))
  })
})

// A hub stand-in: records each watch and what it was closed with, so no connection is opened.
function fakeHub() {
  const watches: { sessionId: string; clock: () => number; onEvent: (e: StatusEvent, at: number) => void; closed: boolean }[] = []
  const hub: OpenCodeHub = {
    watch: (w) => {
      const rec = { ...w, closed: false }
      watches.push(rec)
      return () => {
        rec.closed = true
      }
    },
    stop: () => {},
  }
  return { hub, watches }
}

describe('createOpenCodeAdapter', () => {
  it('is the opencode kind', () => {
    expect(createOpenCodeAdapter({ hub: fakeHub().hub }).kind).toBe('opencode')
  })

  it('mints a ses_ id and runs opencode -s with it, for start', () => {
    const adapter = createOpenCodeAdapter({ hub: fakeHub().hub })
    const launch = adapter.launch({ tabId: 't1', cwd: '/w', home: '/h' })
    expect(launch.sessionId).toMatch(/^ses_/)
    expect(launch).toEqual({ command: 'opencode', args: ['-s', launch.sessionId], env: {}, sessionId: launch.sessionId })
  })

  it('resumes the same session with the same argv', () => {
    const adapter = createOpenCodeAdapter({ hub: fakeHub().hub })
    const launch = adapter.launch({ tabId: 't1', cwd: '/w', home: '/h', resumeId: 'ses_244fb7288ffe7YEch15CUa2BbN' })
    expect(launch.args).toEqual(['-s', 'ses_244fb7288ffe7YEch15CUa2BbN'])
    expect(launch.sessionId).toBe('ses_244fb7288ffe7YEch15CUa2BbN')
  })

  it.each(['', 'abc', 'ses_', 'ses_ a', 'ses_a;rm', '244fb7288ffe'])('refuses the resume id %j', (bad) => {
    const adapter = createOpenCodeAdapter({ hub: fakeHub().hub })
    expect(() => adapter.launch({ tabId: 't1', cwd: '/w', home: '/h', resumeId: bad })).toThrow(/not an OpenCode session id/)
  })

  it('watches the session through the hub and closes its own watch only', () => {
    const { hub, watches } = fakeHub()
    const adapter = createOpenCodeAdapter({ hub })
    const clock = () => 42
    const seen: StatusEvent[] = []
    const input: AdapterWatchInput = { tabId: 't1', sessionId: 'ses_a', home: '/h', clock, onEvent: (e) => seen.push(e) }
    const a = adapter.watch(input)
    const b = adapter.watch({ ...input, sessionId: 'ses_b' })
    expect(watches.map((w) => w.sessionId)).toEqual(['ses_a', 'ses_b'])
    expect(watches[0].clock).toBe(clock)
    watches[0].onEvent({ kind: 'working' }, 42)
    expect(seen).toEqual([{ kind: 'working' }])
    a.close()
    expect(watches.map((w) => w.closed)).toEqual([true, false])
    b.close()
  })

  it('asks the login shell for opencode once a positive probe is kept', async () => {
    const onPath = vi.fn<() => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValue(true)
    const adapter = createOpenCodeAdapter({ hub: fakeHub().hub, onPath })
    expect(await adapter.available?.()).toBe(false)
    expect(await adapter.available?.()).toBe(true)
    expect(await adapter.available?.()).toBe(true)
    expect(onPath).toHaveBeenCalledTimes(2)
  })
})
