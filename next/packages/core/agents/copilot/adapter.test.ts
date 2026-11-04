import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { StatusEvent } from '../../status/contract.ts'
import { createCopilotAdapter } from './adapter.ts'

const SESSION = '00000000-0000-4000-8000-0000000000c1'

describe('createCopilotAdapter', () => {
  let home: string

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-copilot-adapter-'))
  })

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true })
  })

  const plugin = (tab: string) => path.join(home, 'agents', 'copilot', `${tab}.plugin`)

  it('starts a fresh session under a new uuid with the tab plugin, and no environment', () => {
    const launch = createCopilotAdapter().launch({ tabId: 't1', cwd: home, home })
    expect(launch.command).toBe('copilot')
    expect(launch.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/)
    expect(launch.args).toEqual(['--session-id', launch.sessionId, '--plugin-dir', plugin('t1')])
    expect(launch.env).toEqual({})
  })

  it('resumes the given session id with the same plugin', () => {
    const launch = createCopilotAdapter().launch({ tabId: 't1', cwd: home, home, resumeId: SESSION })
    expect(launch.sessionId).toBe(SESSION)
    expect(launch.args).toEqual([`--resume=${SESSION}`, '--plugin-dir', plugin('t1')])
  })

  it('refuses a resume id that is not a uuid, so it never reaches the command line as a flag', () => {
    expect(() => createCopilotAdapter().launch({ tabId: 't1', cwd: home, home, resumeId: '--model=x' })).toThrow('resume id is not a session id')
    expect(() => createCopilotAdapter().launch({ tabId: 't1', cwd: home, home, resumeId: '' })).toThrow('resume id is not a session id')
  })

  it('writes a plugin whose hooks append to this tab\'s spool', () => {
    createCopilotAdapter().launch({ tabId: 't1', cwd: home, home })
    expect(JSON.parse(fs.readFileSync(path.join(plugin('t1'), 'plugin.json'), 'utf8'))).toMatchObject({ name: 'grove', hooks: 'hooks.json' })
    const { hooks } = JSON.parse(fs.readFileSync(path.join(plugin('t1'), 'hooks.json'), 'utf8'))
    expect(Object.keys(hooks)).toContain('notification')
    expect(hooks.agentStop[0].bash).toContain(path.join(home, 'agents', 'copilot', 't1.jsonl'))
  })

  it('is available when the command is on the shell\'s PATH, and not when it is not', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-copilot-shell-'))
    const shell = (name: string, body: string) => {
      const file = path.join(dir, name)
      fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 })
      return file
    }
    try {
      expect(await createCopilotAdapter({ shell: shell('found', 'echo /opt/homebrew/bin/copilot') }).available?.()).toBe(true)
      expect(await createCopilotAdapter({ shell: shell('missing', 'exit 1') }).available?.()).toBe(false)
      expect(await createCopilotAdapter({ shell: path.join(dir, 'no-such-shell') }).available?.()).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('ends a turn that an Esc ended during downtime with one idle-prompt on the first read of the log', () => {
    const copilotHome = path.join(home, 'copilot')
    const logDir = path.join(copilotHome, 'session-state', SESSION)
    fs.mkdirSync(logDir, { recursive: true })
    const spool = path.join(home, 'agents', 'copilot', 't1.jsonl')
    fs.mkdirSync(path.dirname(spool), { recursive: true })
    // The turn started while the core ran: its prompt hook is in the spool, so the spool replay shows working.
    const started = Date.parse('2026-11-05T10:00:00.000Z')
    fs.writeFileSync(spool, `${JSON.stringify({ t: '2026-11-05T10:00:00.000Z', e: { hook_event_name: 'userPromptSubmitted', timestamp: started } })}\n`)
    // Esc while the core was down: Copilot's log gets an abort and no hook fires.
    fs.writeFileSync(path.join(logDir, 'events.jsonl'), `${JSON.stringify({ type: 'abort', timestamp: '2026-11-05T10:00:05.000Z' })}\n`)

    const seen: StatusEvent[] = []
    const watch = createCopilotAdapter({ copilotHome }).watch({ tabId: 't1', sessionId: SESSION, home, clock: () => 42, onEvent: (e) => seen.push(e) })
    try {
      expect(seen).toEqual([{ kind: 'working' }, { kind: 'idle-prompt' }])
    } finally {
      watch.close()
    }
  })
})
