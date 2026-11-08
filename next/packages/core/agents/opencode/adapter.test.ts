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

  it('watches nothing when there is no onContext: status comes from the holder', () => {
    const usageFetch = vi.fn<(path: string) => Promise<unknown>>()
    const watch = createOpenCodeAdapter({ usageFetch }).watch({
      tabId: 't1',
      sessionId: 'ses_a',
      home: '/h',
      clock: () => 42,
      onEvent: () => {},
    })
    expect(() => watch.close()).not.toThrow()
    expect(usageFetch).not.toHaveBeenCalled()
  })

  it('watches nothing while the tab has no session id yet', () => {
    const usageFetch = vi.fn<(path: string) => Promise<unknown>>()
    const onContext = vi.fn()
    const watch = createOpenCodeAdapter({ usageFetch, usageIntervalMs: 5 }).watch({
      tabId: 't1',
      sessionId: '',
      home: '/h',
      clock: () => 42,
      onEvent: () => {},
      onContext,
    })
    expect(() => watch.close()).not.toThrow()
    expect(usageFetch).not.toHaveBeenCalled()
    expect(onContext).not.toHaveBeenCalled()
  })

  it('polls the exact session and delivers its last-request reading to the tab', async () => {
    const onContext = vi.fn()
    const paths: string[] = []
    const context = [
      {
        id: 'msg_1',
        type: 'assistant',
        time: { created: 10, completed: 2_000 },
        tokens: { input: 10, output: 99, cache: { read: 20, write: 0 } },
        model: { providerID: 'p', id: 'm1' },
      },
    ]
    const adapter = createOpenCodeAdapter({
      usageIntervalMs: 5,
      usageFetch: async (apiPath) => {
        paths.push(apiPath)
        if (apiPath === `/api/session/ses_x/context`) return context
        if (apiPath === '/api/model') return [{ id: 'm1', modelID: 'm1', providerID: 'p', limit: { context: 100_000 } }]
        throw new Error(`unexpected path ${apiPath}`)
      },
    })
    const watch = adapter.watch({ tabId: 't1', sessionId: 'ses_x', home: '/h', clock: () => 42, onEvent: () => {}, onContext })
    // Input and cache counts only; `output` is generated, never context; the window is the catalog's model limit.
    await vi.waitFor(() => expect(onContext).toHaveBeenCalledWith({ tokens: 30, window: 100_000, percent: null, model: 'm1', at: 2_000 }))
    watch.close()
    expect(paths).toContain('/api/session/ses_x/context')
    // Another tab's session never arrives through this fetch.
    expect(paths).not.toContain('/api/session/ses_other/context')
  })

  it('clears a refused reading instead of leaving stale numbers', async () => {
    const onContext = vi.fn()
    let context: unknown = [
      {
        id: 'msg_1',
        type: 'assistant',
        time: { created: 10, completed: 2_000 },
        tokens: { input: 10, cache: { read: 20, write: 0 } },
        model: { providerID: 'p', id: 'm1' },
      },
    ]
    const adapter = createOpenCodeAdapter({
      usageIntervalMs: 5,
      usageFetch: async (apiPath) => {
        if (!apiPath.startsWith('/api/session/')) return [{ id: 'm1', providerID: 'p', limit: { context: 100_000 } }]
        return context
      },
    })
    const watch = adapter.watch({ tabId: 't1', sessionId: 'ses_x', home: '/h', clock: () => 42, onEvent: () => {}, onContext })
    await vi.waitFor(() => expect(onContext).toHaveBeenCalledTimes(1))
    // A newer request still in flight keeps the last completed reading on screen: nothing is delivered for it.
    context = [{ id: 'msg_2', type: 'assistant', time: { created: 3_000 } }]
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(onContext).toHaveBeenCalledTimes(1)
    // A newer completed request on a model the catalog does not list clears the row.
    context = [{ id: 'msg_3', type: 'assistant', time: { created: 4_000, completed: 4_500 }, tokens: { input: 1, cache: { read: 0, write: 0 } }, model: { providerID: 'p', id: 'gone' } }]
    await vi.waitFor(() => expect(onContext).toHaveBeenCalledTimes(2))
    expect(onContext).toHaveBeenLastCalledWith({ tokens: null, window: null, percent: null, model: null, at: 42 })
    watch.close()
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
