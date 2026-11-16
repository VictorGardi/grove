import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listWorktrees, spaceGitInfo } from './git.ts'
import { gitArgv, gitEnv, GitError, type GitOptions, type GitRun } from './gitrun.ts'

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

  it('does not call a subfolder of a repo a linked worktree, in a main checkout or in a worktree', async () => {
    const main = path.join(root, 'widgets')
    const worktree = path.join(root, 'widgets-feature')
    fs.mkdirSync(path.join(main, 'skills'), { recursive: true })
    git(main, ['init', '-q', '-b', 'main'])
    fs.writeFileSync(path.join(main, 'skills', 'a.txt'), 'a')
    git(main, ['add', '.'])
    git(main, ['commit', '-q', '-m', 'init'])
    git(main, ['worktree', 'add', '-q', '-b', 'feature', worktree])
    await expect(spaceGitInfo(path.join(main, 'skills'))).resolves.toMatchObject({ mainPath: main, linked: false })
    await expect(spaceGitInfo(path.join(worktree, 'skills'))).resolves.toMatchObject({ mainPath: main, linked: false })
  })

  it('names the main repo for a linked worktree, and the branch of each', async () => {
    const main = path.join(root, 'widgets')
    const worktree = path.join(root, 'widgets-feature')
    fs.mkdirSync(main)
    git(main, ['init', '-q', '-b', 'main'])
    git(main, ['commit', '-q', '--allow-empty', '-m', 'init'])
    git(main, ['worktree', 'add', '-q', '-b', 'feature', worktree])

    await expect(spaceGitInfo(worktree)).resolves.toEqual({ repoName: 'widgets', mainPath: main, branch: 'feature', linked: true })
    await expect(spaceGitInfo(main)).resolves.toEqual({ repoName: 'widgets', mainPath: main, branch: 'main', linked: false })
  })

  it('gives a null branch for a detached HEAD', async () => {
    const main = path.join(root, 'widgets')
    fs.mkdirSync(main)
    git(main, ['init', '-q', '-b', 'main'])
    git(main, ['commit', '-q', '--allow-empty', '-m', 'init'])
    git(main, ['checkout', '-q', '--detach'])

    await expect(spaceGitInfo(main)).resolves.toEqual({ repoName: 'widgets', mainPath: main, branch: null, linked: false })
  })

  it('shows the name of an unborn branch', async () => {
    const main = path.join(root, 'widgets')
    fs.mkdirSync(main)
    git(main, ['init', '-q', '-b', 'fresh'])

    await expect(spaceGitInfo(main)).resolves.toEqual({ repoName: 'widgets', mainPath: main, branch: 'fresh', linked: false })
  })

  it('gives nulls outside a git repo', async () => {
    const plain = path.join(root, 'plain')
    fs.mkdirSync(plain)
    expect(await spaceGitInfo(plain)).toEqual({ repoName: null, mainPath: null, branch: null, linked: false })
  })
})

// A pure fake: records every call and answers from `reply`.
function fakeGit(reply: (args: string[]) => string | Error) {
  const calls: { args: string[]; cwd: string; options?: GitOptions }[] = []
  const run: GitRun = async (args, cwd, options) => {
    calls.push({ args, cwd, options })
    const out = reply(args)
    if (out instanceof Error) throw out
    return out
  }
  return { run, calls }
}

describe('reads through an injected GitRun', () => {
  const listing = 'worktree /r/widgets\nHEAD abc\nbranch refs/heads/main\n\nworktree /r/other\nHEAD def\nbranch refs/heads/x\n'

  it('spaceGitInfo asks for the worktree list and the branch, in the folder, as reads', async () => {
    const fake = fakeGit((args) => (args[0] === 'worktree' ? listing : 'main\n'))
    await expect(spaceGitInfo('/r/other', fake.run)).resolves.toEqual({ repoName: 'widgets', mainPath: '/r/widgets', branch: 'main', linked: true })
    expect(fake.calls.map((c) => c.args)).toEqual([['worktree', 'list', '--porcelain'], ['symbolic-ref', '--short', '-q', 'HEAD']])
    expect(fake.calls.every((c) => c.cwd === '/r/other' && (c.options?.kind ?? 'read') === 'read')).toBe(true)
  })

  it('spaceGitInfo gives nulls on any error, and a null branch when symbolic-ref fails', async () => {
    await expect(spaceGitInfo('/x', fakeGit(() => new GitError('timed out', false, true)).run)).resolves.toEqual({ repoName: null, mainPath: null, branch: null, linked: false })
    const detached = fakeGit((args) => (args[0] === 'worktree' ? listing : new GitError('', false)))
    await expect(spaceGitInfo('/r/widgets', detached.run)).resolves.toMatchObject({ repoName: 'widgets', branch: null })
  })

  it('listWorktrees parses the list through the fake', async () => {
    const fake = fakeGit(() => listing)
    await expect(listWorktrees('/r/widgets', fake.run)).resolves.toEqual([
      { path: '/r/widgets', branch: 'main' },
      { path: '/r/other', branch: 'x' },
    ])
  })

  it('a read runs without hooks, pager or fsmonitor, in English, with no optional locks', () => {
    const argv = gitArgv(['status'])
    expect(argv).toEqual(expect.arrayContaining(['core.fsmonitor=false', 'core.hooksPath=/dev/null', 'core.pager=cat']))
    expect(argv.at(-1)).toBe('status')
    const env = gitEnv({ PATH: '/bin' })
    expect(env).toMatchObject({ LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' })
  })

  it('a write keeps hooks but not fsmonitor, prompts or the language', () => {
    const argv = gitArgv(['worktree', 'add'], 'write')
    expect(argv).toContain('core.fsmonitor=false')
    expect(argv.join(' ')).not.toContain('hooksPath')
    expect(gitEnv({}, 'write')).toMatchObject({ LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' })
    expect(gitEnv({}, 'write')).not.toHaveProperty('GIT_OPTIONAL_LOCKS')
  })
})
