import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContextUsage } from '../../../protocol/messages.ts'
import { StatusService } from '../../status/service.ts'
import { createClaudeAdapter } from './adapter.ts'
import { CLAUDE_STATUSLINE_SCRIPT, claudeLaunch, claudeUsageFile } from './launch.ts'
import { contextFromStatusLine, createClaudeUsageSource, readUsageFile } from './usage.ts'

const input = (total: number | null, size: number, usage: Record<string, number> | null = { input_tokens: total ?? 0 }) => ({
  session_id: 's',
  model: 'claude-x',
  context_window: { total_input_tokens: total, context_window_size: size, used_percentage: 12, current_usage: usage },
})

describe('contextFromStatusLine', () => {
  it('reads the input-side tokens, the window and the percentage from the input', () => {
    expect(contextFromStatusLine(input(45000, 200000), 7)).toEqual({ tokens: 45000, window: 200000, percent: 12, model: 'claude-x', at: 7 })
  })

  it('uses the current_usage sum, not the cumulative total', () => {
    expect(contextFromStatusLine(input(900000, 200000, { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 5 }), 1)?.tokens).toBe(35)
  })

  it('sums the current usage when no total is reported', () => {
    const usage = { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 5 }
    expect(contextFromStatusLine(input(null, 1000000, usage), 1)?.tokens).toBe(35)
  })

  it('is null, not zero, before the first API request and after a compaction', () => {
    // Claude sends current_usage null then, even when it still reports a total of 0 or the old total.
    expect(contextFromStatusLine(input(0, 200000, null), 1)).toMatchObject({ tokens: null, percent: null, window: 200000 })
    expect(contextFromStatusLine(input(45000, 200000, null), 1)?.tokens).toBeNull()
    expect(contextFromStatusLine(input(0, 200000), 1)?.tokens).toBeNull()
  })

  it('is no reading for something that is not an object', () => {
    expect(contextFromStatusLine(null, 1)).toBeNull()
    expect(contextFromStatusLine('x', 1)).toBeNull()
  })
})

describe('statusline.mjs and the Claude usage path', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-claude-usage-'))
  })

  afterEach(() => {
    vi.useRealTimers()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  function runStatusLine(stdin: string, env: Record<string, string>) {
    return spawnSync(process.execPath, [CLAUDE_STATUSLINE_SCRIPT], {
      input: stdin,
      encoding: 'utf8',
      env: { ...process.env, GROVE_USAGE: '', ...env },
    })
  }

  it('writes the latest reading to the usage file and chains the user status line', () => {
    const config = path.join(dir, 'claude')
    fs.mkdirSync(config)
    fs.writeFileSync(path.join(config, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'cat | tr a-z A-Z' } }))
    const usage = path.join(dir, 'a', 'tab.usage.json')
    const result = runStatusLine(JSON.stringify(input(50, 100)), { GROVE_USAGE: usage, CLAUDE_CONFIG_DIR: config })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('SESSION_ID')
    expect(readUsageFile(usage)).toMatchObject({ tokens: 50, window: 100 })
    runStatusLine(JSON.stringify(input(60, 100)), { GROVE_USAGE: usage, CLAUDE_CONFIG_DIR: config })
    expect(readUsageFile(usage)?.tokens).toBe(60)
  })

  it('chains the project status line over the user one, as Claude would', () => {
    const config = path.join(dir, 'claude')
    fs.mkdirSync(config)
    fs.writeFileSync(path.join(config, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'echo USER' } }))
    const project = path.join(dir, 'project')
    fs.mkdirSync(path.join(project, '.claude'), { recursive: true })
    fs.writeFileSync(path.join(project, '.claude', 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'echo PROJECT' } }))
    const usage = path.join(dir, 'p', 'tab.usage.json')
    const result = runStatusLine(JSON.stringify({ ...input(50, 100), workspace: { project_dir: project } }), {
      GROVE_USAGE: usage,
      CLAUDE_CONFIG_DIR: config,
    })
    expect(result.stdout).toContain('PROJECT')
    expect(result.stdout).not.toContain('USER')
  })

  it('writes the usage file from the tab env when no usage path is given', () => {
    const groveHome = path.join(dir, 'grove-home')
    const result = runStatusLine(JSON.stringify(input(50, 100)), {
      GROVE_USAGE: '',
      GROVE_HOME: groveHome,
      GROVE_TAB: 'tab-7',
      CLAUDE_CONFIG_DIR: dir,
    })
    expect(result.status).toBe(0)
    expect(readUsageFile(claudeUsageFile(groveHome, 'tab-7'))).toMatchObject({ tokens: 50, window: 100 })
  })

  it('exits 0 and prints nothing without a user command or on bad input', () => {
    const usage = path.join(dir, 'tab.usage.json')
    const result = runStatusLine('not json', { GROVE_USAGE: usage, CLAUDE_CONFIG_DIR: dir })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(fs.existsSync(usage)).toBe(false)
  })

  it('launches with the status line even when the user already has Grove hooks', () => {
    const launch = claudeLaunch({ tabId: 't', cwd: dir, home: dir, perLaunchHooks: false })
    const settings = JSON.parse(launch.args[launch.args.indexOf('--settings') + 1]) as Record<string, unknown>
    expect(Object.keys(settings)).toEqual(['statusLine'])
    expect(claudeUsageFile(dir, 't')).toBe(path.join(dir, 'agents', 'claude', 't.usage.json'))
  })

  it('delivers a changed reading, including a null one after a compaction, once each', () => {
    vi.useFakeTimers()
    const usage = path.join(dir, 'tab.usage.json')
    const seen: ContextUsage[] = []
    const write = (total: number | null, usageField: Record<string, number> | null, at: number) =>
      fs.writeFileSync(usage, JSON.stringify({ at, payload: input(total, 200, usageField) }))
    write(20, { input_tokens: 20 }, 1)
    const source = createClaudeUsageSource({ usageFile: usage, onContext: (c) => seen.push(c) })
    source.drain()
    write(null, null, 2)
    vi.advanceTimersByTime(1000)
    vi.advanceTimersByTime(1000)
    source.close()
    expect(seen.map((c) => c.tokens)).toEqual([20, null])
  })

  it('does not deliver a refresh of the same reading again, whatever its write time', () => {
    vi.useFakeTimers()
    const usage = path.join(dir, 'refresh.usage.json')
    const seen: ContextUsage[] = []
    const write = (at: number) => fs.writeFileSync(usage, JSON.stringify({ at, payload: input(20, 200, { input_tokens: 20 }) }))
    write(1)
    const source = createClaudeUsageSource({ usageFile: usage, onContext: (c) => seen.push(c) })
    source.drain()
    write(2)
    source.drain()
    write(3)
    source.drain()
    source.close()
    expect(seen).toHaveLength(1)
  })

  it('keeps two sessions apart through the service, each with its own window and null readings', () => {
    const home = dir
    const put = (tab: string, total: number | null, size: number, usageField: Record<string, number> | null) => {
      const file = claudeUsageFile(home, tab)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, JSON.stringify({ at: 100, payload: input(total, size, usageField) }))
    }
    put('tab-a', 45000, 200000, { input_tokens: 45000 })
    put('tab-b', 120000, 1000000, { input_tokens: 120000 })
    put('tab-c', null, 200000, null)
    const service = new StatusService({
      home,
      adapters: { claude: createClaudeAdapter({ userHooksInstalled: () => false }) },
      alive: async () => new Set(['tab-a', 'tab-b', 'tab-c']),
    })
    const notified: Array<[string, number | null]> = []
    service.subscribeContext((tabId, context) => notified.push([tabId, context.tokens]))
    for (const tabId of ['tab-a', 'tab-b', 'tab-c']) {
      service.track({ tabId, spaceId: 's', spacePath: dir, kind: 'claude', sessionId: crypto.randomUUID() })
    }
    const list = service.list(new Set(['tab-a', 'tab-b', 'tab-c']))
    const byTab = Object.fromEntries(list.map((agent) => [agent.tabId, agent.context]))
    expect(byTab['tab-a']).toMatchObject({ tokens: 45000, window: 200000 })
    expect(byTab['tab-b']).toMatchObject({ tokens: 120000, window: 1000000 })
    expect(byTab['tab-c']).toMatchObject({ tokens: null, window: 200000 })
    expect(notified).toEqual([['tab-a', 45000], ['tab-b', 120000], ['tab-c', null]])
    service.close()
  })
})
