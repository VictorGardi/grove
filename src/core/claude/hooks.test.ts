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
    const handlers = Object.values(hooks).flatMap((v) => v.flatMap((e) => e.hooks))
    const command = handlers[0].command
    expect(handlers.every((h) => h.type === 'command' && h.timeout === 5 && h.command === command)).toBe(true)
    expect(command.endsWith(`>> '/a b/it'\\''s/x.jsonl'`)).toBe(true)
  })

  it('appends one {t, e} record per call', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-')), 'x.jsonl')
    const { hooks: h } = JSON.parse(hookSettings(file)) as { hooks: Record<string, Entry[]> }
    execFileSync('sh', ['-c', h.Stop[0].hooks[0].command], { input: '{"a":1}' })
    expect(fs.readFileSync(file, 'utf8')).toMatch(/^\{"t":"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ","e":\{"a":1\}\}\n$/)
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
