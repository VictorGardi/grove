import type { CliSession } from '@shared/cli'
import { describe, expect, it } from 'vitest'
import { exitCode, formatError, formatLs } from './output'

const s = (over: Partial<CliSession>): CliSession => ({
  id: 'aaaaaaaa-1111', kind: 'opencode', label: 'one', status: 'working', waitingFor: null,
  lastStatus: 'running', project: 'proj', cwd: '/p', feature: null, ...over,
})

describe('formatLs', () => {
  it('prints a table and marks the caller', () => {
    const out = formatLs([s({}), s({ id: 'bbbbbbbb-2222', kind: 'terminal', status: null, label: 'two', feature: 'f-1' })], 'bbbbbbbb-2222', false)
    expect(out.split('\n')).toEqual([
      '  ID       KIND     STATUS  LABEL PROJECT FEATURE',
      '  aaaaaaaa opencode working one   proj',
      '* bbbbbbbb terminal running two   proj    f-1',
    ])
  })

  it('prints only the header for no sessions', () => {
    expect(formatLs([], null, false).split('\n')).toHaveLength(1)
  })

  it('prints the objects with --json', () => {
    expect(JSON.parse(formatLs([s({})], null, true))).toEqual([s({})])
  })
})

describe('exit codes and errors', () => {
  it('maps replies to exit codes', () => {
    expect(exitCode({ id: '1', ok: true, data: null })).toBe(0)
    expect(exitCode({ id: '1', ok: false, error: { code: 'not-running', message: 'x' } })).toBe(3)
    expect(exitCode({ id: '1', ok: false, error: { code: 'not-found', message: 'x' } })).toBe(1)
  })

  it('formats errors', () => {
    expect(formatError({ code: 'not-running', message: 'x' })).toBe('grove: the Grove app is not running')
    expect(formatError({ code: 'not-found', message: 'no such session' })).toBe('grove: not-found: no such session')
  })
})
