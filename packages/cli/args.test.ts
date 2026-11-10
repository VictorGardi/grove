import { describe, expect, it } from 'vitest'
import { parseCommand, UsageError } from './args.ts'

describe('parseCommand', () => {
  it('parses ls and its flag', () => {
    expect(parseCommand(['ls'])).toEqual({ cmd: 'ls', json: false })
    expect(parseCommand(['ls', '--json'])).toEqual({ cmd: 'ls', json: true })
  })

  it('parses space add and space ls', () => {
    expect(parseCommand(['space', 'add'])).toEqual({ cmd: 'space-add', path: undefined })
    expect(parseCommand(['space', 'add', '/x'])).toEqual({ cmd: 'space-add', path: '/x' })
    expect(parseCommand(['space', 'ls'])).toEqual({ cmd: 'space-ls' })
    for (const argv of [['space'], ['space', 'add', 'a', 'b'], ['space', 'ls', 'x'], ['space', 'rm']]) {
      expect(parseCommand(argv)).toBeInstanceOf(UsageError)
    }
  })

  it('parses new with its flags', () => {
    expect(parseCommand(['new', 'claude', '--cwd', '/x', '--prompt', '-', '--label', 'h', '--json'])).toEqual({
      cmd: 'new', kind: 'claude', cwd: '/x', prompt: '-', label: 'h', json: true, wait: false, timeoutS: undefined,
    })
    expect(parseCommand(['new', 'terminal'])).toEqual({ cmd: 'new', kind: 'terminal', cwd: undefined, prompt: undefined, label: undefined, json: false, wait: false, timeoutS: undefined })
  })

  it('takes every kind and no others', () => {
    for (const kind of ['terminal', 'claude', 'opencode', 'copilot']) {
      expect(parseCommand(['new', kind])).toMatchObject({ cmd: 'new', kind })
    }
    for (const argv of [['new'], ['new', 'vim'], ['new', 'claude', 'opencode'], ['new', 'status']]) {
      expect(parseCommand(argv)).toBeInstanceOf(UsageError)
    }
  })

  it('does not take the flags that were dropped from the old CLI', () => {
    for (const argv of [
      ['new', 'claude', '--model', 'm1'],
      ['new', 'claude', '--worktree', '--branch', 'fix-auth'],
      ['new', 'claude', '--parent', 'x'],
      ['new', 'claude', '--child'],
      ['new', 'claude', '--link', 'f-1'],
      ['new', 'claude', '--sandboxed'],
      ['ls', '--all'],
      ['read', 'abc', '--all'],
    ]) {
      expect(parseCommand(argv)).toBeInstanceOf(UsageError)
    }
  })

  it('requires a non-empty label when one is given', () => {
    expect(parseCommand(['new', 'terminal', '--label', ''])).toBeInstanceOf(UsageError)
    expect(parseCommand(['new', 'terminal', '--label', 'x'])).toMatchObject({ label: 'x' })
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

  it('parses focus and kill', () => {
    expect(parseCommand(['focus', 'abc'])).toEqual({ cmd: 'focus', ref: 'abc' })
    expect(parseCommand(['kill', 'abc'])).toEqual({ cmd: 'kill', ref: 'abc' })
    for (const argv of [['focus'], ['kill'], ['kill', 'a', 'b']]) expect(parseCommand(argv)).toBeInstanceOf(UsageError)
  })

  it('installs only the Claude hook, and uninstalls Claude or the old Copilot entries', () => {
    expect(parseCommand(['integration', 'install', 'claude'])).toEqual({ cmd: 'integration', action: 'install', agent: 'claude' })
    expect(parseCommand(['integration', 'uninstall', 'claude'])).toEqual({ cmd: 'integration', action: 'uninstall', agent: 'claude' })
    expect(parseCommand(['integration', 'uninstall', 'copilot'])).toEqual({ cmd: 'integration', action: 'uninstall', agent: 'copilot' })
    for (const argv of [['integration', 'install', 'copilot'], ['integration', 'install', 'opencode'], ['integration', 'uninstall', 'opencode'], ['integration', 'install']]) {
      expect(parseCommand(argv)).toBeInstanceOf(UsageError)
    }
  })

  it('parses config path and skill', () => {
    expect(parseCommand(['config', 'path'])).toEqual({ cmd: 'config-path' })
    expect(parseCommand(['skill'])).toEqual({ cmd: 'skill' })
  })

  it('refuses config without path, and extra arguments to config path and skill', () => {
    for (const argv of [['config'], ['config', 'set'], ['config', 'path', 'x'], ['skill', 'x'], ['skill', '--force']]) {
      expect(parseCommand(argv)).toBeInstanceOf(UsageError)
    }
  })

  it('drops status and progress', () => {
    for (const argv of [['status', 'done'], ['progress', 'h', '2/5']]) {
      expect(parseCommand(argv)).toBeInstanceOf(UsageError)
    }
  })

  it('names grove in the usage', () => {
    const bad = parseCommand(['nope'])
    expect(bad).toBeInstanceOf(UsageError)
    expect((bad as UsageError).message).toContain('usage: grove')
  })

  it('returns a UsageError for no command, an unknown command or flag, and extra arguments', () => {
    for (const argv of [[], ['nope'], ['ls', '--wat'], ['ls', 'x']]) {
      expect(parseCommand(argv)).toBeInstanceOf(UsageError)
    }
  })
})

describe('parseCommand, waits', () => {
  it('refuses --wait on a shell tab before anything is started', () => {
    expect(parseCommand(['new', 'terminal', '--wait'])).toBeInstanceOf(UsageError)
    expect(parseCommand(['new', 'claude', '--wait'])).toMatchObject({ cmd: 'new', kind: 'claude', wait: true })
  })
})
