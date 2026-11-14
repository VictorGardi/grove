import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ERROR_CODES } from '../protocol/messages.ts'
import { GitError, WRITE_TIMEOUT_MS, runGit, type GitOptions, type GitRun } from './gitrun.ts'
import { SpacesService } from './spaces.ts'

type Call = { args: string[]; cwd: string; options?: GitOptions }

describe('create and remove run as git writes', () => {
  let root: string
  let main: string
  let calls: Call[]
  let writeFailure: Error | undefined
  let readFailure: Error | undefined
  let service: SpacesService

  const run: GitRun = async (args, cwd, options) => {
    calls.push({ args, cwd, options })
    if (options?.kind === 'write') {
      if (writeFailure) throw writeFailure
      if (args[1] === 'add') fs.mkdirSync(args[3] === undefined || args[2] !== '-b' ? args[2]! : args[4]!, { recursive: true })
      return ''
    }
    if (readFailure) throw readFailure
    if (args[0] === 'worktree') return `worktree ${main}\nHEAD abc\nbranch refs/heads/main\n`
    if (args[0] === 'symbolic-ref') return 'main\n'
    if (args[0] === 'show-ref') throw new GitError('', false)
    return 'abc\n'
  }

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-writes-')))
    main = path.join(root, 'widgets')
    fs.mkdirSync(main)
    calls = []
    writeFailure = undefined
    readFailure = undefined
    service = new SpacesService(path.join(root, 'state.json'), path.join(root, 'worktrees'), run)
  })

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it('adds the worktree through the injected runner as a write', async () => {
    const repo = await service.add(main)
    await service.addWorktreeSpace(repo.id, 'feat')
    const add = calls.find((call) => call.args[0] === 'worktree' && call.args[1] === 'add')!
    expect(add.args).toEqual(['worktree', 'add', '-b', 'feat', path.join(root, 'worktrees', 'widgets', 'feat'), 'HEAD'])
    expect(add.options).toEqual({ kind: 'write' })
  })

  it('removes with --force --force only when forced, as a write', async () => {
    const dest = path.join(root, 'worktrees', 'widgets', 'feat')
    const repo = await service.add(main)
    const created = await service.addWorktreeSpace(repo.id, 'feat')
    // The fake lists the main checkout only, so point the space's listing at a worktree.
    const worktreeRun: GitRun = async (args, cwd, options) =>
      args[0] === 'worktree' && args[1] === 'list' ? `worktree ${main}\n\nworktree ${dest}\n` : run(args, cwd, options)
    const other = new SpacesService(path.join(root, 'state.json'), path.join(root, 'worktrees'), worktreeRun)
    calls = []
    await other.removeWorktreeFolder(created.id, true)
    const remove = calls.find((call) => call.args[1] === 'remove')!
    expect(remove).toMatchObject({ args: ['worktree', 'remove', '--force', '--force', dest], cwd: main, options: { kind: 'write' } })
  })

  it('says it could not read git state, rather than not a repository, when the read fails', async () => {
    const repo = await service.add(main)
    for (readFailure of [new GitError('timed out', false, true), new GitError('boom', false)]) {
      await expect(service.addWorktreeSpace(repo.id, 'x')).rejects.toThrow("couldn't read git state, try again")
      await expect(service.removeWorktreeFolder(repo.id)).rejects.toThrow("couldn't read git state, try again")
    }
  })

  it('keeps the old messages for a folder that is genuinely not a repository', async () => {
    const repo = await service.add(main)
    readFailure = new GitError('fatal: not a git repository', true)
    await expect(service.addWorktreeSpace(repo.id, 'x')).rejects.toThrow('not a git repository')
    await expect(service.removeWorktreeFolder(repo.id)).rejects.toThrow('is not a worktree')
  })

  it('gives a remove timeout its own code, never gitRefused', async () => {
    const dest = path.join(root, 'worktrees', 'widgets', 'feat')
    const worktreeRun: GitRun = async (args, cwd, options) => {
      if (args[0] === 'worktree' && args[1] === 'list') return `worktree ${main}\n\nworktree ${dest}\n`
      return run(args, cwd, options)
    }
    service = new SpacesService(path.join(root, 'state.json'), path.join(root, 'worktrees'), worktreeRun)
    const repo = await service.add(main)
    const created = await service.addWorktreeSpace(repo.id, 'feat')
    writeFailure = new GitError('timed out', false, true)
    const error = await service.removeWorktreeFolder(created.id).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: ERROR_CODES.gitTimedOut })
    expect((error as Error).message).toContain('timed out')
    expect(ERROR_CODES.gitTimedOut).not.toBe(ERROR_CODES.gitRefused)
  })

  it('gives a create timeout a distinct timed-out error', async () => {
    const repo = await service.add(main)
    writeFailure = new GitError('timed out', false, true)
    await expect(service.addWorktreeSpace(repo.id, 'slow')).rejects.toMatchObject({ code: ERROR_CODES.gitTimedOut, message: expect.stringContaining('timed out') })
  })

  it('still maps a git refusal on create to invalid params', async () => {
    const repo = await service.add(main)
    writeFailure = new GitError('fatal: no', false)
    await expect(service.addWorktreeSpace(repo.id, 'x')).rejects.toMatchObject({ code: ERROR_CODES.invalidParams })
  })
})

describe('the real runner as a write', () => {
  let root: string
  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-realwrite-')))
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  const git = (cwd: string, args: string[]) =>
    execFileSync('git', ['-c', 'user.name=grove', '-c', 'user.email=grove@example.invalid', ...args], { cwd, stdio: 'pipe' })

  it('runs the repo post-checkout hook when a worktree is created', async () => {
    const main = path.join(root, 'widgets')
    fs.mkdirSync(main)
    git(main, ['init', '-q', '-b', 'main'])
    git(main, ['commit', '-q', '--allow-empty', '-m', 'init'])
    const marker = path.join(root, 'hook-ran')
    const hook = path.join(main, '.git', 'hooks', 'post-checkout')
    fs.writeFileSync(hook, `#!/bin/sh\necho ran > '${marker}'\n`, { mode: 0o755 })
    const service = new SpacesService(path.join(root, 'state.json'), path.join(root, 'worktrees'))
    const repo = await service.add(main)
    await service.addWorktreeSpace(repo.id, 'hooked')
    expect(fs.readFileSync(marker, 'utf8')).toBe('ran\n')
  })

  it('kills the hook and its children when a write times out', async () => {
    const main = path.join(root, 'widgets')
    fs.mkdirSync(main)
    git(main, ['init', '-q', '-b', 'main'])
    git(main, ['commit', '-q', '--allow-empty', '-m', 'init'])
    const marker = path.join(root, 'child-survived')
    fs.writeFileSync(path.join(main, '.git', 'hooks', 'post-checkout'), `#!/bin/sh\nsleep 1 && echo x > '${marker}' &\nsleep 30\n`, { mode: 0o755 })
    const started = Date.now()
    await expect(runGit(['worktree', 'add', '-b', 'slow', path.join(root, 'wt')], main, { kind: 'write', timeoutMs: 300 })).rejects.toMatchObject({ timedOut: true })
    expect(Date.now() - started).toBeLessThan(5000)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(fs.existsSync(marker)).toBe(false)
    expect(WRITE_TIMEOUT_MS).toBe(120_000)
  })
})
