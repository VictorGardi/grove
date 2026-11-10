import { describe, expect, it } from 'vitest'
import { SLASH_ITEMS, slashMatch } from './slash-menu.ts'

describe('slashMatch', () => {
  it('lists every item for a bare slash at the line start', () => {
    expect(slashMatch('/')).toEqual({ offset: 0, items: SLASH_ITEMS })
  })
  it('keeps indentation outside the replaced range', () => {
    expect(slashMatch('  /')?.offset).toBe(2)
  })
  it('filters by what is typed after the slash', () => {
    expect(slashMatch('/head')?.items.map((item) => item.label)).toEqual(['Heading 1', 'Heading 2', 'Heading 3'])
    expect(slashMatch('/check')?.items.map((item) => item.label)).toEqual(['Checkbox'])
  })
  it('opens after a list marker and replaces it', () => {
    expect(slashMatch('- /')?.offset).toBe(0)
    expect(slashMatch('  - [ ] /h')?.offset).toBe(2)
    expect(slashMatch('1. /')?.offset).toBe(0)
  })
  it('stays closed in the middle of text, paths and urls', () => {
    expect(slashMatch('and /')).toBeNull()
    expect(slashMatch('https://')).toBeNull()
    expect(slashMatch('a/b')).toBeNull()
  })
  it('stays closed when nothing matches', () => {
    expect(slashMatch('/zzz')).toBeNull()
  })
})
