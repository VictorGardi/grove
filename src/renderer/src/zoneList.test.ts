import { describe, expect, it } from 'vitest'
import type { Session } from '@shared/types'
import { rowLine, rowTitle, zoneSections, zonesFor } from './zoneList'

function session(over: Partial<Session> = {}): Session {
  return {
    id: 'a', projectId: 'p', kind: 'claude', label: 'a', labelPinned: false, tmuxName: 'grove-a',
    cwd: null, agentSessionId: 'ses_a', feature: null, linkPinned: false, action: null,
    startedAt: '2026-10-05T10:00:00.000Z', endedAt: null, lastStatus: 'running', seenAt: null, lastContext: null, workflowStatus: 'in-progress', ...over,
  }
}

const ids = (l: Session[]) => l.map((s) => s.id)

describe('rowLine finished and held children', () => {
  const kid = (over: Partial<Session>) => session({ parentId: 'p', status: 'waiting', label: 'kid', ...over })
  it('a held or finished child reads by its named line; a real child wait still says what it needs', () => {
    expect(rowLine(kid({ waitingFor: 'permission', held: true }))).toBe('kid · working')
    expect(rowLine(kid({ waitingFor: 'done' }))).toBe('kid · waiting · done')
    expect(rowLine(kid({ waitingFor: 'permission' }))).toBe('Needs permission')
    expect(rowLine(kid({ waitingFor: 'question' }))).toBe('Has a question')
    expect(rowLine(kid({ waitingFor: 'permission', held: true, attention: { reason: 'Need prod key', waitingFor: 'permission' } }))).toBe('Need prod key')
    expect(rowLine(session({ status: 'waiting', waitingFor: 'permission' }))).toBe('Needs permission')
  })
})

describe('rowLine classified', () => {
  const done = (over: Partial<Session>) => session({ status: 'waiting', waitingFor: 'done', ...over })
  it('says it may need an answer when the small model said so and there is no summary', () => {
    expect(rowLine(done({ classified: { verdict: 'needs-you', at: 'x' } }))).toBe('May need an answer')
    expect(rowLine(done({ classified: { verdict: 'needs-you', at: 'x' }, lastLine: 'Asks which one' }))).toBe('Asks which one')
    expect(rowLine(done({ classified: { verdict: 'done', at: 'x' } }))).not.toBe('May need an answer')
  })
})

describe('rowLine attention', () => {
  const waiting = (over: Partial<Session>) => session({ status: 'waiting', lastLine: 'did a thing', ...over })
  it('says the escalated reason over lastLine', () => {
    expect(rowLine(waiting({ waitingFor: 'permission', attention: { reason: 'Run rm -rf?', waitingFor: 'permission' } }))).toBe('Run rm -rf?')
  })
  it('falls back per wait kind', () => {
    expect(rowLine(waiting({ waitingFor: 'permission' }))).toBe('Needs permission')
    expect(rowLine(waiting({ waitingFor: 'question' }))).toBe('Has a question')
  })
  it('leaves other sessions alone', () => {
    expect(rowLine(session({ status: 'working', lastLine: 'did a thing', attention: { reason: 'x', waitingFor: 'question' } }))).toBe('did a thing')
    expect(rowLine(waiting({ waitingFor: 'done' }))).toBe('did a thing')
  })
})

describe('zoneSections', () => {
  it('groups rows by zone; a child is a row only in needs you', () => {
    const z = zoneSections([
      session({ id: 'n', zone: 'needs-you' }),
      session({ id: 'nk', zone: 'needs-you', parentId: 'n' }),
      session({ id: 'r', zone: 'review' }),
      session({ id: 'rk', zone: 'review', parentId: 'n' }),
      session({ id: 'idle', zone: null }),
    ])
    expect(ids(z.needsYou)).toEqual(['n', 'nk'])
    expect(ids(z.review)).toEqual(['r'])
  })

  it('collapses running, children included, to a count', () => {
    const z = zoneSections([
      session({ id: 'w1', zone: 'running' }),
      session({ id: 'w2', zone: 'running', parentId: 'w1' }),
      session({ id: 'done-kid', zone: null, parentId: 'w1', lastFocusedAt: '2026-10-05T12:00:00.000Z' }),
    ])
    expect(z.runningCount).toBe(2)
    expect(ids(z.runningRows)).toEqual(['w1', 'w2'])
    expect(ids(z.recent)).toEqual([]) // a finished child is no row
  })

  it('keeps the five most recently focused, leaving out never-focused ones', () => {
    const list = Array.from({ length: 7 }, (_, i) => session({ id: `s${i}`, lastFocusedAt: `2026-10-05T1${i}:00:00.000Z` }))
    const z = zoneSections([...list, session({ id: 'never' })])
    expect(ids(z.recent)).toEqual(['s6', 's5', 's4', 's3', 's2'])
  })

  it('shows a session once: recent leaves out those in a zone', () => {
    const z = zoneSections([
      session({ id: 'n', zone: 'needs-you', lastFocusedAt: '2026-10-05T12:00:00.000Z' }),
      session({ id: 'w', zone: 'running', lastFocusedAt: '2026-10-05T11:00:00.000Z' }),
      session({ id: 'x', lastFocusedAt: '2026-10-05T10:00:00.000Z' }),
    ])
    expect(ids(z.recent)).toEqual(['x'])
  })
})

describe('rowTitle and rowLine', () => {
  it('titles a default-named session by its last line, else its label', () => {
    expect(rowTitle(session({ label: 'Claude · 09:49', lastLine: 'fix the login bug' }))).toBe('fix the login bug')
    expect(rowTitle(session({ label: 'Terminal · 14:47', lastLine: 'ls' }))).toBe('ls')
    expect(rowTitle(session({ label: 'Copilot · 9:05' }))).toBe('Copilot · 9:05')
    expect(rowTitle(session({ label: 'my name', lastLine: 'fix the login bug' }))).toBe('my name')
  })

  it('draws the line from the last line, else label and status', () => {
    expect(rowLine(session({ lastLine: 'fix it' }))).toBe('fix it')
    expect(rowLine(session({ label: 'api', status: 'working' }))).toBe('api · working')
  })

  it('does not repeat the title: a default name titled by its last line gets label and status', () => {
    const s = session({ label: 'Claude · 09:49', lastLine: 'fix it', status: 'working' })
    expect(rowTitle(s)).toBe('fix it')
    expect(rowLine(s)).toBe('Claude · 09:49 · working')
  })
})

describe('zonesFor', () => {
  it('offers a child only the zones it can show', () => {
    expect(zonesFor(session())).toEqual(['needs-you', 'review', 'running'])
    expect(zonesFor(session({ parentId: 'p' }))).toEqual(['needs-you', 'running'])
  })
})
