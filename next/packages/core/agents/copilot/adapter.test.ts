import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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

  const bare = () => createCopilotAdapter({ copilotHome: path.join(home, 'copilot') })

  it('starts a fresh session under a new uuid, with no plugin and no environment', () => {
    const launch = bare().launch({ tabId: 't1', cwd: home, home })
    expect(launch.command).toBe('copilot')
    expect(launch.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/)
    expect(launch.args).toEqual(['--session-id', launch.sessionId])
    expect(launch.env).toEqual({})
  })

  it('resumes the given session id', () => {
    const launch = bare().launch({ tabId: 't1', cwd: home, home, resumeId: SESSION })
    expect(launch.sessionId).toBe(SESSION)
    expect(launch.args).toEqual([`--resume=${SESSION}`])
  })

  it('refuses a resume id that is not a uuid, so it never reaches the command line as a flag', () => {
    expect(() => bare().launch({ tabId: 't1', cwd: home, home, resumeId: '--model=x' })).toThrow('resume id is not a session id')
    expect(() => bare().launch({ tabId: 't1', cwd: home, home, resumeId: '' })).toThrow('resume id is not a session id')
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

  it('watches nothing without a session id or an onContext; status still comes from the holder', () => {
    const seen: unknown[] = []
    expect(() => bare().watch({ tabId: 't1', sessionId: '', home, clock: () => 42, onEvent: () => {}, onContext: (c) => seen.push(c) }).close()).not.toThrow()
    expect(() => bare().watch({ tabId: 't1', sessionId: SESSION, home, clock: () => 42, onEvent: () => {} }).close()).not.toThrow()
    expect(seen).toEqual([])
  })

  it('reports the session log\'s newest usage record as the tab\'s context reading', () => {
    const copilotHome = path.join(home, 'copilot')
    const dir = path.join(copilotHome, 'session-state', SESSION)
    fs.mkdirSync(dir, { recursive: true })
    const record = (inputTokens: number, timestamp: string) => JSON.stringify({
      type: 'session.usage_record',
      data: { usage: { model: 'gpt-6-luna', inputTokens, cacheReadTokens: 10_464, cacheWriteTokens: 7_639, maxPromptTokens: 272_000 } },
      id: `evt-${inputTokens}`,
      timestamp,
      parentId: null,
    })
    fs.writeFileSync(path.join(dir, 'events.jsonl'), [record(12_000, '2026-11-07T20:28:00.000Z'), record(18_106, '2026-11-07T20:30:28.702Z')].join('\n') + '\n')
    let context: unknown
    const source = createCopilotAdapter({ copilotHome }).watch({
      tabId: 't1',
      sessionId: SESSION,
      home,
      clock: () => 42,
      onEvent: () => {},
      onContext: (c) => { context = c },
    })
    expect(context).toMatchObject({ tokens: 18_106, window: 272_000, model: 'gpt-6-luna' })
    source.close()
  })
})
