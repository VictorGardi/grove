import { describe, expect, it, vi } from 'vitest'
import { createOpenCodeAdapter, mintSessionId, OPENCODE_CHROME } from './adapter.ts'

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

describe('createOpenCodeAdapter', () => {
  it('is the opencode kind', () => {
    expect(createOpenCodeAdapter().kind).toBe('opencode')
  })

  it('mints a ses_ id and runs opencode -s with it, for start', () => {
    const adapter = createOpenCodeAdapter()
    const launch = adapter.launch({ tabId: 't1', cwd: '/w', home: '/h' })
    expect(launch.sessionId).toMatch(/^ses_/)
    expect(launch).toEqual({ command: 'opencode', args: ['-s', launch.sessionId], env: { OPENCODE_CLI_CONFIG_CONTENT: OPENCODE_CHROME }, sessionId: launch.sessionId })
  })

  it('resumes the same session with the same argv', () => {
    const adapter = createOpenCodeAdapter()
    const launch = adapter.launch({ tabId: 't1', cwd: '/w', home: '/h', resumeId: 'ses_244fb7288ffe7YEch15CUa2BbN' })
    expect(launch.args).toEqual(['-s', 'ses_244fb7288ffe7YEch15CUa2BbN'])
    expect(launch.sessionId).toBe('ses_244fb7288ffe7YEch15CUa2BbN')
  })

  it.each(['', 'abc', 'ses_', 'ses_ a', 'ses_a;rm', '244fb7288ffe'])('refuses the resume id %j', (bad) => {
    const adapter = createOpenCodeAdapter()
    expect(() => adapter.launch({ tabId: 't1', cwd: '/w', home: '/h', resumeId: bad })).toThrow(/not an OpenCode session id/)
  })

  it('watches nothing: status comes from the holder', () => {
    const watch = createOpenCodeAdapter().watch({ tabId: 't1', sessionId: 'ses_a', home: '/h', clock: () => 42, onEvent: () => {} })
    expect(() => watch.close()).not.toThrow()
  })

  it('asks the login shell for opencode once a positive probe is kept', async () => {
    const onPath = vi.fn<() => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValue(true)
    const adapter = createOpenCodeAdapter({ onPath })
    expect(await adapter.available?.()).toBe(false)
    expect(await adapter.available?.()).toBe(true)
    expect(await adapter.available?.()).toBe(true)
    expect(onPath).toHaveBeenCalledTimes(2)
  })
})
