import { describe, expect, it } from 'vitest'
import type { Feature, Session } from '@shared/types'
import { linkedFeature } from './tree'

function baseFeature(slug: string, over: Partial<Feature> = {}): Feature {
  return {
    projectId: 'p', slug, path: '/p/' + slug, title: slug, kind: 'feature', flow: null, stages: [], currentStage: 'questions', cardState: 'ready', flags: [], warnings: [], artifacts: [], ...over,
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
  const features = [baseFeature('a'), baseFeature('b', { projectId: 'q' })]
  it('finds the linked feature in the session\'s project only', () => {
    expect(linkedFeature(session('s', { feature: 'a' }), features)?.slug).toBe('a')
    expect(linkedFeature(session('s', { feature: 'b' }), features)).toBeNull()
    expect(linkedFeature(session('s', { feature: 'gone' }), features)).toBeNull()
    expect(linkedFeature(session('s'), features)).toBeNull()
  })
})
