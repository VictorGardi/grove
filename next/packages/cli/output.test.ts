import { describe, expect, it } from 'vitest'
import { formatError, formatLsJson, formatNew, formatRead, formatTree, spaceHeadings, turnExit, type LsTab } from './output.ts'

const t = (over: Partial<LsTab>): LsTab => ({
  id: 'aaaaaaaa-1111', kind: 'claude', state: 'working', label: 'one', alive: true, spaceId: 'sp_a', spacePath: '/p', ...over,
})

describe('spaceHeadings', () => {
  it('uses the path for the first space of a folder and path#n for the later ones', () => {
    const headings = spaceHeadings([
      { id: 'sp_a', path: '/p' },
      { id: 'sp_b', path: '/q' },
      { id: 'sp_c', path: '/p' },
      { id: 'sp_d', path: '/p' },
    ])
    expect([...headings.values()]).toEqual(['/p', '/q', '/p#2', '/p#3'])
  })
})

describe('formatTree', () => {
  it('prints each space, then its tabs numbered within it', () => {
    const lines = formatTree(
      [
        { id: 'sp_a', path: '/p' },
        { id: 'sp_b', path: '/q' },
      ],
      [t({}), t({ id: 'bbbbbbbb-2222', spaceId: 'sp_b', kind: 'terminal', state: null, label: null, alive: false })],
    )
    expect(lines).toEqual([
      '/p',
      '  1  aaaaaaaa-1111  claude    working   one  alive',
      '/q',
      '  1  bbbbbbbb-2222  terminal  -         -  exited',
    ])
  })

  it('shows two spaces at one folder as two groups, the second with a #2 heading', () => {
    const lines = formatTree(
      [
        { id: 'sp_a', path: '/p' },
        { id: 'sp_b', path: '/p' },
      ],
      [t({}), t({ id: 'bbbbbbbb-2222', spaceId: 'sp_b', kind: 'terminal', state: null, label: null, alive: false })],
    )
    expect(lines).toEqual([
      '/p',
      '  1  aaaaaaaa-1111  claude    working   one  alive',
      '/p#2',
      '  1  bbbbbbbb-2222  terminal  -         -  exited',
    ])
  })

  it('prints only the space line for a space with no tabs', () => {
    expect(formatTree([{ id: 'sp_a', path: '/p' }], [])).toEqual(['/p'])
  })
})

describe('formatLsJson', () => {
  it('prints the tab objects', () => {
    expect(JSON.parse(formatLsJson([t({ state: 'idle' })]))).toEqual([t({ state: 'idle' })])
  })
})

describe('formatNew', () => {
  const tab = { id: 'abcd1234', kind: 'terminal', spaceId: 'sp_a', spacePath: '/p', label: 'x' }
  it('prints the id, or the object with --json', () => {
    expect(formatNew(tab, false)).toBe('abcd1234')
    expect(JSON.parse(formatNew(tab, true))).toEqual(tab)
  })
})

describe('turnExit', () => {
  it('maps idle to 0, gone to 5, timeout to 124 and any other error to 1', () => {
    expect(turnExit({ ok: true, data: { status: 'idle' } })).toBe(0)
    expect(turnExit({ ok: true, data: { status: 'gone' } })).toBe(5)
    expect(turnExit({ ok: false, error: 'timeout' })).toBe(124)
    expect(turnExit({ ok: false, error: 'no-status' })).toBe(1)
    expect(turnExit({ ok: false, error: 'not-found' })).toBe(1)
  })
})

describe('formatError', () => {
  it('prints one line with the error prefix', () => {
    expect(formatError('no tab matches x')).toBe('error: no tab matches x')
    expect(formatError('a\n  b')).toBe('error: a b')
  })
})

describe('formatRead', () => {
  it('trims trailing whitespace', () => {
    expect(formatRead('a\nb  \n\n \n')).toBe('a\nb')
  })

  it('keeps the last N lines of the content, not of the blank rows below it', () => {
    expect(formatRead('1\n2\n3\n4\n', 2)).toBe('3\n4')
    expect(formatRead('1\n2\n3  \n', 1)).toBe('3')
    expect(formatRead('prompt$ \n\n\n\n\n\n', 5)).toBe('prompt$')
  })
})
