import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_FILE_BYTES } from './compute.ts'
import { readNewSide } from './file.ts'

const git = (cwd: string, args: string[]) =>
  execFileSync('git', ['-c', 'user.name=grove', '-c', 'user.email=grove@example.invalid', ...args], { cwd, stdio: 'pipe' }).toString()

describe('the new side of a file, for the preview', () => {
  let root: string
  let repo: string

  const write = (file: string, text: string | Buffer) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
    fs.writeFileSync(path.join(repo, file), text)
  }
  const commit = (message: string) => {
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-q', '-m', message])
  }

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gn-file-')))
    repo = path.join(root, 'repo')
    fs.mkdirSync(repo)
    git(repo, ['init', '-q', '-b', 'main'])
    write('notes.md', '# one\n')
    commit('init')
  })

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it('reads the working tree in branch and uncommitted mode, edits not yet committed included', async () => {
    write('notes.md', '# one\n\nedited\n')
    for (const mode of ['branch', 'uncommitted'] as const) {
      expect(await readNewSide({ dir: repo, mode, file: 'notes.md' })).toEqual({ state: 'ok', text: '# one\n\nedited\n' })
    }
  })

  it('reads an untracked file from the working tree', async () => {
    write('new.md', 'fresh\n')
    expect(await readNewSide({ dir: repo, mode: 'uncommitted', file: 'new.md' })).toEqual({ state: 'ok', text: 'fresh\n' })
  })

  it('reads HEAD in last-commit mode, not what the working tree has become since', async () => {
    write('notes.md', '# committed\n')
    commit('second')
    write('notes.md', '# edited after\n')
    expect(await readNewSide({ dir: repo, mode: 'last-commit', file: 'notes.md' })).toEqual({ state: 'ok', text: '# committed\n' })
  })

  it('has nothing for a file that is not in HEAD in last-commit mode, or that is gone from disk', async () => {
    write('new.md', 'fresh\n')
    expect(await readNewSide({ dir: repo, mode: 'last-commit', file: 'new.md' })).toEqual({ state: 'missing', text: null })
    fs.rmSync(path.join(repo, 'notes.md'))
    expect(await readNewSide({ dir: repo, mode: 'uncommitted', file: 'notes.md' })).toEqual({ state: 'missing', text: null })
  })

  it('refuses a file over the size cap, in the working tree and in HEAD', async () => {
    write('big.md', 'x'.repeat(MAX_FILE_BYTES + 1))
    expect(await readNewSide({ dir: repo, mode: 'uncommitted', file: 'big.md' })).toEqual({ state: 'too-large', text: null })
    commit('big')
    expect(await readNewSide({ dir: repo, mode: 'last-commit', file: 'big.md' })).toEqual({ state: 'too-large', text: null })
  })

  it('does not return a binary file as text', async () => {
    write('odd.md', Buffer.from([0x23, 0x20, 0x00, 0x01]))
    expect(await readNewSide({ dir: repo, mode: 'uncommitted', file: 'odd.md' })).toEqual({ state: 'binary', text: null })
    commit('odd')
    expect(await readNewSide({ dir: repo, mode: 'last-commit', file: 'odd.md' })).toEqual({ state: 'binary', text: null })
  })

  it('reads a path from the repo root even when the folder is a subfolder', async () => {
    write('pkg/readme.md', 'in pkg\n')
    expect(await readNewSide({ dir: path.join(repo, 'pkg'), mode: 'uncommitted', file: 'pkg/readme.md' })).toEqual({ state: 'ok', text: 'in pkg\n' })
  })

  it('never reads outside the repo: not a path that climbs, an absolute one, or a link', async () => {
    fs.writeFileSync(path.join(root, 'secret.md'), 'secret\n')
    fs.symlinkSync(path.join(root, 'secret.md'), path.join(repo, 'link.md'))
    fs.symlinkSync(root, path.join(repo, 'outside'))
    for (const file of ['../secret.md', path.join(root, 'secret.md'), 'link.md', 'outside/secret.md', '-p', '']) {
      for (const mode of ['uncommitted', 'last-commit'] as const) {
        expect(await readNewSide({ dir: repo, mode, file })).toEqual({ state: 'missing', text: null })
      }
    }
  })

  it('has nothing in a folder that is not a repo', async () => {
    expect(await readNewSide({ dir: root, mode: 'uncommitted', file: 'notes.md' })).toEqual({ state: 'missing', text: null })
  })
})
