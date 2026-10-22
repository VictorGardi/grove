import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CopilotSource, copilotOnPath } from './source'

describe('CopilotSource', () => {
  const source = new CopilotSource({ onPath: async () => true })

  it('mints a uuid and starts and resumes under it', () => {
    const id = source.mintId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/)
    expect(source.argv(id, 'start')).toEqual(['copilot', '--session-id', id])
    expect(source.argv(id, 'resume')).toEqual(['copilot', `--resume=${id}`])
  })

  it('passes the model on start and resume, and the prompt on start only', () => {
    const id = source.mintId()
    expect(source.argv(id, 'start', { model: 'gpt-5.4', prompt: 'do X', name: 'l' })).toEqual(['copilot', '--session-id', id, '--model', 'gpt-5.4', '--interactive=do X'])
    expect(source.argv(id, 'start', { prompt: '-x' })).toEqual(['copilot', '--session-id', id, '--interactive=-x'])
    expect(source.argv(id, 'resume', { model: 'gpt-5.4', prompt: 'do X' })).toEqual(['copilot', `--resume=${id}`, '--model', 'gpt-5.4'])
  })

  it('signals nothing, so a card has no status', async () => {
    const events: string[] = []
    source.start((e) => events.push(e.type))
    expect(events).toEqual(['connected'])
    expect((await source.snapshot(['x'])).size).toBe(0)
    expect(await source.lastWrites('x')).toEqual([])
    expect(source.statusNeedsEvent).toBe(true)
  })

  it('refuses a create with no-copilot when the binary is not on the login shell PATH', async () => {
    expect(await new CopilotSource({ onPath: async () => false }).preflight()).toBe('no-copilot')
    expect(await source.preflight()).toBeNull()
  })
})

describe('copilotOnPath', () => {
  it('is false when the shell cannot be run or finds nothing', async () => {
    expect(await copilotOnPath('/nonexistent-shell')).toBe(false)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-copilot-'))
    const shell = (body: string) => {
      const f = path.join(dir, `sh-${Math.random().toString(36).slice(2)}`)
      fs.writeFileSync(f, `#!/bin/sh\n${body}\n`, { mode: 0o755 })
      return f
    }
    expect(await copilotOnPath(shell('exit 1'))).toBe(false)
    expect(await copilotOnPath(shell('echo /opt/homebrew/bin/copilot'))).toBe(true)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
