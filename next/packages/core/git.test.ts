import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spaceGitInfo } from './git.ts'

const git = (cwd: string, args: string[]) =>
  execFileSync('git', ['-c', 'user.name=grove', '-c', 'user.email=grove@example.invalid', ...args], {
    cwd,
    stdio: 'pipe',
  }).toString()

describe('spaceGitInfo', () => {
  let root: string

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gn-git-')))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('names the main repo for a linked worktree', async () => {
    const main = path.join(root, 'widgets')
    const worktree = path.join(root, 'widgets-feature')
    fs.mkdirSync(main)
    git(main, ['init', '-q'])
    git(main, ['commit', '-q', '--allow-empty', '-m', 'init'])
    git(main, ['worktree', 'add', '-q', '-b', 'feature', worktree])

    await expect(spaceGitInfo(worktree)).resolves.toEqual({ repoName: 'widgets', mainPath: main })
    await expect(spaceGitInfo(main)).resolves.toEqual({ repoName: 'widgets', mainPath: main })
  })

  it('gives nulls outside a git repo', async () => {
    const plain = path.join(root, 'plain')
    fs.mkdirSync(plain)
    expect(await spaceGitInfo(plain)).toEqual({ repoName: null, mainPath: null })
  })
})
