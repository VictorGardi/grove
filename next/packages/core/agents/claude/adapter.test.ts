import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { StatusEvent } from '../../status/contract.ts'
import { createClaudeAdapter } from './adapter.ts'
import { claudeSpoolFile, claudeUsageFile } from './launch.ts'

const SESSION = '00000000-0000-4000-8000-00000000000c'

describe('createClaudeAdapter', () => {
  let home: string

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-claude-adapter-'))
  })

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('launches a fresh session with a session id and the hook settings', () => {
    const launch = createClaudeAdapter().launch({ tabId: 't1', cwd: home, home })
    expect(launch.command).toBe('claude')
    expect(launch.args.slice(0, 2)).toEqual(['--session-id', launch.sessionId])
    expect(launch.env).toEqual({ GROVE_NEXT_SPOOL: claudeSpoolFile(home, 't1'), GROVE_NEXT_USAGE: claudeUsageFile(home, 't1') })
  })

  it('resumes the given session id', () => {
    const launch = createClaudeAdapter().launch({ tabId: 't1', cwd: home, home, resumeId: SESSION })
    expect(launch.sessionId).toBe(SESSION)
    expect(launch.args.slice(0, 2)).toEqual(['--resume', SESSION])
  })

  it('refuses a resume id that is not a session id', () => {
    expect(() => createClaudeAdapter().launch({ tabId: 't1', cwd: home, home, resumeId: '--settings' })).toThrow(
      'resume id is not a session id',
    )
  })

  it('reports the session of a spool record it reads from the tab spool', () => {
    const spool = claudeSpoolFile(home, 't1')
    fs.mkdirSync(path.dirname(spool), { recursive: true })
    fs.writeFileSync(spool, `${JSON.stringify({ event: 'SessionStart', at: 5, payload: { session_id: SESSION } })}\n`)
    const events: Array<{ event: StatusEvent; at: number }> = []
    const watch = createClaudeAdapter().watch({
      tabId: 't1',
      sessionId: '',
      home,
      clock: () => 9,
      onEvent: (event, at) => events.push({ event, at }),
    })
    expect(events).toContainEqual({ event: { kind: 'session', resumeId: SESSION }, at: 5 })
    watch.close()
  })
})
