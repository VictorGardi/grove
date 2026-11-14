import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GitError, type GitRun } from './gitrun.ts'
import { SpacesService } from './spaces.ts'

const listing = (main: string) => `worktree ${main}\nHEAD abc\nbranch refs/heads/main\n`

describe('refresh keeps the last known git state', () => {
  let root: string
  let dir: string
  let failure: Error | undefined
  let branch: string
  let service: SpacesService

  const run: GitRun = async (args, cwd) => {
    if (failure) throw failure
    return args[0] === 'worktree' ? listing(cwd) : `${branch}\n`
  }

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-refresh-')))
    dir = path.join(root, 'widgets')
    fs.mkdirSync(dir)
    failure = undefined
    branch = 'main'
    service = new SpacesService(path.join(root, 'state.json'), path.join(root, 'worktrees'), run)
  })

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it('keeps repo and branch through a timeout and through another failure', async () => {
    const space = await service.add(dir)
    expect(space).toMatchObject({ repoName: 'widgets', branch: 'main' })
    for (failure of [new GitError('timed out', false, true), new GitError('boom', false)]) {
      expect(await service.spaceInfo(space.id)).toEqual(space)
    }
  })

  it('clears it when git says not a git repository', async () => {
    const space = await service.add(dir)
    failure = new GitError('fatal: not a git repository', true)
    expect(await service.spaceInfo(space.id)).toMatchObject({ repoName: null, branch: null, parent: null, worktree: false })
    failure = new GitError('timed out', false, true)
    expect((await service.spaceInfo(space.id))?.repoName).toBeNull()
  })

  it('clears it when the folder is gone', async () => {
    const space = await service.add(dir)
    fs.rmSync(dir, { recursive: true })
    expect(await service.spaceInfo(space.id)).toMatchObject({ repoName: null, branch: null })
  })

  it('gives nulls for a failing first read and retries next time, without caching the failure', async () => {
    failure = new GitError('timed out', false, true)
    const space = await service.add(dir)
    expect(space).toMatchObject({ repoName: null, branch: null })
    failure = undefined
    expect(await service.spaceInfo(space.id)).toMatchObject({ repoName: 'widgets', branch: 'main' })
  })

  it('follows a branch change after a blip', async () => {
    const space = await service.add(dir)
    failure = new GitError('timed out', false, true)
    await service.spaceInfo(space.id)
    failure = undefined
    branch = 'next'
    expect((await service.spaceInfo(space.id))?.branch).toBe('next')
  })

  it('a timeout reading only the branch keeps the last branch instead of showing detached', async () => {
    let slow = false
    const svc = new SpacesService(path.join(root, 'b.json'), path.join(root, 'w'), async (args, cwd) => {
      if (args[0] === 'worktree') return listing(cwd)
      if (slow) throw new GitError('timed out', false, true)
      return 'main\n'
    })
    const space = await svc.add(dir)
    slow = true
    expect((await svc.spaceInfo(space.id))?.branch).toBe('main')
  })

  it('reads each space independently: a slow one does not hold up the other', async () => {
    const other = path.join(root, 'other')
    fs.mkdirSync(other)
    let hold = false
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const svc = new SpacesService(path.join(root, 'g.json'), path.join(root, 'w'), async (args, cwd) => {
      if (hold && cwd === dir) await gate
      return args[0] === 'worktree' ? listing(cwd) : 'main\n'
    })
    const slow = await svc.add(dir)
    const fast = await svc.add(other)
    hold = true
    const slowRead = svc.spaceInfo(slow.id)
    expect((await svc.spaceInfo(fast.id))?.repoName).toBe('other')
    release()
    expect((await slowRead)?.repoName).toBe('widgets')
  })
})
