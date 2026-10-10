import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { gitCommonDir, readBranch } from './git'
import { gitRepo } from './testing/gitRepo'

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

describe('gitCommonDir', () => {
  // A worktree written the way git writes it: a `.git` file pointing at
  // <main>/.git/worktrees/<name>, whose `commondir` names the main repo's .git.
  const fakeRepo = () => {
    const root = tmp()
    const main = path.join(root, 'main')
    fs.mkdirSync(path.join(main, '.git', 'worktrees', 'wt'), { recursive: true })
    fs.writeFileSync(path.join(main, '.git', 'worktrees', 'wt', 'commondir'), '../..\n')
    fs.mkdirSync(path.join(root, 'wt'))
    fs.writeFileSync(path.join(root, 'wt', '.git'), 'gitdir: ../main/.git/worktrees/wt\n')
    return { root, main }
  }

  it('is a checkout\'s own .git directory', () => {
    const repo = tmp()
    fs.mkdirSync(path.join(repo, '.git'))
    expect(gitCommonDir(repo)).toBe(fs.realpathSync(path.join(repo, '.git')))
  })

  it('is the main repo\'s .git for a linked worktree, from a directory inside it', () => {
    const { main, root } = fakeRepo()
    const common = fs.realpathSync(path.join(main, '.git'))
    fs.mkdirSync(path.join(root, 'wt', 'src'))
    expect(gitCommonDir(path.join(root, 'wt'))).toBe(common)
    expect(gitCommonDir(path.join(root, 'wt', 'src'))).toBe(common)
  })

  it('falls back to the gitdir when there is no commondir file', () => {
    const { root } = fakeRepo()
    fs.rmSync(path.join(root, 'main', '.git', 'worktrees', 'wt', 'commondir'))
    expect(gitCommonDir(path.join(root, 'wt'))).toBe(fs.realpathSync(path.join(root, 'main', '.git', 'worktrees', 'wt')))
  })

  it('is null for a .git file that is not a redirect', () => {
    const { root } = fakeRepo()
    fs.writeFileSync(path.join(root, 'wt', '.git'), 'not a redirect\n')
    expect(gitCommonDir(path.join(root, 'wt'))).toBeNull()
  })

  it('is null outside a repo or for a missing directory', () => {
    expect(gitCommonDir(tmp())).toBeNull()
    expect(gitCommonDir(path.join(tmp(), 'missing'))).toBeNull()
  })

  it('agrees with git rev-parse --git-common-dir for a real worktree', () => {
    const repo = gitRepo()
    repo.commit()
    const wt = path.join(tmp(), 'wt')
    repo.git('worktree', 'add', '-q', '-b', 'probe', wt)
    const commonOf = (dir: string) => fs.realpathSync(path.resolve(dir, repo.git('-C', dir, 'rev-parse', '--git-common-dir').trim()))
    expect(gitCommonDir(repo.dir)).toBe(commonOf(repo.dir))
    expect(gitCommonDir(wt)).toBe(commonOf(wt))
    expect(gitCommonDir(wt)).toBe(gitCommonDir(repo.dir))
  })
})
