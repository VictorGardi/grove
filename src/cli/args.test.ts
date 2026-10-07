import { describe, expect, it } from 'vitest'
import { parseCommand, UsageError } from './args'

describe('parseCommand', () => {
  it('parses ls and its flags', () => {
    expect(parseCommand(['ls'])).toEqual({ cmd: 'ls', all: false, json: false })
    expect(parseCommand(['ls', '--all', '--json'])).toEqual({ cmd: 'ls', all: true, json: true })
  })

  it('returns a UsageError for no command, an unknown command or flag, and extra arguments', () => {
    for (const argv of [[], ['nope'], ['ls', '--wat'], ['ls', 'x']]) {
      expect(parseCommand(argv)).toBeInstanceOf(UsageError)
    }
  })
})
