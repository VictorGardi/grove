import { describe, expect, it } from 'vitest'
import { readFrontmatter } from './frontmatter'

describe('readFrontmatter', () => {
  it('parses the block and returns the body after it', () => {
    expect(readFrontmatter('---\nstatus: approved\nversion: 3\n---\n# Title\n')).toEqual({
      data: { status: 'approved', version: 3 },
      body: '# Title\n',
      error: null,
    })
  })

  it('keeps dates as strings', () => {
    expect(readFrontmatter('---\ncreated: 2026-10-05\n---\n').data).toEqual({ created: '2026-10-05' })
  })

  it('accepts a leading BOM and CRLF line endings', () => {
    const out = readFrontmatter('﻿---\r\nstatus: draft\r\n---\r\nbody')
    expect(out).toEqual({ data: { status: 'draft' }, body: 'body', error: null })
  })

  it('accepts ... as the closing line', () => {
    expect(readFrontmatter('---\nkind: epic\n...\nrest').data).toEqual({ kind: 'epic' })
  })

  it('treats an empty block as an empty mapping', () => {
    expect(readFrontmatter('---\n---\nx')).toEqual({ data: {}, body: 'x', error: null })
  })

  it('returns no data and no error without an opening line', () => {
    expect(readFrontmatter('# Just markdown\n')).toEqual({ data: {}, body: '# Just markdown\n', error: null })
  })

  it.each([
    ['an unclosed block', '---\nstatus: draft\n'],
    ['a YAML error', '---\nstatus: [draft\n---\n'],
    ['a non-mapping', '---\n- a\n---\n'],
  ])('returns no data and an error for %s', (_, text) => {
    const out = readFrontmatter(text)
    expect(out.data).toEqual({})
    expect(out.error).toEqual(expect.any(String))
  })
})
