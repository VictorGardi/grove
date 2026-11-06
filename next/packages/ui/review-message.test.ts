import { describe, expect, it } from 'vitest'
import type { DiffComment } from '../protocol/messages.ts'
import { reviewMessage } from './review-message.ts'

const comment = (over: Partial<DiffComment> = {}): DiffComment => ({
  id: 'c', path: 'src/a.ts', side: 'new', line: 5, anchor: 'const x = 1', before: ['a', 'b'], after: ['c'], body: 'why?', state: 'pending', createdAt: 1, ...over,
})
const fresh = (): boolean => false

describe('reviewMessage', () => {
  it('writes the intro, the location, the snippet with its context and the body', () => {
    expect(reviewMessage([comment()], fresh)).toBe('Review comments on the current changes:\n\nsrc/a.ts:5 (new)\n```\na\nb\nconst x = 1\nc\n```\nwhy?')
  })

  it('writes a range as line-endLine and the old side as old', () => {
    const text = reviewMessage([comment({ side: 'old', line: 5, endLine: 6, anchor: 'one\ntwo', before: [], after: [] })], fresh)
    expect(text).toContain('src/a.ts:5-6 (old)\n```\none\ntwo\n```\nwhy?')
  })

  it('takes a range from the anchor when the comment has no endLine', () => {
    expect(reviewMessage([comment({ anchor: 'one\ntwo', before: [], after: [] })], fresh)).toContain('src/a.ts:5-6 (new)')
  })

  it('marks an outdated comment after its location and keeps it', () => {
    const text = reviewMessage([comment()], () => true)
    expect(text).toContain('src/a.ts:5 (new) (outdated: the code has changed since)\n```')
  })

  it('leaves out resolved and sent comments', () => {
    const text = reviewMessage([comment({ id: '1', body: 'keep' }), comment({ id: '2', state: 'sent', body: 'sent one' }), comment({ id: '3', state: 'resolved', body: 'done one' })], fresh)
    expect(text).toContain('keep')
    expect(text).not.toContain('sent one')
    expect(text).not.toContain('done one')
  })

  it('orders by file, then line, and separates items with a blank line', () => {
    const text = reviewMessage([comment({ path: 'b.ts', line: 1, body: 'B1' }), comment({ path: 'a.ts', line: 9, body: 'A9' }), comment({ path: 'a.ts', line: 2, body: 'A2' })], fresh)
    expect(text.split('\n\n').slice(1).map((item) => item.split('\n')[0])).toEqual(['a.ts:2 (new)', 'a.ts:9 (new)', 'b.ts:1 (new)'])
    expect(text.indexOf('A2')).toBeLessThan(text.indexOf('A9'))
    expect(text.indexOf('A9')).toBeLessThan(text.indexOf('B1'))
  })

  it('picks a fence longer than any backtick run in the snippet', () => {
    const text = reviewMessage([comment({ anchor: 'const s = ```x```', before: [], after: [] })], fresh)
    expect(text).toContain('\n````\nconst s = ```x```\n````\n')
  })
})
