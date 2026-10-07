import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../agents/types'
import { claudeArgv } from './hooks'
import { SpoolClaude } from './source'

const line = (e: unknown) => JSON.stringify({ t: '2026-10-07T06:35:03Z', e }) + '\n'

describe('SpoolClaude', () => {
  const sources: SpoolClaude[] = []
  afterEach(() => { for (const s of sources.splice(0)) s.stop() })

  function setup() {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-')), 'agents', 'claude')
    const source = new SpoolClaude({ dir })
    sources.push(source)
    const events: AgentEvent[] = []
    const append = (id: string, e: unknown) => fs.appendFileSync(path.join(dir, `${id}.jsonl`), line(e))
    return { dir, source, events, append }
  }

  it('is the claude source: uuid ids, per-launch hooks writing to its spool', () => {
    const { dir, source } = setup()
    expect(source.kind).toBe('claude')
    expect(source.statusNeedsEvent).toBe(true)
    expect(source.mintId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(source.argv('u', 'start')).toEqual(claudeArgv('u', path.join(dir, 'u.jsonl'), 'start'))
  })

  it('connects on start, folds earlier records silently, and snapshots only spools with records', async () => {
    const { dir, source, events } = setup()
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, 'u.jsonl'), line({ hook_event_name: 'UserPromptSubmit' }))
    fs.appendFileSync(path.join(dir, 'u.jsonl'), line({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: '/w/a.md' } }))
    source.start((e) => events.push(e))
    expect(events).toEqual([{ type: 'connected', version: 'spool' }])
    const snaps = await source.snapshot(['u', 'none'])
    expect([...snaps]).toEqual([['u', { running: true, idleAt: null, pending: [], children: [] }]])
    expect(await source.lastWrites('u')).toEqual(['/w/a.md'])
    expect(await source.lastWrites('none')).toEqual([])
  })

  it('snapshots the latest StatusLine reading as context', async () => {
    const { dir, source } = setup()
    fs.mkdirSync(dir, { recursive: true })
    const sl = (used_percentage: number) => line({ hook_event_name: 'StatusLine', model: 'm', context_window: { context_window_size: 200000, used_percentage, current_usage: { input_tokens: 5 } } })
    fs.appendFileSync(path.join(dir, 'u.jsonl'), sl(3) + sl(4))
    source.start(() => {})
    expect((await source.snapshot(['u'])).get('u')?.context).toEqual({ pct: 4, tokens: 5, window: 200000, model: 'm' })
  })

  it('emits events for appended records and keeps the fold for snapshots', async () => {
    const { source, events, append } = setup()
    source.start((e) => events.push(e))
    append('u', { hook_event_name: 'PermissionRequest', tool_name: 'Bash' })
    await vi.waitFor(() => expect(events).toHaveLength(2), { timeout: 3000 })
    expect(events[1]).toEqual({ type: 'pending', sessionId: 'u', id: 'perm:main', kind: 'permission', open: true })
    expect((await source.snapshot(['u'])).get('u')?.pending).toEqual([{ id: 'perm:main', kind: 'permission' }])
    expect(await source.lastWrites('u')).toEqual([])
  })

  it('resumes the spool\'s latest conversation and forgets a removed session', async () => {
    const { dir, source } = setup()
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, 'u.jsonl'), line({ hook_event_name: 'SessionStart', session_id: 'post' }) + line({ hook_event_name: 'UserPromptSubmit' }))
    fs.appendFileSync(path.join(dir, 'v.jsonl'), line({ hook_event_name: 'UserPromptSubmit' }))
    source.start(() => {})
    expect(source.argv('u', 'resume')).toEqual(claudeArgv('u', path.join(dir, 'u.jsonl'), 'resume', 'post'))
    for (const id of ['v', 'none']) expect(source.argv(id, 'resume')).toEqual(claudeArgv(id, path.join(dir, `${id}.jsonl`), 'resume'))
    expect(source.argv('u', 'start')).toEqual(claudeArgv('u', path.join(dir, 'u.jsonl'), 'start'))
    source.forget('u')
    expect(fs.existsSync(path.join(dir, 'u.jsonl'))).toBe(false)
    expect((await source.snapshot(['u'])).size).toBe(0)
    expect(await source.lastWrites('u')).toEqual([])
    expect(() => source.forget('none')).not.toThrow()
  })

  it('stops tailing on stop()', async () => {
    const { source, events, append } = setup()
    source.start((e) => events.push(e))
    source.stop()
    append('u', { hook_event_name: 'UserPromptSubmit' })
    await new Promise((r) => setTimeout(r, 1200))
    expect(events).toHaveLength(1)
  })
})
