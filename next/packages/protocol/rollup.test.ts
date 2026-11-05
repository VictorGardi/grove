import { describe, expect, it } from 'vitest'
import type { AgentStateName } from './messages.ts'
import { mostUrgent, rollupSpaces, URGENCY } from './rollup.ts'

describe('mostUrgent', () => {
  it('lets each state win over the ones below it', () => {
    expect(URGENCY).toEqual(['needs-you', 'working', 'finished', 'unknown', 'idle'])
    for (let i = 0; i < URGENCY.length; i++) {
      for (let j = i + 1; j < URGENCY.length; j++) {
        expect(mostUrgent([URGENCY[j], URGENCY[i]])).toBe(URGENCY[i])
      }
    }
  })

  it('gives idle for no states', () => {
    expect(mostUrgent([])).toBe('idle')
  })
})

describe('rollupSpaces', () => {
  it('gives each space id the most urgent state among its own tabs', () => {
    const rolled = rollupSpaces(
      ['widgets', 'gadgets'],
      [
        { spaceId: 'widgets', state: 'idle' },
        { spaceId: 'widgets', state: 'finished' },
        { spaceId: 'gadgets', state: 'unknown' },
      ],
    )
    expect(rolled.get('widgets')).toBe('finished')
    expect(rolled.get('gadgets')).toBe('unknown')
  })

  it('gives idle for a space with no tabs', () => {
    expect(rollupSpaces(['empty'], []).get('empty')).toBe('idle')
  })

  it('does not count a worktree tab towards its repo', () => {
    const tabs: Array<{ spaceId: string; state: AgentStateName }> = [{ spaceId: 'widgets-feature', state: 'needs-you' }]
    const rolled = rollupSpaces(['widgets', 'widgets-feature'], tabs)
    expect(rolled.get('widgets')).toBe('idle')
    expect(rolled.get('widgets-feature')).toBe('needs-you')
  })

  it('rolls up two spaces at one folder separately', () => {
    const rolled = rollupSpaces(
      ['first', 'second'],
      [
        { spaceId: 'first', state: 'working' },
        { spaceId: 'second', state: 'idle' },
      ],
    )
    expect(rolled.get('first')).toBe('working')
    expect(rolled.get('second')).toBe('idle')
  })
})
