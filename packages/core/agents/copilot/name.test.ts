import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCopilotNameSource, readCopilotName } from './name.ts'

describe('the Copilot session name', () => {
  let home: string
  const id = '0a0b73d9-c780-4073-87a2-c8d5bea8c947'
  const file = () => path.join(home, 'session-state', id, 'workspace.yaml')
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-copilot-name-'))
    fs.mkdirSync(path.dirname(file()), { recursive: true })
  })
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }))

  it('reads the name line, quoted or not', () => {
    fs.writeFileSync(file(), `id: ${id}\ncwd: /x\nname: Implement Slice 3\nuser_named: false\n`)
    expect(readCopilotName(file())).toBe('Implement Slice 3')
    fs.writeFileSync(file(), `name: "Quoted: name"\n`)
    expect(readCopilotName(file())).toBe('Quoted: name')
  })

  it('has no name before Copilot sets one, or without the file', () => {
    fs.writeFileSync(file(), `id: ${id}\ncwd: /x\n`)
    expect(readCopilotName(file())).toBeUndefined()
    expect(readCopilotName(path.join(home, 'missing.yaml'))).toBeUndefined()
  })

  it('delivers the name once it appears and again when it changes', () => {
    fs.writeFileSync(file(), `id: ${id}\n`)
    const onName = vi.fn()
    const source = createCopilotNameSource({ copilotHome: home, sessionId: id, onName, intervalMs: 3_600_000 })
    expect(onName).not.toHaveBeenCalled()
    fs.writeFileSync(file(), `id: ${id}\nname: First\n`)
    source.drain()
    source.drain()
    fs.writeFileSync(file(), `id: ${id}\nname: Second\n`)
    source.drain()
    expect(onName.mock.calls).toEqual([['First'], ['Second']])
    source.close()
  })
})
