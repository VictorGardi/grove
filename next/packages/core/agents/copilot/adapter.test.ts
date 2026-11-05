import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StatusEvent } from '../../status/contract.ts'
import { installCopilot } from '../../integrations/install.ts'
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
  // A Copilot home with no settings: launches here get the per-launch plugin, as they do on a Mac without the install.
  const bare = () => createCopilotAdapter({ copilotHome: path.join(home, 'copilot') })

  it('starts a fresh session under a new uuid with the tab plugin, and no environment', () => {
    const launch = bare().launch({ tabId: 't1', cwd: home, home })
    expect(launch.command).toBe('copilot')
    expect(launch.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/)
    expect(launch.args).toEqual(['--session-id', launch.sessionId, '--plugin-dir', plugin('t1')])
    expect(launch.env).toEqual({})
  })

  it('resumes the given session id with the same plugin', () => {
    const launch = bare().launch({ tabId: 't1', cwd: home, home, resumeId: SESSION })
    expect(launch.sessionId).toBe(SESSION)
    expect(launch.args).toEqual([`--resume=${SESSION}`, '--plugin-dir', plugin('t1')])
  })

  it('refuses a resume id that is not a uuid, so it never reaches the command line as a flag', () => {
    expect(() => bare().launch({ tabId: 't1', cwd: home, home, resumeId: '--model=x' })).toThrow('resume id is not a session id')
    expect(() => bare().launch({ tabId: 't1', cwd: home, home, resumeId: '' })).toThrow('resume id is not a session id')
  })

  it('writes a plugin whose hooks append to this tab\'s spool', () => {
    bare().launch({ tabId: 't1', cwd: home, home })
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

  it('leaves its plugin out when the user settings already carry Grove\'s Copilot hooks', () => {
    const copilotHome = path.join(home, 'copilot')
    installCopilot(path.join(copilotHome, 'settings.json'))
    const launch = createCopilotAdapter({ copilotHome }).launch({ tabId: 't1', cwd: home, home })
    expect(launch.args).toEqual(['--session-id', launch.sessionId])
    expect(fs.existsSync(plugin('t1'))).toBe(false)
  })

  it('finds a hand-started session from its folder and start time, before any prompt', async () => {
    const copilotHome = path.join(home, 'copilot')
    const session = (id: string, cwd: string, created: string) => {
      const dir = path.join(copilotHome, 'session-state', id)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'workspace.yaml'), `id: ${id}\ncwd: ${cwd}\ncreated_at: ${created}\n`)
    }
    // Times are real (folders are changed now), so the session folders are written after `since`.
    const now = Date.now()
    const iso = (ms: number) => new Date(ms).toISOString()
    const other = '00000000-0000-4000-8000-0000000000c2'
    const older = '00000000-0000-4000-8000-0000000000c3'
    session(SESSION, home, iso(now - 4000))
    session(other, '/elsewhere', iso(now - 4000))
    session(older, home, iso(now - 3_600_000))
    const adapter = createCopilotAdapter({ copilotHome })
    const since = now - 10_000
    expect(await adapter.discover?.({ cwd: home, since })).toBe(SESSION)
    expect(await adapter.discover?.({ cwd: '/nowhere', since })).toBeUndefined()
    expect(await adapter.discover?.({ cwd: home, since: now + 1000 })).toBeUndefined()
  })

  it('reads the spool of a hand-started agent with no session id: the session, then working, with no error', () => {
    const copilotHome = path.join(home, 'copilot')
    const spool = path.join(home, 'agents', 'copilot', 't1.jsonl')
    fs.mkdirSync(path.dirname(spool), { recursive: true })
    const at = Date.parse('2026-11-05T10:00:00.000Z')
    const hook = (name: string, extra: object = {}) => `${JSON.stringify({ t: '2026-11-05T10:00:00Z', e: { hook_event_name: name, sessionId: SESSION, timestamp: at, ...extra } })}\n`
    fs.writeFileSync(spool, hook('sessionStart') + hook('userPromptSubmitted', { prompt: 'hi' }))

    const seen: StatusEvent[] = []
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const watch = createCopilotAdapter({ copilotHome }).watch({ tabId: 't1', sessionId: '', home, clock: () => 42, onEvent: (e) => seen.push(e) })
    try {
      expect(errors).not.toHaveBeenCalled()
      expect(seen).toEqual([{ kind: 'session', resumeId: SESSION }, { kind: 'working' }])
    } finally {
      watch.close()
      errors.mockRestore()
    }
  })
})
