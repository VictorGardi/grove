import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeArgv, hookSettings } from './hooks'

interface Entry { matcher?: string; hooks: { type: string; command: string; timeout: number }[] }

describe('hookSettings', () => {
  const spool = "/a b/it's/x.jsonl"
  const { hooks } = JSON.parse(hookSettings(spool)) as { hooks: Record<string, Entry[]> }

  it('lists the hooks and matchers, each appending to the quoted spool', () => {
    expect(Object.keys(hooks)).toEqual([
      'SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'PreToolUse', 'PostToolUse',
      'PostToolUseFailure', 'PostToolBatch', 'Stop', 'StopFailure', 'Notification',
    ])
    const matchers = Object.fromEntries(Object.entries(hooks).map(([k, v]) => [k, v.map((e) => e.matcher)]))
    expect(matchers).toEqual({
      SessionStart: [undefined], UserPromptSubmit: [undefined], PermissionRequest: [undefined],
      PreToolUse: ['AskUserQuestion'], PostToolUse: ['Write|Edit|MultiEdit|NotebookEdit|AskUserQuestion'],
      PostToolUseFailure: [undefined], PostToolBatch: [undefined], Stop: [undefined], StopFailure: [undefined],
      Notification: ['idle_prompt'],
    })
    const handlers = Object.entries(hooks).flatMap(([k, v]) => v.flatMap((e) => e.hooks.map((h) => ({ k, ...h }))))
    expect(handlers.every((h) => h.type === 'command' && h.timeout === 5)).toBe(true)
    const command = handlers[0].command
    const marker = hooks.PostToolBatch[0].hooks[0].command
    expect(handlers.filter((h) => h.k !== 'PostToolBatch').every((h) => h.command === command)).toBe(true)
    expect(marker).not.toBe(command)
    for (const c of [command, marker]) expect(c.endsWith(`>> '/a b/it'\\''s/x.jsonl'`)).toBe(true)
  })

  it('appends one {t, e} record per call', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-')), 'x.jsonl')
    const { hooks: h } = JSON.parse(hookSettings(file)) as { hooks: Record<string, Entry[]> }
    execFileSync('sh', ['-c', h.Stop[0].hooks[0].command], { input: '{"a":1}' })
    expect(fs.readFileSync(file, 'utf8')).toMatch(/^\{"t":"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ","e":\{"a":1\}\}\n$/)
  })

  it('writes only a marker for PostToolBatch, whose stdin holds every tool output', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-')), 'x.jsonl')
    const { hooks: h } = JSON.parse(hookSettings(file)) as { hooks: Record<string, Entry[]> }
    execFileSync('sh', ['-c', h.PostToolBatch[0].hooks[0].command], { input: '{"tool_calls":[{"tool_response":"big"}]}' })
    expect(fs.readFileSync(file, 'utf8')).toMatch(/^\{"t":"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ","e":\{"hook_event_name":"PostToolBatch"\}\}\n$/)
  })
})

describe('statusLine', () => {
  const stdin = JSON.stringify({
    session_id: 's1', transcript_path: '/big/path', cost: { total_cost_usd: 1 }, model: { id: 'claude-opus-5-5', display_name: 'Opus' },
    context_window: {
      total_input_tokens: 99, context_window_size: 1000000, used_percentage: 19,
      current_usage: { input_tokens: 2, output_tokens: 7, cache_creation_input_tokens: 10, cache_read_input_tokens: 20 },
    },
  })
  const setup = (userSettings?: unknown) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-'))
    const spool = path.join(dir, 'x.jsonl')
    if (userSettings) fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(userSettings))
    const { statusLine } = JSON.parse(hookSettings(spool)) as { statusLine: { type: string; command: string } }
    const run = (input: string) =>
      execFileSync('sh', ['-c', statusLine.command], { input, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: dir } })
    return { spool, statusLine, run }
  }

  it('is a command that overrides the user-level statusLine', () => {
    expect(setup().statusLine.type).toBe('command')
  })

  it('appends a slim StatusLine record', () => {
    const { spool, run } = setup()
    expect(run(stdin)).toBe('')
    const line = fs.readFileSync(spool, 'utf8')
    expect(line).toMatch(/^\{"t":"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ","e":\{"hook_event_name":"StatusLine",/)
    expect(JSON.parse(line).e).toEqual({
      hook_event_name: 'StatusLine', model: 'claude-opus-5-5',
      context_window: {
        context_window_size: 1000000, used_percentage: 19,
        current_usage: { input_tokens: 2, cache_read_input_tokens: 20, cache_creation_input_tokens: 10 },
      },
    })
  })

  it('keeps nulls early in a session', () => {
    const { spool, run } = setup()
    run(JSON.stringify({ model: 'm', context_window: { context_window_size: 200000, used_percentage: null, current_usage: null } }))
    expect(JSON.parse(fs.readFileSync(spool, 'utf8')).e.context_window).toEqual({ context_window_size: 200000, used_percentage: null, current_usage: null })
  })

  it("runs the user's statusLine command on the same stdin and prints its output", () => {
    const { run } = setup({ statusLine: { type: 'command', command: `printf 'chained:%s' "$(jq -r .session_id)"` } })
    expect(run(stdin)).toBe('chained:s1')
  })

  it('survives a user statusLine that is missing or a settings file that is not JSON', () => {
    expect(setup({ other: 1 }).run(stdin)).toBe('')
    const { spool, run } = setup()
    fs.writeFileSync(path.join(path.dirname(spool), 'settings.json'), 'not json')
    expect(run(stdin)).toBe('')
    expect(fs.readFileSync(spool, 'utf8')).toContain('StatusLine')
  })
})

describe('claudeArgv', () => {
  it('starts with our id and resumes with the resume id when given', () => {
    const s = hookSettings('/x.jsonl')
    expect(claudeArgv('u1', '/x.jsonl', 'start')).toEqual(['claude', '--session-id', 'u1', '--settings', s])
    expect(claudeArgv('u1', '/x.jsonl', 'resume')).toEqual(['claude', '--resume', 'u1', '--settings', s])
    expect(claudeArgv('u1', '/x.jsonl', 'resume', 'r')).toEqual(['claude', '--resume', 'r', '--settings', s])
  })
})
