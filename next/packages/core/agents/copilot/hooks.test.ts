import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { hookCommand } from './hooks.ts'

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
})
