import { describe, expect, it } from 'vitest'
import { pickPr } from './pr'

const row = (number: number, state: string, isDraft = false) => ({ number, state, isDraft, url: `https://github.com/o/r/pull/${number}` })

describe('pickPr', () => {
  it('prefers an open PR, then a merged one, then a closed one', () => {
    expect(pickPr(JSON.stringify([row(3, 'CLOSED'), row(2, 'MERGED'), row(1, 'OPEN')]))?.number).toBe(1)
    expect(pickPr(JSON.stringify([row(3, 'CLOSED'), row(2, 'MERGED')]))).toMatchObject({ number: 2, state: 'merged' })
    expect(pickPr(JSON.stringify([row(3, 'CLOSED')]))?.state).toBe('closed')
  })

  it('keeps gh order within a state and reports drafts', () => {
    expect(pickPr(JSON.stringify([row(9, 'OPEN', true), row(8, 'OPEN')]))).toMatchObject({ number: 9, draft: true })
  })

  it('is null for no PR or output it cannot read', () => {
    expect(pickPr('[]')).toBeNull()
    expect(pickPr('not json')).toBeNull()
    expect(pickPr('{"message":"x"}')).toBeNull()
  })
})
