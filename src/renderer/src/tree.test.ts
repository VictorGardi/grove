import { describe, expect, it } from 'vitest'
import type { Feature, FeatureStage, Session } from '@shared/types'
import { boardColumns, linkedFeature, linkedSessions, sessionColumns } from './tree'

function baseFeature(slug: string, over: Partial<Feature> = {}): Feature {
  return {
    projectId: 'p', slug, path: '/p/' + slug, title: slug, kind: 'feature', group: false,
    parent: null, flow: null, stages: [], currentStage: 'questions', cardState: 'ready', progress: null, flags: [], warnings: [], artifacts: [], ...over,
  }
}

const feature = baseFeature
const stagesOf = (...ids: string[]): FeatureStage[] =>
  ids.map((id) => ({ id, label: id, artifact: id + '.md', review: null, state: 'upcoming' }))

function session(id: string, over: Partial<Session> = {}): Session {
  return {
    id, projectId: 'p', kind: 'terminal', label: id, labelPinned: false, tmuxName: 'grove-' + id,
    cwd: null, agentSessionId: null, feature: null, linkPinned: false, action: null,
    startedAt: '2026-10-05T10:00:00.000Z', endedAt: null, lastStatus: 'running', seenAt: null, lastContext: null, workflowStatus: 'in-progress', sandboxed: false, ...over,
  }
}

describe('linkedFeature', () => {
  const features = [baseFeature('a'), baseFeature('b', { projectId: 'q' })]
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
  const feature = (slug: string, over: Partial<Feature> = {}) => baseFeature(slug, { stages: stagesOf('questions', 'design', 'implementation'), ...over })

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

  describe('stages in use', () => {
    const all = ['questions', 'outcome', 'research', 'plan', 'run', 'design', 'structure', 'implementation'].map((id) => ({ id, label: id }))
    const legacy = stagesOf('questions', 'research', 'design', 'structure', 'implementation')
    const auto = stagesOf('outcome', 'research', 'plan', 'run')
    const ids = (cols: ReturnType<typeof boardColumns>) => cols.map((c) => c.stage.id)

    it('draws only the legacy stages for a legacy-only repo', () => {
      expect(ids(boardColumns(all, [feature('a', { stages: legacy })]))).toEqual(['questions', 'research', 'design', 'structure', 'implementation'])
    })
    it('adds an auto feature\'s stages in global order', () => {
      const cols = boardColumns(all, [feature('a', { stages: legacy }), feature('b', { stages: auto, currentStage: 'plan' })])
      expect(ids(cols)).toEqual(['questions', 'outcome', 'research', 'plan', 'run', 'design', 'structure', 'implementation'])
      expect(cards(cols).find(([id]) => id === 'plan')).toEqual(['plan', ['b']])
    })
    it('puts a done auto feature in its own last stage', () => {
      const cols = boardColumns(all, [feature('a', { stages: legacy }), feature('b', { stages: auto, currentStage: null })])
      expect(cards(cols).find(([id]) => id === 'run')).toEqual(['run', ['b']])
      expect(cards(cols).find(([id]) => id === 'implementation')).toEqual(['implementation', []])
    })
    it('lets a group feature add no columns', () => {
      expect(ids(boardColumns(all, [feature('e', { group: true, stages: auto }), feature('a', { stages: stagesOf('questions', 'implementation') })]))).toEqual(['questions', 'implementation'])
    })
    it('shows only questions and implementation for an all-small repo', () => {
      expect(ids(boardColumns(all, [feature('a', { stages: stagesOf('questions', 'implementation') })]))).toEqual(['questions', 'implementation'])
    })
    it('has no columns without features', () => {
      expect(boardColumns(all, [])).toEqual([])
    })
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

  it('keeps a starting session in the Working column, never off the board', () => {
    const cols = sessionColumns([session('s', { startup: { phase: 'starting', since: '2026-10-05T10:00:00.000Z' } })])
    expect(cols.find((c) => c.id === 'working')?.sessions.map((s) => s.id)).toEqual(['s'])
    expect(cols.flatMap((c) => c.sessions)).toHaveLength(1)
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
