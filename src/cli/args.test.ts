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
    })
    expect(parseCommand(['new', 'terminal'])).toMatchObject({ cmd: 'new', kind: 'terminal', json: false })
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
