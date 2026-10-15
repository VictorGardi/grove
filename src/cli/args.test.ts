import { describe, expect, it } from 'vitest'
import { parseCommand, UsageError } from './args'

describe('parseCommand', () => {
  it('parses ls and its flags', () => {
    expect(parseCommand(['ls'])).toEqual({ cmd: 'ls', all: false, json: false })
    expect(parseCommand(['ls', '--all', '--json'])).toEqual({ cmd: 'ls', all: true, json: true })
  })

  it('parses new with its flags', () => {
    expect(parseCommand(['new', 'claude', '--cwd', '/x', '--prompt', '-', '--label', 'h', '--link', 'f-1', '--json'])).toEqual({
      cmd: 'new', kind: 'claude', cwd: '/x', prompt: '-', label: 'h', link: 'f-1', json: true, wait: false, timeoutS: undefined,
      parent: undefined, child: false, worktree: false, branch: undefined, sandboxed: false,
    })
    expect(parseCommand(['new', 'terminal'])).toMatchObject({ cmd: 'new', kind: 'terminal', json: false })
  })

  it('parses --model on claude only, and not empty', () => {
    expect(parseCommand(['new', 'claude', '--model', 'm1'])).toMatchObject({ cmd: 'new', kind: 'claude', model: 'm1' })
    expect(parseCommand(['new', 'claude'])).toMatchObject({ cmd: 'new', model: undefined })
    for (const kind of ['opencode', 'terminal']) expect(parseCommand(['new', kind, '--model', 'm1'])).toBeInstanceOf(UsageError)
    expect(parseCommand(['new', 'claude', '--model', ''])).toBeInstanceOf(UsageError)
  })

  it('parses --sandboxed, only on new', () => {
    expect(parseCommand(['new', 'claude', '--sandboxed'])).toMatchObject({ cmd: 'new', kind: 'claude', sandboxed: true })
    expect(parseCommand(['new', 'claude'])).toMatchObject({ cmd: 'new', sandboxed: false })
    for (const argv of [['ls', '--sandboxed'], ['send', 'a', 'b', '--sandboxed'], ['kill', 'a', '--sandboxed']]) {
      expect(parseCommand(argv)).toBeInstanceOf(UsageError)
    }
  })

  it('parses --parent and --child, which are alternatives', () => {
    expect(parseCommand(['new', 'claude', '--parent', 'slice-1'])).toMatchObject({ parent: 'slice-1', child: false })
    expect(parseCommand(['new', 'claude', '--child'])).toMatchObject({ parent: undefined, child: true })
    expect(parseCommand(['new', 'claude', '--parent', 'x', '--child'])).toBeInstanceOf(UsageError)
  })

  it('parses the worktree pair, and takes no branch without one', () => {
    expect(parseCommand(['new', 'claude', '--worktree', '--branch', 'fix-auth'])).toMatchObject({
      cmd: 'new', kind: 'claude', worktree: true, branch: 'fix-auth',
    })
    for (const argv of [['new', 'claude', '--worktree'], ['new', 'claude', '--branch', 'fix-auth']]) {
      expect(parseCommand(argv)).toBeInstanceOf(UsageError)
    }
  })

  it('parses send and read', () => {
    expect(parseCommand(['send', 'abc', 'hi'])).toEqual({ cmd: 'send', ref: 'abc', text: 'hi', submit: true, wait: false, timeoutS: undefined })
    expect(parseCommand(['send', 'abc', '-', '--no-enter'])).toEqual({ cmd: 'send', ref: 'abc', text: '-', submit: false, wait: false, timeoutS: undefined })
    expect(parseCommand(['read', 'abc'])).toEqual({ cmd: 'read', ref: 'abc', lines: 100 })
    expect(parseCommand(['read', 'abc', '--lines', '40'])).toEqual({ cmd: 'read', ref: 'abc', lines: 40 })
    for (const argv of [['send'], ['send', 'abc'], ['read'], ['read', 'abc', '--lines', 'x'], ['read', 'abc', '--lines', '0']]) {
      expect(parseCommand(argv)).toBeInstanceOf(UsageError)
    }
  })

  it('parses wait and the --wait/--timeout flags', () => {
    expect(parseCommand(['wait', 'abc'])).toEqual({ cmd: 'wait', ref: 'abc', timeoutS: undefined })
    expect(parseCommand(['wait', 'abc', '--timeout', '5'])).toEqual({ cmd: 'wait', ref: 'abc', timeoutS: 5 })
    expect(parseCommand(['send', 'abc', 'hi', '--wait', '--timeout', '9'])).toMatchObject({ cmd: 'send', wait: true, timeoutS: 9 })
    expect(parseCommand(['new', 'claude', '--wait'])).toMatchObject({ cmd: 'new', wait: true, timeoutS: undefined })
    for (const argv of [['wait'], ['wait', 'abc', '--timeout', 'x'], ['wait', 'abc', '--timeout', '0'], ['send', 'a', 'b', '--timeout', '-1']]) {
      expect(parseCommand(argv)).toBeInstanceOf(UsageError)
    }
  })

  it('parses focus, kill and skill', () => {
    expect(parseCommand(['focus', 'abc'])).toEqual({ cmd: 'focus', ref: 'abc' })
    expect(parseCommand(['kill', 'abc'])).toEqual({ cmd: 'kill', ref: 'abc' })
    expect(parseCommand(['skill'])).toEqual({ cmd: 'skill' })
    for (const argv of [['focus'], ['kill'], ['kill', 'a', 'b'], ['skill', 'x']]) expect(parseCommand(argv)).toBeInstanceOf(UsageError)
  })

  it('new needs exactly one known kind', () => {
    for (const argv of [['new'], ['new', 'vim'], ['new', 'claude', 'opencode']]) {
      expect(parseCommand(argv)).toBeInstanceOf(UsageError)
    }
  })

  it('returns a UsageError for no command, an unknown command or flag, and extra arguments', () => {
    for (const argv of [[], ['nope'], ['ls', '--wat'], ['ls', 'x']]) {
      expect(parseCommand(argv)).toBeInstanceOf(UsageError)
    }
  })
})
