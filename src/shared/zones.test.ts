import { describe, expect, it } from 'vitest'
import type { Session } from './types'
import { zoneOf } from './zones'

function session(over: Partial<Session> = {}): Session {
  return {
    id: 'a', projectId: 'p', kind: 'claude', label: 'a', labelPinned: false, tmuxName: 'grove-a',
    cwd: null, agentSessionId: 'ses_a', feature: null, linkPinned: false, action: null,
    startedAt: '2026-10-05T10:00:00.000Z', endedAt: null, lastStatus: 'running', seenAt: null, lastContext: null, workflowStatus: 'in-progress', ...over,
  }
}

describe('zoneOf', () => {
  it('puts a held child prompt in running, unless escalated', () => {
    expect(zoneOf(session({ status: 'waiting', waitingFor: 'permission', parentId: 'p1', held: true }))).toBe('running')
    expect(zoneOf(session({ status: 'waiting', waitingFor: 'permission', parentId: 'p1', held: true, attention: { reason: 'x', waitingFor: 'permission' } }))).toBe('needs-you')
  })

  it('puts an escalated waiting child in needs-you', () => {
    expect(zoneOf(session({ status: 'waiting', waitingFor: 'permission', parentId: 'p', attention: { reason: 'x', waitingFor: 'permission' } }))).toBe('needs-you')
  })

  it('puts a permission or question in needs-you, children included', () => {
    expect(zoneOf(session({ status: 'waiting', waitingFor: 'permission' }))).toBe('needs-you')
    expect(zoneOf(session({ status: 'waiting', waitingFor: 'question' }))).toBe('needs-you')
    expect(zoneOf(session({ status: 'waiting', waitingFor: 'permission', parentId: 'p1' }))).toBe('needs-you')
    expect(zoneOf(session({ status: 'waiting', waitingFor: 'question', parentId: 'p1' }))).toBe('needs-you')
  })

  it('treats a waiting session of unknown kind as needs-you', () => {
    expect(zoneOf(session({ status: 'waiting' }))).toBe('needs-you')
  })

  it('puts a finished top-level session in review and a finished child in no zone', () => {
    expect(zoneOf(session({ status: 'waiting', waitingFor: 'done' }))).toBe('review')
    expect(zoneOf(session({ status: 'waiting', waitingFor: 'done', parentId: 'p1' }))).toBeNull()
  })

  it('puts a workflow status of in-review in review', () => {
    expect(zoneOf(session({ status: 'idle', workflowStatus: 'in-review' }))).toBe('review')
  })

  it('puts a working session, top-level or child, in running', () => {
    expect(zoneOf(session({ status: 'working' }))).toBe('running')
    expect(zoneOf(session({ status: 'working', parentId: 'p1' }))).toBe('running')
  })

  it('leaves idle, plain, gone and starting sessions in no zone', () => {
    expect(zoneOf(session({ status: 'idle' }))).toBeNull()
    expect(zoneOf(session())).toBeNull()
    expect(zoneOf(session({ status: 'working', lastStatus: 'gone' }))).toBeNull()
    expect(zoneOf(session({ startup: { phase: 'starting', since: '2026-10-05T10:00:00.000Z' } }))).toBeNull()
  })

  it('lets the override win over every rule', () => {
    expect(zoneOf(session({ status: 'waiting', waitingFor: 'permission', zoneOverride: 'running' }))).toBe('running')
    expect(zoneOf(session({ status: 'working', zoneOverride: 'needs-you' }))).toBe('needs-you')
    expect(zoneOf(session({ status: 'waiting', waitingFor: 'done', parentId: 'p1', zoneOverride: 'review' }))).toBe('review')
    expect(zoneOf(session({ lastStatus: 'gone', zoneOverride: 'review' }))).toBe('review')
  })

  it('ignores an override that is not a zone', () => {
    expect(zoneOf(session({ status: 'working', zoneOverride: 'bogus' as never }))).toBe('running')
  })
})
