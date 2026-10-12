import { describe, expect, it } from 'vitest'
import { monogram } from './monogram'

describe('monogram', () => {
  it('takes the initials of the first two words', () => {
    expect(monogram('spatial-intelligence')).toBe('SI')
    expect(monogram('my cool_project name')).toBe('MC')
  })
  it('takes the first two letters of a single word', () => {
    expect(monogram('grove')).toBe('GR')
    expect(monogram('x')).toBe('X')
  })
  it('is empty for a name with no letters or digits', () => {
    expect(monogram('---')).toBe('')
  })
})
