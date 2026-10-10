import { describe, expect, it } from 'vitest'
import type { Project, Session } from '@shared/types'
import { tagClass } from './components/ui/Tag'
import { listGroups } from './sessionList'
import { colorTags } from './tags'

// The rail has no render test — this repo runs vitest in node, with no jsdom — so this pins
// what SidebarRail draws: one block per group, its worktrees nested under it, each with a
// colour bar for its project. A worktree's block must wear its repo's bar, not have none.

const project = (id: string, name: string, worktreeOf?: string): Project => ({ id, name, path: '/' + id, ...(worktreeOf && { worktreeOf }) })

const session = (id: string, projectId: string): Session => ({
  id, projectId, kind: 'terminal', label: id, labelPinned: false, tmuxName: 'grove-' + id, cwd: null,
  agentSessionId: null, feature: null, linkPinned: false, action: null, startedAt: '2026-10-05T10:00:00.000Z',
  endedAt: null, lastStatus: 'running', seenAt: null, lastContext: null, workflowStatus: 'in-progress',
})

const PROJECTS = [project('p', 'grove'), project('wt', 'grove · probe', 'p'), project('q', 'other')]

const railBlocks = () => listGroups(PROJECTS, [session('main', 'p'), session('probe', 'wt'), session('o', 'q')], {
  collapsed: [], hiddenProjects: [], groupBy: 'project', sessionSort: 'none',
}).flatMap((g) => [g, ...g.children]).filter((g) => g.sessions.length > 0)

const bars = () => {
  const tags = colorTags(PROJECTS, [])
  return Object.fromEntries(railBlocks().map((g) => [g.key, tagClass(tags.project(g.project!.id), 'fg')]))
}

describe('rail colour bars', () => {
  it('draws a repo, then its worktrees, then the next repo', () => {
    expect(railBlocks().map((g) => [g.key, g.sessions.map((s) => s.id)])).toEqual([
      ['p:p', ['main']],
      ['w:wt', ['probe']],
      ['p:q', ['o']],
    ])
  })

  it('gives every block a bar, a worktree wearing the colour of the repo it hangs under', () => {
    const drawn = bars()
    for (const [key, bar] of Object.entries(drawn)) expect(bar, key).toBeTruthy()
    expect(drawn['w:wt']).toBe(drawn['p:p'])
    expect(drawn['p:q']).not.toBe(drawn['p:p'])
  })
})