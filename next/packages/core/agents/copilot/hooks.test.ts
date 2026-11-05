import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { HOOK_EVENTS, hookCommand, hooksJson, parseCopilotLine } from './hooks.ts'

describe('copilot hooks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-copilot-hooks-'))
  let spool: string
  const run = (command: string, input: string) => execFileSync('sh', ['-c', command], { input })
  const lines = () => fs.readFileSync(spool, 'utf8').trim().split('\n').filter(Boolean)

  beforeEach(() => {
    spool = path.join(dir, `${Math.random().toString(36).slice(2)}.jsonl`)
  })

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('writes the stamped event and the stdin object as one line, and exits 0', () => {
    run(hookCommand('userPromptSubmitted', spool), '{"sessionId":"s",\n"prompt":"a \\"q\\" b"}')
    const [line] = lines()
    expect(JSON.parse(line)).toEqual({ t: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/), e: { hook_event_name: 'userPromptSubmitted', sessionId: 's', prompt: 'a "q" b' } })
    expect(line.split('\n')).toHaveLength(1)
  })

  it('records empty or brace-less stdin as empty, so the event is still seen', () => {
    for (const input of ['', 'no braces here']) run(hookCommand('agentStop', spool), input)
    expect(lines().map((l) => JSON.parse(l).e)).toEqual([{ hook_event_name: 'agentStop', empty: true }, { hook_event_name: 'agentStop', empty: true }])
  })

  it('never fails Copilot when the spool cannot be written', () => {
    expect(() => run(hookCommand('agentStop', path.join(dir, 'missing', 'x.jsonl')), '{}')).not.toThrow()
  })

  it('wires every hook event in the plugin to the spool', () => {
    const hooks = JSON.parse(hooksJson(spool)).hooks
    expect(Object.keys(hooks)).toEqual([...HOOK_EVENTS])
    expect(hooks.notification[0].bash).toBe(hookCommand('notification', spool))
  })

  it('parses a spool line: the payload\'s own event name wins, and Copilot\'s timestamp is the time', () => {
    expect(parseCopilotLine(JSON.stringify({ t: '2026-10-22T10:00:00Z', e: { hook_event_name: 'Notification', notification_type: 'permission_prompt' } }))).toEqual({
      event: 'Notification',
      at: Date.parse('2026-10-22T10:00:00Z'),
      payload: { hook_event_name: 'Notification', notification_type: 'permission_prompt' },
    })
    expect(parseCopilotLine(JSON.stringify({ t: '2026-10-22T10:00:00Z', e: { hook_event_name: 'agentStop', timestamp: 1792698805842 } }))?.at).toBe(1792698805842)
    expect(parseCopilotLine(JSON.stringify({ t: 'not a time', e: { hook_event_name: 'agentStop' } }))?.at).toBeUndefined()
  })

  it('rejects a line that is not a record', () => {
    expect(parseCopilotLine('nope')).toBeNull()
    expect(parseCopilotLine(JSON.stringify({ t: '2026-10-22T10:00:00Z', e: 'x' }))).toBeNull()
    expect(parseCopilotLine('null')).toBeNull()
  })
})
