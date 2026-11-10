import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { groveHome } from './paths.ts'

describe('groveHome migration from ~/.grove-next', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-paths-'))
    vi.stubEnv('GROVE_HOME', '')
    vi.spyOn(os, 'homedir').mockReturnValue(root)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('moves the legacy entries into ~/.grove and leaves the files already there', () => {
    fs.mkdirSync(path.join(root, '.grove-next', 'config'), { recursive: true })
    fs.writeFileSync(path.join(root, '.grove-next', 'state.json'), 'legacy')
    fs.writeFileSync(path.join(root, '.grove-next', 'config.json'), 'legacy')
    fs.mkdirSync(path.join(root, '.grove', 'worktrees'), { recursive: true })
    fs.writeFileSync(path.join(root, '.grove', 'config.json'), 'kept')

    expect(groveHome()).toBe(path.join(root, '.grove'))

    expect(fs.readFileSync(path.join(root, '.grove', 'state.json'), 'utf8')).toBe('legacy')
    expect(fs.existsSync(path.join(root, '.grove', 'config'))).toBe(true)
    expect(fs.readFileSync(path.join(root, '.grove', 'config.json'), 'utf8')).toBe('kept')
    expect(fs.existsSync(path.join(root, '.grove', 'worktrees'))).toBe(true)
    expect(fs.existsSync(path.join(root, '.grove-next', 'state.json'))).toBe(false)
  })

  it('does nothing when there is no legacy folder', () => {
    expect(groveHome()).toBe(path.join(root, '.grove'))
    expect(fs.existsSync(path.join(root, '.grove-next'))).toBe(false)
  })

  it('does not migrate when GROVE_HOME is set', () => {
    fs.mkdirSync(path.join(root, '.grove-next'))
    fs.writeFileSync(path.join(root, '.grove-next', 'state.json'), 'legacy')
    vi.stubEnv('GROVE_HOME', path.join(root, 'custom'))

    groveHome()

    expect(fs.existsSync(path.join(root, '.grove-next', 'state.json'))).toBe(true)
  })
})
