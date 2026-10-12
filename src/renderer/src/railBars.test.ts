import { describe, expect, it } from 'vitest'
import type { Project, Session } from '@shared/types'
import { tagClass } from './components/ui/Tag'
import { listGroups, orderedSessions } from './sessionList'
import { colorTags } from './tags'

// The rail has no render test — this repo runs vitest in node, with no jsdom — so this pins
// what SidebarRail draws: one block per group, the group's colour bar beside it, and its
// worktrees' tiles inside the same run. A worktree is not a second block: the rail's bar is
// its only grouping cue, and two bars of one colour with a gap between them read as two
// projects rather than one repo (ADR 0037).

const project = (id: string, name: string, worktreeOf?: string): Project => ({ id, name, path: '/' + id, ...(worktreeOf && { worktreeOf }) })

const session = (id: string, projectId: string): Session => ({
  id, projectId, kind: 'terminal', label: id, labelPinned: false, tmuxName: 'grove-' + id, cwd: null,
  agentSessionId: null, feature: null, linkPinned: false, action: null, startedAt: '2026-10-05T10:00:00.000Z',
  endedAt: null, lastStatus: 'running', seenAt: null, lastContext: null, workflowStatus: 'in-progress', sandboxed: false,
})

const PROJECTS = [project('p', 'grove'), project('wt', 'grove · probe', 'p'), project('q', 'other')]

const railBlocks = () => listGroups(PROJECTS, [session('main', 'p'), session('probe', 'wt'), session('o', 'q')], {
  collapsed: [], hiddenProjects: [], groupBy: 'project', sessionSort: 'custom', sessionOrder: [],
}).map((g) => ({ ...g, sessions: orderedSessions([g]) })).filter((g) => g.sessions.length > 0)

describe('rail blocks', () => {
  it('folds a worktree into its repo\'s run rather than drawing it as its own block', () => {
    expect(railBlocks().map((g) => [g.key, g.label, g.sessions.map((s) => s.id)])).toEqual([
      ['p:p', 'grove', ['main', 'probe']],
      ['p:q', 'other', ['o']],
    ])
  })

  it('keeps the sidebar\'s order, so ⌘N is the tile the human counts to', () => {
    expect(railBlocks().flatMap((g) => g.sessions.map((s) => s.id)))
      .toEqual(orderedSessions(listGroups(PROJECTS, [session('main', 'p'), session('probe', 'wt'), session('o', 'q')], {
        collapsed: [], hiddenProjects: [], groupBy: 'project', sessionSort: 'custom', sessionOrder: [],
      })).map((s) => s.id))
  })

  it('gives each block one bar, and never a second one in the same colour', () => {
    const tags = colorTags(PROJECTS, [])
    const bars = Object.fromEntries(railBlocks().map((g) => [g.key, tagClass(tags.project(g.project!.id), 'fg')]))
    for (const [key, bar] of Object.entries(bars)) expect(bar, key).toBeTruthy()
    expect(Object.keys(bars)).toEqual(['p:p', 'p:q'])
    expect(bars['p:q']).not.toBe(bars['p:p'])
  })
})