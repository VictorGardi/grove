import { describe, expect, it } from 'vitest'
import { parseCommand, UsageError } from './args'

describe('parseCommand', () => {
  it('parses ls and its flags', () => {
    expect(parseCommand(['ls'])).toEqual({ cmd: 'ls', all: false, json: false })
    expect(parseCommand(['ls', '--all', '--json'])).toEqual({ cmd: 'ls', all: true, json: true })
  })

  it('parses new with its flags', () => {
    expect(parseCommand(['new', 'claude', '--cwd', '/x', '--prompt', '-', '--label', 'h', '--link', 'f-1', '--json'])).toEqual({
      cmd: 'new', kind: 'claude', cwd: '/x', prompt: '-', label: 'h', link: 'f-1', json: true,
    })
    expect(parseCommand(['new', 'terminal'])).toMatchObject({ cmd: 'new', kind: 'terminal', json: false })
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
