import { describe, expect, it } from 'vitest'
import { splitTitleLead } from './titleLead'

describe('splitTitleLead', () => {
  it('splits the grove skill prefix off', () => {
    expect(splitTitleLead('grove-design-ASS-69-analytics')).toEqual({ lead: 'grove-design-', rest: 'ASS-69-analytics' })
    expect(splitTitleLead('grove-implement-2026-10-12-x')).toEqual({ lead: 'grove-implement-', rest: '2026-10-12-x' })
  })
  it('leaves other names whole', () => {
    expect(splitTitleLead('investigate ass-63')).toEqual({ lead: '', rest: 'investigate ass-63' })
    expect(splitTitleLead('grove-design-')).toEqual({ lead: '', rest: 'grove-design-' })
  })
})
