import { describe, expect, it } from 'vitest'
import type { Feature, Session } from '@shared/types'
import { boardColumns, linkedFeature, linkedSessions, sessionColumns } from './tree'

function feature(slug: string, over: Partial<Feature> = {}): Feature {
  return {
    projectId: 'p', slug, path: '/p/' + slug, title: slug, kind: 'feature', group: false,
    parent: null, flow: null, stages: [], currentStage: 'questions', cardState: 'ready', progress: null, flags: [], warnings: [], artifacts: [], ...over,
  }
}

function session(id: string, over: Partial<Session> = {}): Session {
  return {
    id, projectId: 'p', kind: 'terminal', label: id, labelPinned: false, tmuxName: 'grove-' + id,
    cwd: null, agentSessionId: null, feature: null, linkPinned: false, action: null,
    startedAt: '2026-10-05T10:00:00.000Z', endedAt: null, lastStatus: 'running', seenAt: null, lastContext: null, workflowStatus: 'in-progress', ...over,
  }
}

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

  it('still attaches a parent whose copy sits in another checkout of the same repo', () => {
    // One card per repo and slug: a worktree-only feature is its own project's, so its parent —
    // which the checkout does hold — would otherwise lose its tag.
    const features = [
      feature('e', { title: 'Parent E', group: true }),
      feature('a', { parent: 'e', projectId: 'wt' }),
    ]
    const titles = (cols: ReturnType<typeof boardColumns>) => cols[0].cards.map((k) => k.parent?.title ?? null)
    expect(titles(boardColumns(stages, features, new Set(['p', 'wt'])))).toEqual(['Parent E'])
    expect(titles(boardColumns(stages, features))).toEqual([null]) // without the repo, 'wt' has no parent 'e'
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

  it('counts a whole repo\'s checkouts when the caller says which', () => {
    // The board shows one card per repo, so a worktree session is a dot on the repo's card.
    const list = [
      session('e', { feature: 'a' }),
      session('w', { feature: 'a', projectId: 'wt' }),
      session('c', { feature: 'a', projectId: 'q' }),
    ]
    expect(linkedSessions(feature('a'), list, new Set(['p', 'wt'])).map((s) => s.id)).toEqual(['e', 'w'])
  })

  it('still matches the feature\'s own project when the caller names none', () => {
    const list = [session('e', { feature: 'a' }), session('w', { feature: 'a', projectId: 'wt' })]
    expect(linkedSessions(feature('a'), list).map((s) => s.id)).toEqual(['e'])
    expect(linkedSessions(feature('a', { projectId: 'wt' }), list).map((s) => s.id)).toEqual(['w'])
  })
})
