import { describe, expect, it } from 'vitest'
import { gitArgv } from './git'

const HARDENING = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null']
const hardened = (args: string[]) => gitArgv(args).join(' ').includes(HARDENING.join(' '))

describe('gitArgv', () => {
  it('hardens the read-only calls Grove makes on its own', () => {
    for (const args of [['status'], ['diff', 'HEAD'], ['ls-files', '-z'], ['rev-parse', 'HEAD'], ['worktree', 'list', '--porcelain']]) {
      expect(hardened(args), args.join(' ')).toBe(true)
    }
  })

  it('leaves explicit actions to the repo’s own hooks', () => {
    for (const args of [['worktree', 'add', '-b', 'x', '/p'], ['submodule', 'update', '--init'], ['worktree', 'remove', '/p']]) {
      expect(hardened(args), args.join(' ')).toBe(false)
    }
  })

  it('puts the flags before the subcommand', () => {
    expect(gitArgv(['status']).slice(-1)).toEqual(['status'])
  })
})
