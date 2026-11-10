import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { diffBases, pushRecentBase } from './bases.ts'
import { computeDiff, diffAllModes } from './compute.ts'
import { gitArgv, gitEnv, resolveBase, runGit } from './git.ts'
import { parseUnifiedDiff } from './parse.ts'

const git = (cwd: string, args: string[]) =>
  execFileSync('git', ['-c', 'user.name=grove', '-c', 'user.email=grove@example.invalid', ...args], { cwd, stdio: 'pipe' }).toString()

describe('diff computation', () => {
  let root: string
  let repo: string

  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
    fs.writeFileSync(path.join(repo, file), text)
  }
  const commit = (message: string) => {
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-q', '-m', message])
  }

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gn-diff-')))
    repo = path.join(root, 'repo')
    fs.mkdirSync(repo)
    git(repo, ['init', '-q', '-b', 'main'])
    write('a.txt', 'one\ntwo\n')
    commit('init')
  })

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it('shows the work on a branch since it forked from main, committed or not, plus untracked files', async () => {
    git(repo, ['checkout', '-q', '-b', 'feature'])
    write('a.txt', 'one\ntwo\nthree\n')
    commit('add three')
    write('b.txt', 'new\n')
    const result = await computeDiff({ dir: repo, mode: 'branch' })
    expect(result.state).toBe('ok')
    expect(result.compared).toMatchObject({ base: 'main', defaultBase: 'main', onDefault: false, noDefault: false })
    expect(result.files.map((file) => [file.path, file.status, file.additions, file.deletions])).toEqual([
      ['a.txt', 'modified', 1, 0],
      ['b.txt', 'untracked', 1, 0],
    ])
    expect(result.files[0].hunks[0].lines.map((line) => [line.kind, line.text])).toContainEqual(['add', 'three'])
    expect((await computeDiff({ dir: repo, mode: 'branch', showUntracked: false })).files.map((file) => file.path)).toEqual(['a.txt'])
  })

  it('uncommitted is against HEAD, last-commit is HEAD against its parent without untracked files', async () => {
    git(repo, ['checkout', '-q', '-b', 'feature'])
    write('a.txt', 'one\ntwo\nthree\n')
    commit('add three')
    write('a.txt', 'one\ntwo\nthree\nfour\n')
    write('b.txt', 'new\n')
    const uncommitted = await computeDiff({ dir: repo, mode: 'uncommitted' })
    expect(uncommitted.files.map((file) => [file.path, file.status])).toEqual([
      ['a.txt', 'modified'],
      ['b.txt', 'untracked'],
    ])
    expect(uncommitted.files[0].additions).toBe(1)
    const last = await computeDiff({ dir: repo, mode: 'last-commit' })
    expect(last.files.map((file) => file.path)).toEqual(['a.txt'])
    expect(last.files[0].hunks[0].lines.map((line) => line.text)).toContain('three')
    expect(last.files[0].hunks[0].lines.map((line) => line.text)).not.toContain('four')
  })

  it('says there is nothing to show on the default branch in last-commit and on a branch with no commits of its own', async () => {
    expect((await computeDiff({ dir: repo, mode: 'last-commit' })).compared.onDefault).toBe(true)
    git(repo, ['checkout', '-q', '-b', 'fresh'])
    const result = await computeDiff({ dir: repo, mode: 'last-commit' })
    expect(result.files).toEqual([])
    expect(result.compared.noOwnCommits).toBe(true)
  })

  it('counts the files of every mode and returns the one asked for', async () => {
    git(repo, ['checkout', '-q', '-b', 'feature'])
    write('c.txt', 'c\n')
    commit('c')
    write('a.txt', 'changed\n')
    const result = await diffAllModes({ dir: repo, mode: 'uncommitted' })
    expect(result.compared.mode).toBe('uncommitted')
    expect(result.counts).toEqual({ branch: 2, uncommitted: 1, 'last-commit': 1 })
  })

  it('diffs against an explicit base, resolved to a commit', async () => {
    git(repo, ['branch', 'old'])
    write('a.txt', 'one\n')
    commit('drop two')
    const result = await computeDiff({ dir: repo, mode: 'branch', base: 'old' })
    expect(result.compared.base).toBe('old')
    expect(result.files.map((file) => file.path)).toEqual(['a.txt'])
  })

  it('refuses a base that starts with a dash, before git sees it', async () => {
    const calls: string[][] = []
    const spy = (args: string[], cwd: string) => {
      calls.push(args)
      return runGit(args, cwd)
    }
    const result = await computeDiff({ dir: repo, mode: 'branch', base: '--output=/tmp/gn-evil', git: spy })
    expect(result.state).toBe('error')
    expect(result.error).toContain('not a valid base')
    expect(calls.flat().some((arg) => arg.includes('gn-evil'))).toBe(false)
    expect(fs.existsSync('/tmp/gn-evil')).toBe(false)
    await expect(resolveBase(runGit, repo, '-p')).rejects.toThrow('not a valid base')
  })

  it('passes only the resolved SHA onward, and says so when a base is not in the repo', async () => {
    const sha = git(repo, ['rev-parse', 'HEAD']).trim()
    await expect(resolveBase(runGit, repo, 'main')).resolves.toBe(sha)
    await expect(resolveBase(runGit, repo, 'nope')).rejects.toThrow('nope is not a branch or commit')
    const diffCalls: string[][] = []
    git(repo, ['checkout', '-q', '-b', 'feature'])
    await computeDiff({
      dir: repo,
      mode: 'branch',
      base: 'main',
      git: (args, cwd) => {
        if (args.includes('diff')) diffCalls.push(args)
        return runGit(args, cwd)
      },
    })
    expect(diffCalls).toHaveLength(1)
    expect(diffCalls[0]).toContain(sha)
    expect(diffCalls[0]).not.toContain('main')
  })

  it('works through a symlink to the folder, scoped to a subfolder of the repo', async () => {
    write('pkg/x.txt', 'x\n')
    commit('pkg')
    write('pkg/x.txt', 'x2\n')
    write('a.txt', 'changed\n')
    const link = path.join(root, 'link')
    fs.symlinkSync(path.join(repo, 'pkg'), link)
    const result = await computeDiff({ dir: fs.realpathSync(link), mode: 'uncommitted' })
    expect(result.files.map((file) => file.path)).toEqual(['pkg/x.txt'])
    expect(result.root).toBe(repo)
  })

  it('does not follow an untracked symlink', async () => {
    fs.writeFileSync(path.join(root, 'secret.txt'), 'top secret\n')
    fs.symlinkSync(path.join(root, 'secret.txt'), path.join(repo, 'peek'))
    const file = (await computeDiff({ dir: repo, mode: 'uncommitted' })).files.find((candidate) => candidate.path === 'peek')!
    expect(file.hunks).toEqual([])
    expect(file.binary).toBe(true)
  })

  it('never runs diff.external, a textconv driver or a clean filter from the repo config', async () => {
    const marker = path.join(root, 'ran')
    const script = path.join(root, 'evil.sh')
    fs.writeFileSync(script, `#!/bin/sh\necho ran >> '${marker}'\ncat "$1" 2>/dev/null\n`, { mode: 0o755 })
    git(repo, ['config', 'diff.external', script])
    git(repo, ['config', 'diff.evil.textconv', script])
    git(repo, ['config', 'filter.evil.clean', `${script} %f`])
    git(repo, ['config', 'filter.evil.process', script])
    git(repo, ['config', 'core.fsmonitor', script])
    git(repo, ['config', 'core.pager', script])
    write('.gitattributes', '*.txt diff=evil filter=evil\n')
    fs.rmSync(marker, { force: true })
    write('a.txt', 'one\nchanged\n')
    const result = await computeDiff({ dir: repo, mode: 'uncommitted' })
    expect(result.state).toBe('ok')
    expect(result.files.find((file) => file.path === 'a.txt')!.additions).toBe(1)
    expect(fs.existsSync(marker)).toBe(false)
  })

  it('reports a folder outside git, and a missing folder, without throwing', async () => {
    const plain = path.join(root, 'plain')
    fs.mkdirSync(plain)
    const none = await computeDiff({ dir: plain, mode: 'branch' })
    expect(none.state).toBe('not-git')
    expect(none.files).toEqual([])
    expect((await computeDiff({ dir: path.join(root, 'gone'), mode: 'branch' })).state).toBe('error')
  })

  it('lists a repo with no commits yet as untracked files', async () => {
    const fresh = path.join(root, 'fresh')
    fs.mkdirSync(fresh)
    git(fresh, ['init', '-q', '-b', 'main'])
    fs.writeFileSync(path.join(fresh, 'x.txt'), 'x\n')
    const result = await computeDiff({ dir: fresh, mode: 'branch' })
    expect(result.state).toBe('ok')
    expect(result.files.map((file) => [file.path, file.status])).toEqual([['x.txt', 'untracked']])
  })

  it('cuts a file over 1 MB to its counts and lists a binary untracked file without lines', async () => {
    write('big.txt', `${'x'.repeat(100)}\n`.repeat(11_000))
    write('bin.dat', 'a\0b')
    const result = await computeDiff({ dir: repo, mode: 'uncommitted' })
    const big = result.files.find((file) => file.path === 'big.txt')!
    expect(big).toMatchObject({ truncated: true, hunks: [] })
    expect(result.files.find((file) => file.path === 'bin.dat')).toMatchObject({ binary: true, hunks: [] })
  })

  it('lists branches, the current one and the default for the picker', async () => {
    git(repo, ['checkout', '-q', '-b', 'feature/x'])
    git(repo, ['branch', 'other'])
    expect(await diffBases(repo)).toEqual({ branches: ['feature/x', 'main', 'other'], current: 'feature/x', default: 'main' })
    expect(await diffBases(path.join(root, 'gone'))).toEqual({ branches: [], current: null, default: null })
  })
})

describe('git calls', () => {
  it('put the read-only hardening before the subcommand, and drop GIT_EXTERNAL_DIFF from the environment', () => {
    const argv = gitArgv(['diff', '--no-ext-diff'])
    expect(argv.slice(0, 8)).toEqual(['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.pager=cat', '-c', 'core.quotePath=false'])
    expect(argv.slice(-2)).toEqual(['diff', '--no-ext-diff'])
    const env = gitEnv({ GIT_EXTERNAL_DIFF: 'x', PATH: '/bin' })
    expect(env).toMatchObject({ GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C', GIT_PAGER: 'cat', PATH: '/bin' })
    expect('GIT_EXTERNAL_DIFF' in env).toBe(false)
  })
})

describe('recent bases', () => {
  it('keeps the newest first, without duplicates, five at most', () => {
    expect(pushRecentBase(['a', 'b'], 'b')).toEqual(['b', 'a'])
    expect(pushRecentBase(['a', 'b', 'c', 'd', 'e'], 'f')).toEqual(['f', 'a', 'b', 'c', 'd'])
  })
})

describe('unified diff parsing', () => {
  it('numbers lines and keeps a body line that looks like a header', () => {
    const [file] = parseUnifiedDiff(
      ['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -1,2 +1,2 @@', ' keep', '--- gone', '+++ added', ''].join('\n'),
    )
    expect(file.hunks[0].lines).toEqual([
      { kind: 'context', text: 'keep', old: 1, new: 1 },
      { kind: 'del', text: '-- gone', old: 2, new: null },
      { kind: 'add', text: '++ added', old: null, new: 2 },
    ])
  })
})
