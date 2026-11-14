import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ERROR_CODES } from '../protocol/messages.ts'
import { GitError, runGit, type GitOptions, type GitRun } from './gitrun.ts'
import { SpacesService } from './spaces.ts'

const git = (cwd: string, args: string[]) =>
  execFileSync('git', ['-c', 'user.name=grove', '-c', 'user.email=grove@example.invalid', ...args], { cwd, stdio: 'pipe' }).toString()

describe('a create that times out, with real git', () => {
  let root: string
  let main: string
  let dest: string
  let service: SpacesService

  // The real runner, with the create's limit cut to a moment; the cleanup calls keep their own limit.
  const quick: GitRun = (args, cwd, options) =>
    runGit(args, cwd, args[0] === 'worktree' && args[1] === 'add' ? { ...options, timeoutMs: 1500 } : options)

  const branches = () => git(main, ['branch', '--format=%(refname:short)']).split('\n').filter(Boolean)
  const worktrees = () => git(main, ['worktree', 'list', '--porcelain'])
  const hook = (body: string) => fs.writeFileSync(path.join(main, '.git', 'hooks', 'post-checkout'), `#!/bin/sh\n${body}\n`, { mode: 0o755 })

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-cleanup-')))
    main = path.join(root, 'widgets')
    dest = path.join(root, 'worktrees', 'widgets', 'feat')
    fs.mkdirSync(main)
    git(main, ['init', '-q', '-b', 'main'])
    fs.writeFileSync(path.join(main, 'a.txt'), 'a\n')
    git(main, ['add', '.'])
    git(main, ['commit', '-q', '-m', 'init'])
    service = new SpacesService(path.join(root, 'state.json'), path.join(root, 'worktrees'), quick)
  })

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it('removes a checkout that is not whole, with its branch and registration, and a retry succeeds', async () => {
    const repo = await service.add(main)
    // A hook that damages the checkout before stalling: the checkout is then neither clean nor complete.
    hook('rm -f a.txt; sleep 30')
    const error = await service.addWorktreeSpace(repo.id, 'feat').catch((e: unknown) => e)
    expect(error).toMatchObject({ code: ERROR_CODES.gitTimedOut })
    expect((error as Error).message).toContain('removed')
    expect(fs.existsSync(dest)).toBe(false)
    expect(branches()).toEqual(['main'])
    expect(worktrees()).not.toContain(dest)
    hook('exit 0')
    const created = await service.addWorktreeSpace(repo.id, 'feat')
    expect(created.path).toBe(dest)
    expect(fs.readFileSync(path.join(dest, 'a.txt'), 'utf8')).toBe('a\n')
  })

  it('keeps a complete checkout whose only problem was a slow hook, and says so', async () => {
    const repo = await service.add(main)
    hook('sleep 30')
    const error = await service.addWorktreeSpace(repo.id, 'feat').catch((e: unknown) => e)
    expect(error).toMatchObject({ code: ERROR_CODES.gitTimedOut })
    expect((error as Error).message).toContain(`complete and was kept at ${dest}`)
    expect(fs.readFileSync(path.join(dest, 'a.txt'), 'utf8')).toBe('a\n')
    expect(branches()).toContain('feat')
  })

  it('never deletes a branch that existed before, only the checkout', async () => {
    git(main, ['branch', 'feat'])
    const before = git(main, ['rev-parse', 'feat'])
    const repo = await service.add(main)
    hook('rm -f a.txt; sleep 30')
    const error = await service.addWorktreeSpace(repo.id, 'feat').catch((e: unknown) => e)
    expect(error).toMatchObject({ code: ERROR_CODES.gitTimedOut })
    expect(branches()).toContain('feat')
    expect(git(main, ['rev-parse', 'feat'])).toBe(before)
    expect(fs.existsSync(dest)).toBe(false)
    expect(worktrees()).not.toContain(dest)
  })
})

describe('the cleanup call sequence, with a fake runner', () => {
  let root: string
  let main: string
  let dest: string
  let calls: { args: string[]; cwd: string; options?: GitOptions }[]
  let branchExists: boolean
  let refsReadFails: boolean
  let status: string
  let stubborn: boolean

  const run: GitRun = async (args, cwd, options) => {
    calls.push({ args, cwd, options })
    if (args[0] === 'for-each-ref') {
      if (refsReadFails) throw new GitError('timed out', false, true)
      return branchExists ? 'refs/heads/feat\n' : ''
    }
    if (args[0] === 'worktree' && args[1] === 'list') return `worktree ${main}\nHEAD abc\nbranch refs/heads/main\n`
    if (args[0] === 'worktree' && args[1] === 'add') {
      fs.mkdirSync(dest, { recursive: true })
      throw new GitError('timed out', false, true)
    }
    if (args[0] === 'status') return status
    if (args[0] === 'symbolic-ref') return 'refs/heads/feat\n'
    if (stubborn && (args[0] === 'branch' || (args[0] === 'worktree' && args[1] === 'remove'))) throw new GitError('fatal: locked', false)
    if (args[0] === 'branch' && args[1] === '-D') branchExists = false
    return 'abc\n'
  }
  const write = () => calls.filter((c) => c.options?.kind === 'write').map((c) => c.args.slice(0, 2).join(' '))
  const create = async () => {
    const service = new SpacesService(path.join(root, 'state.json'), path.join(root, 'worktrees'), run)
    const repo = await service.add(main)
    return service.addWorktreeSpace(repo.id, 'feat').then(() => new Error("created"), (e: unknown) => e as Error)
  }

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-cleanup-fake-')))
    main = path.join(root, 'widgets')
    dest = path.join(root, 'worktrees', 'widgets', 'feat')
    fs.mkdirSync(main)
    calls = []
    branchExists = false
    refsReadFails = false
    stubborn = false
    status = ' D a.txt\n'
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it('removes the checkout, prunes, then deletes the branch it created', async () => {
    const error = await create()
    expect(error).toMatchObject({ code: ERROR_CODES.gitTimedOut, message: expect.stringContaining('removed') })
    expect(write()).toEqual(['worktree add', 'worktree remove', 'worktree prune', 'branch -D'])
    expect(calls.find((c) => c.args[1] === 'remove')!.args).toEqual(['worktree', 'remove', '-f', '-f', dest])
    expect(calls.find((c) => c.args[0] === 'branch')!.args).toEqual(['branch', '-D', 'feat'])
    expect(fs.existsSync(dest)).toBe(false)
  })

  it('keeps a pre-existing branch: no branch delete', async () => {
    branchExists = true
    await create()
    expect(write()).toEqual(['worktree add', 'worktree remove', 'worktree prune'])
  })

  it('keeps a complete checkout and deletes nothing', async () => {
    status = ''
    const error = await create()
    expect(error.message).toContain(`complete and was kept at ${dest}`)
    expect(write()).toEqual(['worktree add'])
    expect(fs.existsSync(dest)).toBe(true)
  })

  it('names the leftover branch when cleanup fails', async () => {
    stubborn = true
    branchExists = true
    // The branch exists after the create, but did not before: the first read says missing, later reads say present.
    let reads = 0
    const flaky: GitRun = async (args, cwd, options) => {
      if (args[0] === 'for-each-ref') return reads++ === 0 ? '' : 'refs/heads/feat\n'
      return run(args, cwd, options)
    }
    const service = new SpacesService(path.join(root, 'state.json'), path.join(root, 'worktrees'), flaky)
    const repo = await service.add(main)
    const error = await service.addWorktreeSpace(repo.id, 'feat').then(() => new Error("created"), (e: unknown) => e as Error)
    expect(error.message).toContain('cleanup failed')
    expect(error.message).toContain('the branch feat')
  })

  it('cannot tell whether the branch existed: creates nothing and deletes nothing', async () => {
    refsReadFails = true
    const error = await create()
    expect(error.message).toContain("couldn't read git state")
    expect(write()).toEqual([])
    expect(calls.some((c) => c.args[0] === 'branch')).toBe(false)
  })
})
