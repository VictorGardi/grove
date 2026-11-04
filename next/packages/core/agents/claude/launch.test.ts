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

  it('passes --settings with one command hook per event, each running hook.mjs', () => {
    const launch = claudeLaunch({ tabId: 'tab-1', cwd: '/work', home })
    const at = launch.args.indexOf('--settings')
    expect(at).toBeGreaterThan(0)
    const settings = JSON.parse(launch.args[at + 1]) as { hooks: Record<string, Array<{ hooks: Array<{ type: string; command: string }> }>> }
    expect(Object.keys(settings.hooks).sort()).toEqual([...CLAUDE_HOOK_EVENTS].sort())
    expect(CLAUDE_HOOK_EVENTS).toHaveLength(12)
    for (const event of CLAUDE_HOOK_EVENTS) {
      const [entry] = settings.hooks[event]
      expect(entry.hooks).toHaveLength(1)
      expect(entry.hooks[0].type).toBe('command')
      expect(entry.hooks[0].command).toBe(`node '${CLAUDE_HOOK_SCRIPT}' ${event}`)
    }
    expect(path.isAbsolute(CLAUDE_HOOK_SCRIPT)).toBe(true)
  })

  it('puts the spool under home and points GROVE_NEXT_SPOOL at it', () => {
    const launch = claudeLaunch({ tabId: 'tab-9', cwd: '/work', home })
    const spool = path.join(home, 'agents', 'claude', 'tab-9.jsonl')
    expect(launch.spoolFile).toBe(spool)
    expect(launch.env).toEqual({ GROVE_NEXT_SPOOL: spool })
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

  function runHook(event: string | undefined, input: string, spool: string | undefined) {
    const env: NodeJS.ProcessEnv = { ...process.env }
    delete env.GROVE_NEXT_SPOOL
    if (spool !== undefined) env.GROVE_NEXT_SPOOL = spool
    const args = event === undefined ? [CLAUDE_HOOK_SCRIPT] : [CLAUDE_HOOK_SCRIPT, event]
    return spawnSync(process.execPath, args, { input, env, encoding: 'utf8' })
  }

  it('appends one JSON line with the event, the time and the payload, creating the folder', () => {
    const spool = path.join(dir, 'nested', 'agents', 'tab.jsonl')
    const payload = { session_id: 's-1', hook_event_name: 'PreToolUse', tool_name: 'Bash' }
    const before = Date.now()
    const result = runHook('PreToolUse', JSON.stringify(payload), spool)
    expect(result.status).toBe(0)
    const lines = fs.readFileSync(spool, 'utf8').split('\n')
    expect(lines[1]).toBe('')
    const record = JSON.parse(lines[0]) as { event: string; at: number; payload: unknown }
    expect(record.event).toBe('PreToolUse')
    expect(record.at).toBeGreaterThanOrEqual(before)
    expect(record.payload).toEqual(payload)
  })

  it('appends to an existing spool rather than replacing it', () => {
    const spool = path.join(dir, 'tab.jsonl')
    runHook('UserPromptSubmit', '{"prompt":"a"}', spool)
    runHook('Stop', '{"stop_hook_active":false}', spool)
    const events = fs.readFileSync(spool, 'utf8').trim().split('\n').map((line) => (JSON.parse(line) as { event: string }).event)
    expect(events).toEqual(['UserPromptSubmit', 'Stop'])
  })

  it('records a null payload for empty or invalid stdin and still exits 0', () => {
    const spool = path.join(dir, 'tab.jsonl')
    expect(runHook('Stop', '', spool).status).toBe(0)
    expect(runHook('Stop', 'not json', spool).status).toBe(0)
    const records = fs.readFileSync(spool, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { payload: unknown })
    expect(records.map((r) => r.payload)).toEqual([null, null])
  })

  it('exits 0 and writes nothing when no spool is set or no event is given', () => {
    const spool = path.join(dir, 'tab.jsonl')
    expect(runHook('Stop', '{}', undefined).status).toBe(0)
    expect(runHook(undefined, '{}', spool).status).toBe(0)
    expect(fs.existsSync(spool)).toBe(false)
  })

  it('exits 0 when the spool cannot be written', () => {
    const blocker = path.join(dir, 'file')
    fs.writeFileSync(blocker, 'x')
    const result = runHook('Stop', '{}', path.join(blocker, 'tab.jsonl'))
    expect(result.status).toBe(0)
  })
})
