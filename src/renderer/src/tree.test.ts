import { describe, expect, it } from 'vitest'
import type { Feature, Project, Session } from '@shared/types'
import { boardColumns, buildTree, sessionGroups, sessionOrder, type TreeNode } from './tree'

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
    startedAt: '2026-10-05T10:00:00.000Z', endedAt: null, lastStatus: 'running', ...over,
  }
}

// Node keys as a nested outline, for compact assertions.
type Outline = [string, Outline[]]
const outline = (nodes: TreeNode[]): Outline[] => nodes.map((n) => [n.key, outline(n.children)])

describe('buildTree', () => {
  it('nests children under their epic and sorts done (not active) features last', () => {
    const tree = buildTree([project('p')], [
      feature('b-child', { parent: 'a-epic' }),
      feature('a-epic', { kind: 'epic', group: true, currentStage: null, cardState: 'active' }), // active sorts with the active ones
      feature('c-done', { currentStage: null, cardState: 'done' }),
      feature('d-orphan', { parent: 'missing' }),
      feature('a-done-child', { parent: 'a-epic', currentStage: null, cardState: 'done' }),
    ], { collapsed: [] })
    expect(outline(tree)).toEqual([
      ['p:p', [
        ['f:p/a-epic', [['f:p/b-child', []], ['f:p/a-done-child', []]]],
        ['f:p/d-orphan', []],
        ['f:p/c-done', []],
      ]],
    ])
  })

  it('keeps features per project and holds no sessions', () => {
    const tree = buildTree([project('p'), project('q')], [
      feature('a-epic', { group: true }),
      feature('b', { parent: 'a-epic' }),
      feature('b', { projectId: 'q' }),
    ], { collapsed: [] })
    expect(outline(tree)).toEqual([
      ['p:p', [['f:p/a-epic', [['f:p/b', []]]]]],
      ['p:q', [['f:q/b', []]]],
    ])
  })

  it('marks collapsed nodes', () => {
    const tree = buildTree([project('p')], [feature('a')], { collapsed: ['p:p', 'f:p/a'] })
    expect(tree[0]).toMatchObject({ collapsed: true })
    expect(tree[0].type === 'project' && tree[0].children[0]).toMatchObject({ key: 'f:p/a', collapsed: true })
  })
})

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

  it("attaches the epic's title from the same project", () => {
    const cols = boardColumns(stages, [
      feature('e', { title: 'Epic E', group: true }),
      feature('a', { parent: 'e' }),
      feature('b', { parent: 'missing' }),
      feature('c', { parent: 'e', projectId: 'q' }),
    ])
    expect(cols[0].cards.map((k) => [k.feature.slug, k.epic])).toEqual([['a', 'Epic E'], ['b', null], ['c', null]])
  })
})
