import { describe, expect, it } from 'vitest'
import { branchCut } from './branchCut'

describe('branchCut', () => {
  it('keeps a short branch whole', () => {
    expect(branchCut('main')).toEqual({ head: 'main', tail: '' })
  })

  it('keeps the end of a long branch apart from the part that shrinks', () => {
    const b = 'feature/2026-10-26-customer-prediction-app'
    const { head, tail } = branchCut(b)
    expect(head + tail).toBe(b)
    expect(tail).toBe('prediction-app')
  })
})
