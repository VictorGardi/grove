import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureHolder } from '../core/holder-client.ts'
import { stopHolder } from '../core/test-helpers.ts'
import { main } from './main.ts'

describe('grove-next cli', () => {
  let home: string
  let folder: string
  let holder: ChildProcess | undefined
  let logs: string[]
  let errors: string[]
  const savedHome = process.env.GROVE_NEXT_HOME
  const savedCaller = process.env.GROVE_NEXT_CALLER_CWD

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-cli-'))
    folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gn-space-')))
    process.env.GROVE_NEXT_HOME = home
    delete process.env.GROVE_NEXT_CALLER_CWD
    logs = []
    errors = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '))
    })
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.join(' '))
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await stopHolder(holder)
    holder = undefined
    if (savedHome === undefined) delete process.env.GROVE_NEXT_HOME
    else process.env.GROVE_NEXT_HOME = savedHome
    if (savedCaller === undefined) delete process.env.GROVE_NEXT_CALLER_CWD
    else process.env.GROVE_NEXT_CALLER_CWD = savedCaller
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(folder, { recursive: true, force: true })
  })

  it('adds a space once, reports a second add as already a space, and lists it', async () => {
    // Keep the holder this test starts, so afterEach can stop it. main() then finds it running.
    holder = await ensureHolder()

    expect(await main(['space', 'add', folder])).toBe(0)
    expect(logs).toEqual([`added ${folder}`])

    logs.length = 0
    expect(await main(['space', 'add', folder])).toBe(0)
    expect(logs).toEqual([`already a space: ${folder}`])

    logs.length = 0
    expect(await main(['ls'])).toBe(0)
    expect(logs).toContain(folder)
    expect(errors).toEqual([])
  }, 20000)

  it('adds the caller folder when no path is given', async () => {
    holder = await ensureHolder()
    process.env.GROVE_NEXT_CALLER_CWD = folder

    expect(await main(['space', 'add'])).toBe(0)
    expect(logs).toEqual([`added ${folder}`])
  }, 20000)

  it('prints usage and returns 2 for an unknown command or missing arguments', async () => {
    expect(await main(['space'])).toBe(2)
    expect(await main(['nope'])).toBe(2)
    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain('usage:')
    expect(logs).toEqual([])
  })
})
