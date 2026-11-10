import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CLAUDE_HOOK_EVENTS } from '../agents/claude/launch.ts'
import { hasClaudeHooks, claudeHookCommand, installClaude, MARKER, mergeClaudeStatusLine, originalStatusLine, readSettings, removeClaudeStatusLine, uninstallClaude, uninstallCopilot } from './install.ts'

describe('integration install', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-install-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('merges the Claude SessionStart hook next to the user’s own hooks and keeps every other key', () => {
    const file = path.join(dir, 'settings.json')
    const theirs = { model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'their-tool stop' }] }] } }
    fs.writeFileSync(file, JSON.stringify(theirs))

    const result = installClaude(file, '/usr/bin/node')
    expect(result.changed).toBe(true)
    const after = readSettings(file) as { model: string; hooks: Record<string, unknown[]> }
    expect(after.model).toBe('opus')
    expect(after.hooks.Stop).toHaveLength(1)
    expect(JSON.stringify(after.hooks.Stop[0])).toContain('their-tool stop')
    expect(CLAUDE_HOOK_EVENTS).toEqual(['SessionStart'])
    expect(Object.keys(after.hooks).sort()).toEqual(['SessionStart', 'Stop'])
    expect(after.hooks.SessionStart).toHaveLength(1)
    expect(hasClaudeHooks(after)).toBe(true)
  })

  it('keeps a copy of the file as it was before the first change', () => {
    const file = path.join(dir, 'settings.json')
    fs.writeFileSync(file, '{"model":"opus"}')
    const result = installClaude(file, '/usr/bin/node')
    expect(result.backup).toBe(`${file}.grove-next.bak`)
    expect(fs.readFileSync(`${file}.grove-next.bak`, 'utf8')).toBe('{"model":"opus"}')
  })

  it('keeps the permissions of a private settings file', () => {
    const file = path.join(dir, 'settings.json')
    fs.writeFileSync(file, '{"model":"opus"}', { mode: 0o600 })
    fs.chmodSync(file, 0o600)
    installClaude(file, '/usr/bin/node')
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
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

  it('writes the command so it does nothing unless the tab has GROVE_NEXT_TAB, and carries the marker', () => {
    const file = path.join(dir, 'settings.json')
    installClaude(file, '/usr/bin/node')
    const after = readSettings(file) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> }
    const command = after.hooks.SessionStart[0].hooks[0].command
    expect(command.startsWith('if [ -n "$GROVE_NEXT_TAB" ]; then ')).toBe(true)
    expect(command.endsWith(`; fi ${MARKER}`)).toBe(true)
  })

  // What an older install wrote: a Grove entry for every event, status ones included.
  const oldClaude = (extra: Record<string, unknown> = {}) => ({
    hooks: {
      ...extra,
      ...Object.fromEntries(['SessionStart', 'UserPromptSubmit', 'Stop', 'PreToolUse'].map((e) => [e, [{ hooks: [{ type: 'command', command: `x ${MARKER}` }] }]])),
    },
  })

  it('reports an older install with status events as not current, and install replaces it with SessionStart only', () => {
    const file = path.join(dir, 'settings.json')
    const mine = { type: 'command', command: 'their-tool stop' }
    fs.writeFileSync(file, JSON.stringify(oldClaude({ Notification: [{ hooks: [mine] }] })))
    expect(hasClaudeHooks(readSettings(file))).toBe(false)

    installClaude(file, '/usr/bin/node')
    const after = readSettings(file) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> }
    expect(hasClaudeHooks(after)).toBe(true)
    expect(Object.keys(after.hooks).sort()).toEqual(['Notification', 'SessionStart'])
    expect(after.hooks.Notification[0].hooks[0]).toEqual(mine)
  })

  it('removes Copilot entries an older install wrote and keeps the user\'s own', () => {
    const file = path.join(dir, 'copilot-settings.json')
    const theirs = { theme: 'dark', hooks: { sessionStart: [{ type: 'command', bash: 'their-tool start' }] } }
    fs.writeFileSync(file, JSON.stringify({ theme: 'dark', hooks: { sessionStart: [...theirs.hooks.sessionStart, { type: 'command', bash: `grove ${MARKER}` }], agentStop: [{ type: 'command', bash: `grove ${MARKER}` }] } }))
    expect(uninstallCopilot(file).changed).toBe(true)
    expect(readSettings(file)).toEqual(theirs)
    expect(uninstallCopilot(file).changed).toBe(false)
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
})

describe('Claude statusLine', () => {
  it('chains the user command and restores it on uninstall', () => {
    const before = { statusLine: { type: 'command', command: "echo it's me" } }
    const once = mergeClaudeStatusLine(before, '/n')
    const twice = mergeClaudeStatusLine(once, '/n')
    expect(twice).toEqual(once)
    expect(originalStatusLine((once.statusLine as { command: string }).command)).toBe("echo it's me")
    expect(removeClaudeStatusLine(once)).toEqual(before)
  })

  it('adds and removes its own when the user had none', () => {
    const once = mergeClaudeStatusLine({}, '/n')
    expect(removeClaudeStatusLine(once)).toEqual({})
  })
})
