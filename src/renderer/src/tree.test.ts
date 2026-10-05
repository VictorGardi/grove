import { describe, expect, it } from 'vitest'
import type { Feature, Project, Session } from '@shared/types'
import { buildTree, treeSessionOrder, type TreeNode } from './tree'

const project = (id: string): Project => ({ id, name: id, path: '/' + id })

function feature(slug: string, over: Partial<Feature> = {}): Feature {
  return {
    projectId: 'p', slug, path: '/p/' + slug, title: slug, kind: 'feature', group: false,
    parent: null, flow: null, stages: [], currentStage: 'questions', cardState: 'ready', flags: [], warnings: [], artifacts: [], ...over,
  }
}

function session(id: string, over: Partial<Session> = {}): Session {
  return {
    id, projectId: 'p', kind: 'terminal', label: id, labelPinned: false, tmuxName: 'grove-' + id,
    opencodeSessionId: null, feature: null, linkPinned: false, action: null,
    startedAt: '2026-10-05T10:00:00.000Z', endedAt: null, lastStatus: 'running', ...over,
  }
}

// Node keys as a nested outline, for compact assertions.
type Outline = string | [string, Outline[]]
const outline = (nodes: TreeNode[]): Outline[] =>
  nodes.map((n) => (n.type === 'session' ? n.key : [n.key, outline(n.children)]))

describe('buildTree', () => {
  it('nests children under their epic and sorts done features last', () => {
    const tree = buildTree([project('p')], [
      feature('b-child', { parent: 'a-epic' }),
      feature('a-epic', { kind: 'epic', group: true }),
      feature('c-done', { currentStage: null }),
      feature('d-orphan', { parent: 'missing' }),
      feature('a-done-child', { parent: 'a-epic', currentStage: null }),
    ], [], { collapsed: [] })
    expect(outline(tree)).toEqual([
      ['p:p', [
        ['f:p/a-epic', [['f:p/b-child', []], ['f:p/a-done-child', []]]],
        ['f:p/d-orphan', []],
        ['f:p/c-done', []],
      ]],
    ])
  })

  it('puts linked sessions under their feature and the rest under the project', () => {
    const tree = buildTree([project('p'), project('q')], [
      feature('a-epic', { group: true }),
      feature('b', { parent: 'a-epic' }),
      feature('b', { projectId: 'q' }),
    ], [
      session('s3', { feature: 'gone', startedAt: '2026-10-05T10:03:00.000Z' }),
      session('s1', { feature: 'a-epic' }),
      session('s2', { feature: 'b', startedAt: '2026-10-05T10:02:00.000Z' }),
      session('s0', { startedAt: '2026-10-05T09:00:00.000Z' }),
      session('s4', { projectId: 'q', feature: 'a-epic' }),
    ], { collapsed: [] })
    expect(outline(tree)).toEqual([
      ['p:p', [
        ['f:p/a-epic', ['s:s1', ['f:p/b', ['s:s2']]]],
        's:s0',
        's:s3',
      ]],
      ['p:q', [['f:q/b', []], 's:s4']],
    ])
  })

  it('marks collapsed nodes but keeps their sessions in order', () => {
    const tree = buildTree([project('p')], [feature('a')], [
      session('s1', { feature: 'a' }),
      session('s2', { startedAt: '2026-10-05T11:00:00.000Z' }),
    ], { collapsed: ['p:p', 'f:p/a'] })
    expect(tree[0]).toMatchObject({ collapsed: true })
    expect(tree[0].type === 'project' && tree[0].children[0]).toMatchObject({ key: 'f:p/a', collapsed: true })
    expect(treeSessionOrder(tree).map((s) => s.id)).toEqual(['s1', 's2'])
  })
})
