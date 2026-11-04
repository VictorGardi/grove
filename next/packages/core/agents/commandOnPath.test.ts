import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commandOnPath } from './commandOnPath.ts'

// Stand-in login shells: the probe runs `shell -l -i -c 'command -v <name>'`, and these ignore the arguments.
describe('commandOnPath', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-on-path-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  function shell(name: string, body: string): string {
    const file = path.join(dir, name)
    fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 })
    return file
  }

  it('is true when the shell prints a path for the command', async () => {
    expect(await commandOnPath('opencode', shell('found', 'echo /opt/homebrew/bin/opencode'))).toBe(true)
  })

  it('is false when the shell prints nothing or exits non-zero', async () => {
    expect(await commandOnPath('opencode', shell('silent', 'exit 0'))).toBe(false)
    expect(await commandOnPath('opencode', shell('missing', 'exit 1'))).toBe(false)
  })

  it('is true when the probe times out, since a slow shell is not a missing command', async () => {
    expect(await commandOnPath('opencode', shell('slow', 'sleep 5'), 100)).toBe(true)
  })

  it('is false when the shell cannot run at all', async () => {
    expect(await commandOnPath('opencode', path.join(dir, 'no-such-shell'))).toBe(false)
  })
})
