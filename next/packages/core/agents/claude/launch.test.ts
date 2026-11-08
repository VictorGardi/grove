import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CLAUDE_HOOK_EVENTS, CLAUDE_HOOK_SCRIPT, claudeLaunch } from './launch.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe('claudeLaunch', () => {
  let home: string

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-claude-launch-'))
  })

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('names a fresh session with --session-id', () => {
    const launch = claudeLaunch({ tabId: 'tab-1', cwd: '/work', home })
    expect(launch.command).toBe('claude')
    expect(launch.args[0]).toBe('--session-id')
    expect(launch.args[1]).toBe(launch.sessionId)
    expect(launch.sessionId).toMatch(UUID)
    expect(launch.args).not.toContain('--resume')
  })

  it('gives each fresh launch its own session id', () => {
    const first = claudeLaunch({ tabId: 'tab-1', cwd: '/work', home })
    const second = claudeLaunch({ tabId: 'tab-2', cwd: '/work', home })
    expect(first.sessionId).not.toBe(second.sessionId)
  })

  it('resumes with --resume and keeps the given id', () => {
    const launch = claudeLaunch({ tabId: 'tab-1', cwd: '/work', home, resumeId: 'abc-123' })
    expect(launch.args.slice(0, 2)).toEqual(['--resume', 'abc-123'])
    expect(launch.args).not.toContain('--session-id')
    expect(launch.sessionId).toBe('abc-123')
  })

  it('passes --settings with a SessionStart command hook running hook.mjs, and no status hooks', () => {
    const launch = claudeLaunch({ tabId: 'tab-1', cwd: '/work', home })
    const at = launch.args.indexOf('--settings')
    expect(at).toBeGreaterThan(0)
    const settings = JSON.parse(launch.args[at + 1]) as { hooks: Record<string, Array<{ hooks: Array<{ type: string; command: string }> }>> }
    expect(CLAUDE_HOOK_EVENTS).toEqual(['SessionStart'])
    expect(Object.keys(settings.hooks)).toEqual(['SessionStart'])
    const [entry] = settings.hooks.SessionStart
    expect(entry.hooks).toHaveLength(1)
    expect(entry.hooks[0].type).toBe('command')
    expect(entry.hooks[0].command).toBe(`node '${CLAUDE_HOOK_SCRIPT}' SessionStart`)
    expect(path.isAbsolute(CLAUDE_HOOK_SCRIPT)).toBe(true)
  })

  it('names the spool under home and leaves the environment to the tab', () => {
    const launch = claudeLaunch({ tabId: 'tab-9', cwd: '/work', home })
    expect(launch.spoolFile).toBe(path.join(home, 'agents', 'claude', 'tab-9.jsonl'))
    expect(launch.env).toEqual({})
    expect(launch.usageFile).toBe(path.join(home, 'agents', 'claude', 'tab-9.usage.json'))
  })

  it('leaves out the per-launch hooks but keeps the status line when the user settings carry the hook', () => {
    const launch = claudeLaunch({ tabId: 'tab-1', cwd: '/work', home, perLaunchHooks: false })
    const at = launch.args.indexOf('--settings')
    expect(at).toBeGreaterThan(0)
    const settings = JSON.parse(launch.args[at + 1]) as { hooks?: unknown; statusLine?: { type: string } }
    expect(settings.hooks).toBeUndefined()
    expect(settings.statusLine?.type).toBe('command')
  })
})

describe('hook.mjs', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-claude-hook-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  // The spool is the tab's own file under GROVE_NEXT_HOME, as for every tab the app starts.
  const spoolOf = (home: string) => path.join(home, 'agents', 'claude', 'tab.jsonl')
  function runHook(event: string | undefined, input: string, home: string | undefined, tab: string | null = 'tab') {
    const env: NodeJS.ProcessEnv = { ...process.env }
    delete env.GROVE_NEXT_HOME
    delete env.GROVE_NEXT_TAB
    if (home !== undefined) env.GROVE_NEXT_HOME = home
    if (tab !== null) env.GROVE_NEXT_TAB = tab
    const args = event === undefined ? [CLAUDE_HOOK_SCRIPT] : [CLAUDE_HOOK_SCRIPT, event]
    return spawnSync(process.execPath, args, { input, env, encoding: 'utf8' })
  }

  it('appends one JSON line with the event, the time and the payload, creating the folder', () => {
    const home = path.join(dir, 'nested')
    const spool = spoolOf(home)
    const payload = { session_id: 's-1', hook_event_name: 'SessionStart' }
    const before = Date.now()
    const result = runHook('SessionStart', JSON.stringify(payload), home)
    expect(result.status).toBe(0)
    const lines = fs.readFileSync(spool, 'utf8').split('\n')
    expect(lines[1]).toBe('')
    const record = JSON.parse(lines[0]) as { event: string; at: number; payload: unknown }
    expect(record.event).toBe('SessionStart')
    expect(record.at).toBeGreaterThanOrEqual(before)
    expect(record.payload).toEqual(payload)
  })

  it('appends to an existing spool rather than replacing it', () => {
    const spool = spoolOf(dir)
    runHook('SessionStart', '{"session_id":"a"}', dir)
    runHook('SessionStart', '{"session_id":"b"}', dir)
    const events = fs.readFileSync(spool, 'utf8').trim().split('\n').map((line) => (JSON.parse(line) as { event: string }).event)
    expect(events).toEqual(['SessionStart', 'SessionStart'])
  })

  it('records a null payload for empty or invalid stdin and still exits 0', () => {
    const spool = spoolOf(dir)
    expect(runHook('SessionStart', '', dir).status).toBe(0)
    expect(runHook('SessionStart', 'not json', dir).status).toBe(0)
    const records = fs.readFileSync(spool, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { payload: unknown })
    expect(records.map((r) => r.payload)).toEqual([null, null])
  })

  it('exits 0 and writes nothing when the tab environment or the event is missing', () => {
    expect(runHook('SessionStart', '{}', undefined).status).toBe(0)
    expect(runHook('SessionStart', '{}', dir, null).status).toBe(0)
    expect(runHook(undefined, '{}', dir).status).toBe(0)
    expect(fs.existsSync(path.join(dir, 'agents'))).toBe(false)
  })

  it('exits 0 when the spool cannot be written', () => {
    const blocker = path.join(dir, 'file')
    fs.writeFileSync(blocker, 'x')
    expect(runHook('SessionStart', '{}', blocker).status).toBe(0)
  })
})
