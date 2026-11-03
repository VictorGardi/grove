import { describe, expect, it } from 'vitest'
import type { Session } from './types'
import { asksHuman } from './attention'

const session = (over: Partial<Session> = {}): Session =>
  ({ id: 'a', projectId: 'p', kind: 'claude', label: 'a', lastStatus: 'running', ...over }) as Session

describe('asksHuman', () => {
  it('is true for a waiting session, top-level finish included, and a child permission or question', () => {
    expect(asksHuman(session({ status: 'waiting', waitingFor: 'permission' }))).toBe(true)
    expect(asksHuman(session({ status: 'waiting', waitingFor: 'done' }))).toBe(true)
    expect(asksHuman(session({ status: 'waiting', waitingFor: 'permission', link: { id: 'p', kind: 'group' } }))).toBe(true)
    expect(asksHuman(session({ status: 'waiting', waitingFor: 'question', link: { id: 'p', kind: 'group' } }))).toBe(true)
  })

  it('is false for a finished child, a held prompt, a gone or starting or failed session, and anything not waiting', () => {
    expect(asksHuman(session({ status: 'waiting', waitingFor: 'done', link: { id: 'p', kind: 'group' } }))).toBe(false)
    expect(asksHuman(session({ status: 'waiting', waitingFor: 'permission', link: { id: 'p', kind: 'group' }, held: true }))).toBe(false)
    expect(asksHuman(session({ status: 'waiting', lastStatus: 'gone' }))).toBe(false)
    expect(asksHuman(session({ status: 'waiting', startup: { phase: 'starting', since: 'x' } }))).toBe(false)
    expect(asksHuman(session({ status: 'waiting', startup: { phase: 'failed', reason: 'x' } }))).toBe(false)
    expect(asksHuman(session({ status: 'working' }))).toBe(false)
    expect(asksHuman(session())).toBe(false)
  })
})
