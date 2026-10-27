import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../agents/types'
import { CopilotSource, copilotOnPath } from './source'

describe('CopilotSource', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-copilot-'))
  const home = path.join(dir, 'home')
  const source = new CopilotSource({ dir, home, onPath: async () => true })
  const plugin = (id: string) => path.join(dir, `${id}.plugin`)

  it('mints a uuid and starts and resumes under it', () => {
    const id = source.mintId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/)
    expect(source.argv(id, 'start')).toEqual(['copilot', '--session-id', id, '--plugin-dir', plugin(id)])
    expect(source.argv(id, 'resume')).toEqual(['copilot', `--resume=${id}`, '--plugin-dir', plugin(id)])
  })

  it('passes the model on start and resume, and the prompt on start only', () => {
    const id = source.mintId()
    expect(source.argv(id, 'start', { model: 'gpt-5.4', prompt: 'do X', name: 'l' })).toEqual(['copilot', '--session-id', id, '--plugin-dir', plugin(id), '--model', 'gpt-5.4', '--interactive=do X'])
    expect(source.argv(id, 'start', { prompt: '-x' })).toEqual(['copilot', '--session-id', id, '--plugin-dir', plugin(id), '--interactive=-x'])
    expect(source.argv(id, 'resume', { model: 'gpt-5.4', prompt: 'do X' })).toEqual(['copilot', `--resume=${id}`, '--plugin-dir', plugin(id), '--model', 'gpt-5.4'])
  })

  it('writes a plugin whose hooks append stamped records to the session spool', () => {
    const id = source.mintId()
    source.argv(id, 'start')
    expect(JSON.parse(fs.readFileSync(path.join(plugin(id), 'plugin.json'), 'utf8'))).toMatchObject({ name: 'grove', hooks: 'hooks.json' })
    const { hooks } = JSON.parse(fs.readFileSync(path.join(plugin(id), 'hooks.json'), 'utf8'))
    expect(Object.keys(hooks)).toEqual(['sessionStart', 'userPromptSubmitted', 'preToolUse', 'postToolUse', 'postToolUseFailure', 'notification', 'agentStop', 'sessionEnd'])
    // run a real hook command: the stdin object gets its event name
    execFileSync('sh', ['-c', hooks.userPromptSubmitted[0].bash], { input: '{"sessionId":"s","prompt":"a \\"q\\" b"}' })
    const rec = JSON.parse(fs.readFileSync(path.join(dir, `${id}.jsonl`), 'utf8').trim())
    expect(rec.t).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)
    expect(rec.e).toEqual({ hook_event_name: 'userPromptSubmitted', sessionId: 's', prompt: 'a "q" b' })
    // empty or odd stdin still records the event, and an unwritable spool never fails the hook
    for (const input of ['', '{}', '  {\n "sessionId": "s" }\n']) execFileSync('sh', ['-c', hooks.agentStop[0].bash], { input })
    const lines = fs.readFileSync(path.join(dir, `${id}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l).e)
    expect(lines.slice(1)).toEqual([{ hook_event_name: 'agentStop', empty: true }, { hook_event_name: 'agentStop', empty: true }, { hook_event_name: 'agentStop', sessionId: 's' }])
    execFileSync('sh', ['-c', hooks.agentStop[0].bash.replace(dir, path.join(dir, 'nope'))], { input: '{}' })
  })

  it('has no status until a record arrives, then folds working, attention and done, and keeps the last write', async () => {
    const id = source.mintId()
    const events: AgentEvent[] = []
    source.start((e) => events.push(e))
    expect(events.map((e) => e.type)).toEqual(['connected'])
    expect((await source.snapshot([id])).size).toBe(0)
    const rec = (e: object, t = '2026-10-22T10:00:00Z') => JSON.stringify({ t, e }) + '\n'
    const spool = path.join(dir, `${id}.jsonl`)
    fs.writeFileSync(spool, rec({ hook_event_name: 'userPromptSubmitted' }) + rec({ hook_event_name: 'notification', notification_type: 'permission_prompt' }))
    await vi.waitFor(async () => expect((await source.snapshot([id])).get(id)).toMatchObject({ running: true, pending: [{ id: 'perm:main', kind: 'permission' }] }), { timeout: 4000 })
    fs.appendFileSync(spool, rec({ hook_event_name: 'postToolUse', cwd: '/w', toolName: 'apply_patch', toolArgs: '*** Begin Patch\n*** Add File: a.txt\n+hi\n*** End Patch\n', toolResult: { resultType: 'success' } }) + rec({ hook_event_name: 'agentStop' }, '2026-10-22T10:00:09Z'))
    await vi.waitFor(async () => expect((await source.snapshot([id])).get(id)).toMatchObject({ running: false, idleAt: '2026-10-22T10:00:09.000Z', pending: [] }), { timeout: 4000 })
    expect(await source.lastWrites(id)).toEqual(['/w/a.txt'])
    expect(events.map((e) => e.type)).toEqual(['connected', 'exec-started', 'pending', 'pending', 'wrote', 'exec-ended'])
    expect(source.statusNeedsEvent).toBe(true)
    source.forget(id)
    expect(fs.existsSync(spool)).toBe(false)
    expect(fs.existsSync(plugin(id))).toBe(false)
    expect((await source.snapshot([id])).size).toBe(0)
    source.stop()
  })

  it('ends a running turn when Copilot logs an abort, which no hook reports', async () => {
    const s = new CopilotSource({ dir, home, onPath: async () => true })
    const id = s.mintId()
    const events: AgentEvent[] = []
    s.start((e) => events.push(e))
    fs.writeFileSync(path.join(dir, `${id}.jsonl`), JSON.stringify({ t: '2026-10-27T19:57:00Z', e: { hook_event_name: 'userPromptSubmitted', timestamp: Date.parse('2026-10-27T19:57:00.000Z') } }) + '\n')
    await vi.waitFor(async () => expect((await s.snapshot([id])).get(id)).toMatchObject({ running: true }), { timeout: 4000 })
    const log = path.join(home, 'session-state', id, 'events.jsonl')
    fs.mkdirSync(path.dirname(log), { recursive: true })
    fs.writeFileSync(log, JSON.stringify({ type: 'abort', data: { reason: 'user_abort' }, timestamp: '2026-10-27T19:57:09.598Z' }) + '\n')
    await vi.waitFor(async () => expect((await s.snapshot([id])).get(id)).toMatchObject({ running: false, idleAt: '2026-10-27T19:57:09.598Z' }), { timeout: 4000 })
    expect(events.map((e) => e.type)).toEqual(['connected', 'exec-started', 'exec-ended'])
    s.forget(id)
    s.stop()
  })

  it('refuses a create with no-copilot when the binary is not on the login shell PATH', async () => {
    expect(await new CopilotSource({ dir, onPath: async () => false }).preflight()).toBe('no-copilot')
    expect(await source.preflight()).toBeNull()
  })

  it('probes the login shell once after it finds the binary', async () => {
    let calls = 0
    const s = new CopilotSource({ dir, onPath: async () => (calls++, true) })
    expect(await s.preflight()).toBeNull()
    expect(await s.preflight()).toBeNull()
    expect(calls).toBe(1)
  })
})

describe('copilotOnPath', () => {
  it('is false when the shell cannot be run or finds nothing', async () => {
    expect(await copilotOnPath('/nonexistent-shell')).toBe(false)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-copilot-'))
    const shell = (body: string) => {
      const f = path.join(dir, `sh-${Math.random().toString(36).slice(2)}`)
      fs.writeFileSync(f, `#!/bin/sh\n${body}\n`, { mode: 0o755 })
      return f
    }
    expect(await copilotOnPath(shell('exit 1'))).toBe(false)
    expect(await copilotOnPath(shell('echo /opt/homebrew/bin/copilot'))).toBe(true)
    // a probe killed by its timeout does not claim the binary is missing
    expect(await copilotOnPath(shell('sleep 5'), 100)).toBe(true)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
