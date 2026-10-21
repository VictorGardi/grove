import { describe, expect, it } from 'vitest'
import type { Session } from '@shared/types'
import { createTerminalActivity } from './terminalActivity'

const term = { id: 't1', kind: 'terminal', tmuxName: 'grove-t1', lastStatus: 'running' } as Session
const read = (cmd: string) => new Map([['grove-t1', cmd]])

describe('terminal activity', () => {
  it('shows working while a command runs and idle at the prompt', () => {
    const a = createTerminalActivity()
    a.observe(read('zsh'), [term], 0, null)
    expect(a.apply([term])[0].status).toBe('idle')
    a.observe(read('npm'), [term], 1000, null)
    expect(a.apply([term])[0].status).toBe('working')
  })

  it('marks a 3 s command finished off screen, and clears it when seen', () => {
    const a = createTerminalActivity()
    a.observe(read('npm'), [term], 0, null)
    a.observe(read('zsh'), [term], 3000, null)
    const s = a.apply([term])[0]
    expect([s.status, s.waitingFor]).toEqual(['waiting', 'done'])
    expect(a.seen('t1')).toBe(true)
    expect(a.apply([s])[0].status).toBe('idle')
  })

  it('ignores short commands and commands finished on screen', () => {
    const a = createTerminalActivity()
    a.observe(read('ls'), [term], 0, null)
    a.observe(read('zsh'), [term], 2000, null)
    expect(a.apply([term])[0].status).toBe('idle')
    a.observe(read('npm'), [term], 3000, 't1')
    a.observe(read('-zsh'), [term], 9000, 't1')
    expect(a.apply([term])[0].status).toBe('idle')
  })
})
