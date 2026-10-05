import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readBranch } from './git'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'grove-git-'))

describe('readBranch', () => {
  it('reads the branch of the nearest repo above a directory', () => {
    const repo = tmp()
    fs.mkdirSync(path.join(repo, '.git'))
    fs.writeFileSync(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/feature/x\n')
    fs.mkdirSync(path.join(repo, 'a', 'b'), { recursive: true })
    expect(readBranch(path.join(repo, 'a', 'b'))).toBe('feature/x')
  })

  it('follows a worktree .git file', () => {
    const root = tmp()
    const gitdir = path.join(root, 'main', '.git', 'worktrees', 'wt')
    fs.mkdirSync(gitdir, { recursive: true })
    fs.writeFileSync(path.join(gitdir, 'HEAD'), 'ref: refs/heads/wt-branch\n')
    fs.mkdirSync(path.join(root, 'wt'))
    fs.writeFileSync(path.join(root, 'wt', '.git'), 'gitdir: ../main/.git/worktrees/wt\n')
    expect(readBranch(path.join(root, 'wt'))).toBe('wt-branch')
  })

  it('shows a detached HEAD as a short hash', () => {
    const repo = tmp()
    fs.mkdirSync(path.join(repo, '.git'))
    fs.writeFileSync(path.join(repo, '.git', 'HEAD'), '0123456789abcdef0123456789abcdef01234567\n')
    expect(readBranch(repo)).toBe('0123456')
  })

  it('is null outside a repo or for a missing directory', () => {
    expect(readBranch(tmp())).toBeNull()
    expect(readBranch(path.join(tmp(), 'missing'))).toBeNull()
  })
})
