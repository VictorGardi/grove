import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureHolder } from '../core/holder-client.ts'
import { stopHolder } from '../core/test-helpers.ts'
import { main, worktreeSpace } from './main.ts'

describe('grove cli', () => {
  let home: string
  let folder: string
  let holder: ChildProcess | undefined
  let logs: string[]
  let errors: string[]
  const savedHome = process.env.GROVE_HOME
  const savedCaller = process.env.GROVE_CALLER_CWD

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-cli-'))
    folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gn-space-')))
    process.env.GROVE_HOME = home
    delete process.env.GROVE_CALLER_CWD
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
    if (savedHome === undefined) delete process.env.GROVE_HOME
    else process.env.GROVE_HOME = savedHome
    if (savedCaller === undefined) delete process.env.GROVE_CALLER_CWD
    else process.env.GROVE_CALLER_CWD = savedCaller
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(folder, { recursive: true, force: true })
  })

  it('adds a space each time, so a second add of a folder is a second space, and lists both', async () => {
    // Keep the holder this test starts, so afterEach can stop it. main() then finds it running.
    holder = await ensureHolder()

    expect(await main(['space', 'add', folder])).toBe(0)
    expect(logs).toEqual([`added ${folder}`])

    logs.length = 0
    expect(await main(['space', 'add', folder])).toBe(0)
    expect(logs).toEqual([`added ${folder}#2`])

    logs.length = 0
    expect(await main(['ls'])).toBe(0)
    expect(logs).toContain(folder)
    expect(logs).toContain(`${folder}#2`)
    expect(errors).toEqual([])
  }, 20000)

  it('adds the caller folder when no path is given', async () => {
    holder = await ensureHolder()
    process.env.GROVE_CALLER_CWD = folder

    expect(await main(['space', 'add'])).toBe(0)
    expect(logs).toEqual([`added ${folder}`])
  }, 20000)

  // Polls read until the text shows (a shell takes a moment to run what was pasted), up to 10 s.
  async function readUntil(ref: string, text: string): Promise<string> {
    const deadline = Date.now() + 10_000
    for (;;) {
      logs.length = 0
      expect(await main(['read', ref])).toBe(0)
      const screen = logs.join('\n')
      if (screen.includes(text) || Date.now() > deadline) return screen
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }

  it('starts a terminal with a label in a space, lists it, and reads what is sent to it', async () => {
    holder = await ensureHolder()
    expect(await main(['space', 'add', folder])).toBe(0)

    logs.length = 0
    expect(await main(['new', 'terminal', '--cwd', folder, '--label', 'scratch'])).toBe(0)
    expect(logs).toHaveLength(1)
    const id = logs[0]
    expect(id).toMatch(/^\S+$/)

    logs.length = 0
    expect(await main(['ls'])).toBe(0)
    expect(logs).toContain(folder)
    expect(logs.join('\n')).toMatch(new RegExp(`${id}\\s+terminal\\s+-\\s+-\\s+scratch\\s+alive`))

    logs.length = 0
    expect(await main(['send', 'scratch', 'echo grove-slice7-$((6*7))'])).toBe(0)
    expect(await readUntil('scratch', 'grove-slice7-42')).toContain('grove-slice7-42')

    logs.length = 0
    expect(await main(['kill', id])).toBe(0)
    logs.length = 0
    expect(await main(['ls'])).toBe(0)
    expect(logs.join('\n')).not.toContain(id)
    expect(errors).toEqual([])
  }, 30000)

  it('exits 1 for wait on a terminal, which has no agent state', async () => {
    holder = await ensureHolder()
    expect(await main(['space', 'add', folder])).toBe(0)
    logs.length = 0
    expect(await main(['new', 'terminal', '--cwd', folder, '--label', 'plain'])).toBe(0)
    const id = logs[0]

    expect(await main(['wait', 'plain', '--timeout', '5'])).toBe(1)
    expect(errors.join('\n')).toContain(`tab ${id} is a shell`)
    expect(await main(['kill', id])).toBe(0)
  }, 30000)

  it('exits 1 for a new tab in a folder that is not a space', async () => {
    holder = await ensureHolder()
    expect(await main(['new', 'terminal', '--cwd', folder])).toBe(1)
    expect(errors).toEqual([`error: not a space: ${folder}, add it with grove space add`])
    expect(logs).toEqual([])
  }, 20000)

  describe('inside a tab', () => {
    const savedTab = process.env.GROVE_TAB
    afterEach(() => {
      if (savedTab === undefined) delete process.env.GROVE_TAB
      else process.env.GROVE_TAB = savedTab
    })

    // A shell tab stands in for the caller: it has a space, and no agent kind to copy.
    async function callerTab(): Promise<string> {
      holder = await ensureHolder()
      expect(await main(['space', 'add', folder])).toBe(0)
      logs.length = 0
      expect(await main(['new', 'terminal', '--cwd', folder, '--label', 'me'])).toBe(0)
      const id = logs[0]
      logs.length = 0
      process.env.GROVE_TAB = id
      return id
    }

    it('opens in the caller\'s own space, even from another folder, and needs a kind from a shell', async () => {
      await callerTab()
      process.env.GROVE_CALLER_CWD = os.tmpdir()
      expect(await main(['new', 'terminal', '--label', 'sibling'])).toBe(0)
      expect(await main(['new', '--here', '--label', 'x'])).toBe(1)
      expect(errors).toEqual(['error: name a kind: terminal, claude, opencode or copilot (this is not an agent tab)'])
      logs.length = 0
      expect(await main(['ls'])).toBe(0)
      expect(logs.join('\n')).toMatch(/sibling/)
      expect(logs).toContain(folder)
    }, 30000)

    it('refuses --here outside a Grove tab', async () => {
      holder = await ensureHolder()
      delete process.env.GROVE_TAB
      expect(await main(['new', 'terminal', '--here'])).toBe(1)
      expect(errors).toEqual(['error: --here needs a Grove tab: GROVE_TAB is not set or names no tab'])
    }, 20000)
  })

  it('exits 1 for a ref that matches no tab', async () => {
    holder = await ensureHolder()
    expect(await main(['read', 'nosuchtab'])).toBe(1)
    expect(errors[0]).toContain('no tab matches nosuchtab')
  }, 20000)

  it('prints the config folder under the home, from the running core', async () => {
    holder = await ensureHolder()
    expect(await main(['config', 'path'])).toBe(0)
    expect(logs).toEqual([path.join(home, 'config')])
    expect(errors).toEqual([])
  }, 20000)

  it('prints usage and returns 2 for an unknown command or missing arguments', async () => {
    expect(await main(['space'])).toBe(2)
    expect(await main(['nope'])).toBe(2)
    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain('usage:')
    expect(logs).toEqual([])
  })

  describe('worktreeSpace', () => {
    const space = (id: string, branch: string | null, parent: string | null = null) =>
      ({ id, path: `/w/${id}`, name: id, label: null, repoName: 'r', parent, worktree: parent !== null, branch })
    const repo = space('main', 'main')
    const open = space('wt', 'feature', 'main')
    const core = (calls: unknown[]) => ({ request: async (method: string, params: unknown) => (calls.push([method, params]), space('new', 'x', 'main')) }) as never

    it('reuses an open space of the branch, from the repo or from one of its worktrees', async () => {
      const calls: unknown[] = []
      expect(await worktreeSpace(core(calls), [repo, open], repo, 'feature', undefined)).toBe(open)
      expect(await worktreeSpace(core(calls), [repo, open], open, 'main', undefined)).toBe(repo)
      expect(calls).toEqual([])
      expect(errors).toEqual([`reusing ${open.path}`, `reusing ${repo.path}`])
    })

    it('asks the core for a new one, passing the base on', async () => {
      const calls: unknown[] = []
      await worktreeSpace(core(calls), [repo, open], open, 'fresh', 'origin/main')
      expect(calls).toEqual([['worktrees.add', { spaceId: 'wt', branch: 'fresh', base: 'origin/main' }]])
    })

    it('refuses --base for a branch that is already a space', async () => {
      await expect(worktreeSpace(core([]), [repo, open], repo, 'feature', 'main')).rejects.toThrow('branch feature exists, --base only applies to a new branch')
    })
  })
})
