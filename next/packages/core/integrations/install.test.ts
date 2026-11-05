import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CLAUDE_HOOK_EVENTS } from '../agents/claude/launch.ts'
import { hasClaudeHooks, claudeHookCommand, copilotUserHookCommand, installClaude, installCopilot, MARKER, readSettings, uninstallClaude, uninstallCopilot } from './install.ts'
import { HOOK_EVENTS as COPILOT_EVENTS, parseCopilotLine } from '../agents/copilot/hooks.ts'

describe('integration install', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-install-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('merges Claude hooks next to the user’s own hooks and keeps every other key', () => {
    const file = path.join(dir, 'settings.json')
    const theirs = { model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'their-tool stop' }] }] } }
    fs.writeFileSync(file, JSON.stringify(theirs))

    const result = installClaude(file, '/usr/bin/node')
    expect(result.changed).toBe(true)
    const after = readSettings(file) as { model: string; hooks: Record<string, unknown[]> }
    expect(after.model).toBe('opus')
    expect(after.hooks.Stop).toHaveLength(2)
    expect(JSON.stringify(after.hooks.Stop[0])).toContain('their-tool stop')
    for (const event of CLAUDE_HOOK_EVENTS) expect(after.hooks[event]).toHaveLength(event === 'Stop' ? 2 : 1)
    expect(hasClaudeHooks(after)).toBe(true)
  })

  it('keeps a copy of the file as it was before the first change', () => {
    const file = path.join(dir, 'settings.json')
    fs.writeFileSync(file, '{"model":"opus"}')
    const result = installClaude(file, '/usr/bin/node')
    expect(result.backup).toBe(`${file}.grove-next.bak`)
    expect(fs.readFileSync(`${file}.grove-next.bak`, 'utf8')).toBe('{"model":"opus"}')
  })

  it('installing twice changes nothing the second time', () => {
    const file = path.join(dir, 'settings.json')
    installClaude(file, '/usr/bin/node')
    const once = fs.readFileSync(file, 'utf8')
    const second = installClaude(file, '/usr/bin/node')
    expect(second.changed).toBe(false)
    expect(fs.readFileSync(file, 'utf8')).toBe(once)
  })

  it('uninstall removes only our entries and leaves the rest as it was', () => {
    const file = path.join(dir, 'settings.json')
    const theirs = { model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'their-tool stop' }] }] } }
    fs.writeFileSync(file, JSON.stringify(theirs))
    installClaude(file, '/usr/bin/node')
    uninstallClaude(file)
    expect(readSettings(file)).toEqual(theirs)
  })

  it('uninstall on a file that was never installed changes nothing and creates nothing', () => {
    const file = path.join(dir, 'missing', 'settings.json')
    expect(uninstallClaude(file)).toEqual({ file, backup: null, changed: false })
    expect(fs.existsSync(file)).toBe(false)
  })

  it('refuses a settings file that is not a JSON object, and does not touch it', () => {
    const file = path.join(dir, 'settings.json')
    fs.writeFileSync(file, '[1,2]')
    expect(() => installClaude(file, '/usr/bin/node')).toThrow(/not a JSON object/)
    expect(fs.readFileSync(file, 'utf8')).toBe('[1,2]')
  })

  it('writes every command so it does nothing unless the tab has GROVE_NEXT_TAB, and carries the marker', () => {
    const file = path.join(dir, 'settings.json')
    installClaude(file, '/usr/bin/node')
    const after = readSettings(file) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> }
    const command = after.hooks.PreToolUse[0].hooks[0].command
    expect(command.startsWith('if [ -n "$GROVE_NEXT_TAB" ]; then ')).toBe(true)
    expect(command.endsWith(`; fi ${MARKER}`)).toBe(true)
  })

  it('merges Copilot hooks into settings.json and removes them again', () => {
    const file = path.join(dir, 'copilot-settings.json')
    const theirs = { theme: 'dark', hooks: { sessionStart: [{ type: 'command', bash: 'their-tool start' }] } }
    fs.writeFileSync(file, JSON.stringify(theirs))

    installCopilot(file)
    const merged = readSettings(file) as { theme: string; hooks: Record<string, Array<{ bash: string }>> }
    expect(merged.theme).toBe('dark')
    expect(merged.hooks.sessionStart).toHaveLength(2)
    for (const event of COPILOT_EVENTS) expect(merged.hooks[event]).toBeDefined()
    expect(merged.hooks.sessionStart[1].bash).toContain('GROVE_NEXT_HOME')

    uninstallCopilot(file)
    expect(readSettings(file)).toEqual(theirs)
  })
  // Runs a command the way an agent does (through sh), with the tab's environment and the event on stdin.
  const runHook = (command: string, env: Record<string, string>, stdin: string) =>
    spawnSync('/bin/sh', ['-c', command], { input: stdin, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ...env } })

  it('a typed Claude session writes its hook events to the tab spool, and nothing without a tab', () => {
    const home = path.join(dir, 'grove')
    const payload = '{"session_id":"11111111-2222-4333-8444-555555555555","hook_event_name":"SessionStart"}'
    const command = claudeHookCommand('SessionStart', process.execPath)

    const outside = runHook(command, {}, payload)
    expect(outside.status).toBe(0)
    expect(fs.existsSync(home)).toBe(false)

    const inside = runHook(command, { GROVE_NEXT_TAB: 'tab-7', GROVE_NEXT_HOME: home }, payload)
    expect(inside.status).toBe(0)
    const line = JSON.parse(fs.readFileSync(path.join(home, 'agents', 'claude', 'tab-7.jsonl'), 'utf8').trim())
    expect(line.event).toBe('SessionStart')
    expect(line.payload.session_id).toBe('11111111-2222-4333-8444-555555555555')
  })

  it('a typed Copilot session writes its hook events to the tab spool in the shape the reader expects', () => {
    const home = path.join(dir, 'grove')
    const payload = '{"sessionId":"63628a79-e8e2-433a-867f-25197bda8484","timestamp":1793858821291,"cwd":"/w"}'
    const command = copilotUserHookCommand('sessionStart')

    const outside = runHook(command, {}, payload)
    expect(outside.status).toBe(0)
    expect(fs.existsSync(home)).toBe(false)

    const inside = runHook(command, { GROVE_NEXT_TAB: 'tab-8', GROVE_NEXT_HOME: home }, payload)
    expect(inside.status).toBe(0)
    const text = fs.readFileSync(path.join(home, 'agents', 'copilot', 'tab-8.jsonl'), 'utf8').trim()
    const record = parseCopilotLine(text)
    expect(record?.event).toBe('sessionStart')
    expect((record?.payload as { sessionId: string }).sessionId).toBe('63628a79-e8e2-433a-867f-25197bda8484')
  })
})
