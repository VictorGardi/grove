import { describe, expect, it } from 'vitest'
import type { Feature, Project, Session } from '@shared/types'
import { boardColumns, linkedFeature, linkedSessions, sessionColumns, sessionGroups, sessionOrder } from './tree'

const project = (id: string): Project => ({ id, name: id, path: '/' + id })

function feature(slug: string, over: Partial<Feature> = {}): Feature {
  return {
    projectId: 'p', slug, path: '/p/' + slug, title: slug, kind: 'feature', group: false,
    parent: null, flow: null, stages: [], currentStage: 'questions', cardState: 'ready', progress: null, flags: [], warnings: [], artifacts: [], ...over,
  }
}

function session(id: string, over: Partial<Session> = {}): Session {
  return {
    id, projectId: 'p', kind: 'terminal', label: id, labelPinned: false, tmuxName: 'grove-' + id,
    opencodeSessionId: null, feature: null, linkPinned: false, action: null,
    startedAt: '2026-10-05T10:00:00.000Z', endedAt: null, lastStatus: 'running', seenAt: null, ...over,
  }
}

describe('sessionGroups', () => {
  it('groups by project in config order, sessions by start time, linked ones included', () => {
    const groups = sessionGroups([project('q'), project('p')], [
      session('s3', { feature: 'a', startedAt: '2026-10-05T10:03:00.000Z' }),
      session('s1'),
      session('s0', { startedAt: '2026-10-05T09:00:00.000Z' }),
      session('s4', { projectId: 'q', kind: 'opencode' }),
      session('s5', { projectId: 'gone' }),
    ], { collapsed: ['p:q'] })
    expect(groups.map((g) => [g.key, g.collapsed, g.sessions.map((s) => s.id)])).toEqual([
      ['p:q', true, ['s4']],
      ['p:p', false, ['s0', 's1', 's3']],
    ])
  })
})

describe('sessionOrder', () => {
  it('includes collapsed groups, in group order', () => {
    const groups = sessionGroups([project('p'), project('q')], [
      session('s2', { projectId: 'q' }),
      session('s1'),
    ], { collapsed: ['p:p'] })
    expect(sessionOrder(groups).map((s) => s.id)).toEqual(['s1', 's2'])
  })
})

describe('linkedFeature', () => {
  const features = [feature('a'), feature('b', { projectId: 'q' })]
  it('finds the linked feature in the session\'s project only', () => {
    expect(linkedFeature(session('s', { feature: 'a' }), features)?.slug).toBe('a')
    expect(linkedFeature(session('s', { feature: 'b' }), features)).toBeNull()
    expect(linkedFeature(session('s', { feature: 'gone' }), features)).toBeNull()
    expect(linkedFeature(session('s'), features)).toBeNull()
  })
})

describe('boardColumns', () => {
  const stages = [{ id: 'questions', label: 'Questions' }, { id: 'design', label: 'Design' }, { id: 'implementation', label: 'Implementation' }]
  const cards = (cols: ReturnType<typeof boardColumns>) => cols.map((c) => [c.stage.id, c.cards.map((k) => k.feature.slug)])

  it('puts non-group features in their current stage, done ones last', () => {
    const cols = boardColumns(stages, [
      feature('e', { kind: 'epic', group: true }),
      feature('a', { currentStage: 'design' }),
      feature('b', { currentStage: null }),
      feature('c'),
    ])
    expect(cards(cols)).toEqual([['questions', ['c']], ['design', ['a']], ['implementation', ['b']]])
  })

  it('attaches the parent from the same project', () => {
    const cols = boardColumns(stages, [
      feature('e', { title: 'Parent E', group: true }),
      feature('a', { parent: 'e' }),
      feature('b', { parent: 'missing' }),
      feature('c', { parent: 'e', projectId: 'q' }),
    ])
    expect(cols[0].cards.map((k) => [k.feature.slug, k.parent?.title ?? null])).toEqual([['a', 'Parent E'], ['b', null], ['c', null]])
  })
})

describe('sessionColumns', () => {
  it('sorts sessions into Waiting, Working, Idle and Ended by start time', () => {
    const cols = sessionColumns([
      session('t2', { startedAt: '2026-10-05T12:00:00.000Z' }),
      session('w', { status: 'waiting' }),
      session('k', { status: 'working', startedAt: '2026-10-05T11:00:00.000Z' }),
      session('i', { status: 'idle' }),
      session('g', { lastStatus: 'gone', status: 'idle' }),
    ])
    expect(cols.map((c) => [c.id, c.label, c.sessions.map((s) => s.id)])).toEqual([
      ['waiting', 'Waiting', ['w']],
      ['working', 'Working', ['k', 't2']],
      ['idle', 'Idle', ['i']],
      ['ended', 'Ended', ['g']],
    ])
  })
})

describe('linkedSessions', () => {
  it("lists the feature's sessions in its own project, by start time", () => {
    const list = [
      session('b', { feature: 'a', startedAt: '2026-10-05T12:00:00.000Z' }),
      session('c', { feature: 'a', projectId: 'q' }),
      session('d', { feature: 'x' }),
      session('e', { feature: 'a' }),
    ]
    expect(linkedSessions(feature('a'), list).map((s) => s.id)).toEqual(['e', 'b'])
  })
})
