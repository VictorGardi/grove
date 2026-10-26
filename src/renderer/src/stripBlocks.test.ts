import { describe, expect, it } from 'vitest'
import type { Project, Session } from '@shared/types'
import { tagClass } from './components/ui/Tag'
import { listGroups, orderedSessions } from './sessionList'
import { colorTags } from './tags'

// The session strip has no render test — this repo runs vitest in node, with no jsdom — so this
// pins what SessionStrip draws: one block per group, the group's coloured monogram leading it, and
// its worktrees' dots inside the same run. A worktree is not a second block: the monogram is the
// strip's only grouping cue, and two of one colour side by side read as two projects rather than
// one repo (ADR 0037).

const project = (id: string, name: string, worktreeOf?: string): Project => ({ id, name, path: '/' + id, ...(worktreeOf && { worktreeOf }) })

const session = (id: string, projectId: string): Session => ({
  id, projectId, kind: 'terminal', label: id, labelPinned: false, tmuxName: 'grove-' + id, cwd: null,
  agentSessionId: null, feature: null, linkPinned: false, action: null, startedAt: '2026-10-05T10:00:00.000Z',
  endedAt: null, lastStatus: 'running', seenAt: null, lastContext: null, workflowStatus: 'in-progress',
})

const PROJECTS = [project('p', 'grove'), project('wt', 'grove · probe', 'p'), project('q', 'other')]

const stripBlocks = () => listGroups(PROJECTS, [session('main', 'p'), session('probe', 'wt'), session('o', 'q')], {
  collapsed: [], hiddenProjects: [], groupBy: 'project', sessionSort: 'custom', sessionOrder: [],
}).map((g) => ({ ...g, sessions: orderedSessions([g]) })).filter((g) => g.sessions.length > 0)

describe('strip blocks', () => {
  it('folds a worktree into its repo\'s run rather than drawing it as its own block', () => {
    expect(stripBlocks().map((g) => [g.key, g.label, g.sessions.map((s) => s.id)])).toEqual([
      ['p:p', 'grove', ['main', 'probe']],
      ['p:q', 'other', ['o']],
    ])
  })

  it('keeps the sidebar\'s order, so ⌘N is the dot the human counts to', () => {
    expect(stripBlocks().flatMap((g) => g.sessions.map((s) => s.id)))
      .toEqual(orderedSessions(listGroups(PROJECTS, [session('main', 'p'), session('probe', 'wt'), session('o', 'q')], {
        collapsed: [], hiddenProjects: [], groupBy: 'project', sessionSort: 'custom', sessionOrder: [],
      })).map((s) => s.id))
  })

  it('gives each block one colour, and never a second block in the same colour', () => {
    const tags = colorTags(PROJECTS, [])
    const bars = Object.fromEntries(stripBlocks().map((g) => [g.key, tagClass(tags.project(g.project!.id), 'fg')]))
    for (const [key, bar] of Object.entries(bars)) expect(bar, key).toBeTruthy()
    expect(Object.keys(bars)).toEqual(['p:p', 'p:q'])
    expect(bars['p:q']).not.toBe(bars['p:p'])
  })
})