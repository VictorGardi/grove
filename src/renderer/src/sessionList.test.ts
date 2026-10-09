import { describe, expect, it } from 'vitest'
import type { Project, Session } from '@shared/types'
import { GROUP_BY_OPTIONS, listGroups, orderedSessions, SORT_OPTIONS, visibleSessions, type ListGroup } from './sessionList'

const project = (id: string, name = id): Project => ({ id, name, path: '/' + id })

function session(id: string, over: Partial<Session> = {}): Session {
  return {
    id, projectId: 'p', kind: 'terminal', label: id, labelPinned: false, tmuxName: 'grove-' + id,
    cwd: null, agentSessionId: null, feature: null, linkPinned: false, action: null,
    startedAt: '2026-10-05T10:00:00.000Z', endedAt: null, lastStatus: 'running', seenAt: null, lastContext: null, workflowStatus: 'in-progress', ...over,
  }
}

const at = (day: number, hour: number) => `2026-10-0${day}T${String(hour).padStart(2, '0')}:00:00.000Z`

// Projects P and Q, one session each plus two more in P, so config order, start
// order and hidden-project filtering all have something to bite on. Start times are
// all distinct: nothing here depends on how ties break.
const PROJECTS = [project('q', 'Project Q'), project('p', 'Project P')]
const SESSIONS = [
  session('b', { startedAt: at(5, 12) }),
  session('a'),
  session('z', { startedAt: at(5, 9) }),
  session('c', { projectId: 'q', startedAt: at(5, 11) }),
]

const ui = (over: Partial<Parameters<typeof listGroups>[2]> = {}) => ({
  collapsed: [] as string[], hiddenProjects: [] as string[], groupBy: 'project' as const, sessionSort: 'none' as const, ...over,
})

const shape = (groups: ListGroup[]) =>
  groups.map((g) => [g.key, g.label, g.project?.id ?? null, g.status, g.sessions.map((s) => s.id)])

const ids = (groups: ListGroup[]) => groups.flatMap((g) => g.sessions.map((s) => s.id))

describe('options', () => {
  it('offers the three groupings, project first', () => {
    expect(GROUP_BY_OPTIONS).toEqual([
      { value: 'project', label: 'Project' },
      { value: 'status', label: 'Workflow status' },
      { value: 'none', label: 'None' },
    ])
  })

  it('offers the five sorts, default first', () => {
    expect(SORT_OPTIONS).toEqual([
      { value: 'none', label: 'Default' },
      { value: 'viewed-desc', label: 'Last viewed ↓' },
      { value: 'viewed-asc', label: 'Last viewed ↑' },
      { value: 'created-desc', label: 'Created ↓' },
      { value: 'created-asc', label: 'Created ↑' },
    ])
  })
})

describe('listGroups by project', () => {
  it('makes one group per project in config order, with the project set and no status', () => {
    expect(shape(listGroups(PROJECTS, SESSIONS, ui()))).toEqual([
      ['p:q', 'Project Q', 'q', null, ['c']],
      ['p:p', 'Project P', 'p', null, ['z', 'a', 'b']],
    ])
  })

  it('drops sessions whose project is not configured', () => {
    expect(ids(listGroups(PROJECTS, [...SESSIONS, session('orphan', { projectId: 'gone' })], ui()))).toEqual(['c', 'z', 'a', 'b'])
  })
})

describe('listGroups by status', () => {
  it('makes every status group in workflow order, with the status set and no project', () => {
    const groups = listGroups(PROJECTS, SESSIONS, ui({ groupBy: 'status' }))
    expect(shape(groups)).toEqual([
      ['s:backlog', 'Backlog', null, 'backlog', []],
      ['s:in-progress', 'In Progress', null, 'in-progress', ['z', 'a', 'c', 'b']],
      ['s:blocked', 'Blocked', null, 'blocked', []],
      ['s:in-review', 'In Review', null, 'in-review', []],
      ['s:cancelled', 'Cancelled', null, 'cancelled', []],
      ['s:done', 'Done', null, 'done', []],
      ['s:pinned', 'Pinned', null, 'pinned', []],
    ])
  })

  it('keeps empty status groups so rows do not jump as statuses change', () => {
    const groups = listGroups(PROJECTS, [session('a', { workflowStatus: 'done' })], ui({ groupBy: 'status' }))
    expect(groups).toHaveLength(7)
    expect(groups.filter((g) => g.sessions.length > 0).map((g) => [g.key, g.sessions.map((s) => s.id)])).toEqual([['s:done', ['a']]])
  })
})

describe('listGroups ungrouped', () => {
  it('makes one "All sessions" group with neither project nor status', () => {
    expect(shape(listGroups(PROJECTS, SESSIONS, ui({ groupBy: 'none' })))).toEqual([
      ['all', 'All sessions', null, null, ['z', 'a', 'c', 'b']],
    ])
  })
})

describe('hidden projects', () => {
  it('drops a hidden project and its sessions from every grouping mode', () => {
    const hideQ = ui({ hiddenProjects: ['q'] })
    expect(shape(listGroups(PROJECTS, SESSIONS, hideQ))).toEqual([
      ['p:p', 'Project P', 'p', null, ['z', 'a', 'b']],
    ])
    expect(ids(listGroups(PROJECTS, SESSIONS, { ...hideQ, groupBy: 'status' }))).not.toContain('c')
    expect(ids(listGroups(PROJECTS, SESSIONS, { ...hideQ, groupBy: 'none' }))).toEqual(['z', 'a', 'b'])
  })

  it('hides every project when they are all hidden, grouping by status or not', () => {
    expect(listGroups(PROJECTS, SESSIONS, ui({ hiddenProjects: ['p', 'q'] }))).toEqual([])
    expect(ids(listGroups(PROJECTS, SESSIONS, ui({ hiddenProjects: ['p', 'q'], groupBy: 'none' })))).toEqual([])
  })
})

describe('sessionSort', () => {
  // n1/n2 have never been looked at; the rest were, at three different times. Start
  // times run the other way from last-viewed times, so a sort that confuses the two shows.
  const VIEWED = [
    session('a', { startedAt: at(5, 10), lastFocusedAt: at(6, 10) }),
    session('b', { startedAt: at(5, 12), lastFocusedAt: at(6, 12) }),
    session('c', { startedAt: at(5, 11), lastFocusedAt: at(6, 11) }),
    session('n1', { startedAt: at(5, 13) }),
    session('n2', { startedAt: at(5, 8) }),
  ]
  const bySort = (sessionSort: Parameters<typeof listGroups>[2]['sessionSort'], list = VIEWED) =>
    ids(listGroups(PROJECTS, list, ui({ groupBy: 'none', sessionSort })))

  it('sorts by start time under none and created-asc', () => {
    expect(bySort('none')).toEqual(['n2', 'a', 'c', 'b', 'n1'])
    expect(bySort('created-asc')).toEqual(['n2', 'a', 'c', 'b', 'n1'])
  })

  it('reverses start time under created-desc', () => {
    expect(bySort('created-desc')).toEqual(['n1', 'b', 'c', 'a', 'n2'])
  })

  it('ignores last viewed under the created orders', () => {
    const list = [
      session('old', { startedAt: at(5, 10), lastFocusedAt: at(6, 12) }),
      session('new', { startedAt: at(5, 12), lastFocusedAt: at(6, 8) }),
    ]
    expect(bySort('created-desc', list)).toEqual(['new', 'old'])
    expect(bySort('created-asc', list)).toEqual(['old', 'new'])
  })

  it('puts the most recently viewed first under viewed-desc', () => {
    expect(bySort('viewed-desc')).toEqual(['b', 'c', 'a', 'n2', 'n1'])
  })

  it('puts the least recently viewed first under viewed-asc', () => {
    expect(bySort('viewed-asc')).toEqual(['a', 'c', 'b', 'n2', 'n1'])
  })

  it('sinks never-viewed sessions to the bottom under both viewed orders', () => {
    for (const sessionSort of ['viewed-desc', 'viewed-asc'] as const) {
      const order = bySort(sessionSort)
      expect(order.slice(-2)).toEqual(['n2', 'n1'])
      expect(order.slice(0, 3).every((id) => id !== 'n1' && id !== 'n2')).toBe(true)
    }
  })

  it('sorts inside each group, not across groups', () => {
    const groups = listGroups(PROJECTS, [
      session('b', { startedAt: at(5, 12) }),
      session('a'),
      session('c', { projectId: 'q' }),
    ], ui({ sessionSort: 'created-desc' }))
    expect(shape(groups)).toEqual([
      ['p:q', 'Project Q', 'q', null, ['c']],
      ['p:p', 'Project P', 'p', null, ['b', 'a']],
    ])
  })

  it('sorts each status group on its own', () => {
    const groups = listGroups(PROJECTS, [
      session('b', { workflowStatus: 'done', startedAt: at(5, 12), lastFocusedAt: at(6, 8) }),
      session('a', { workflowStatus: 'done', startedAt: at(5, 10), lastFocusedAt: at(6, 12) }),
    ], ui({ groupBy: 'status', sessionSort: 'viewed-desc' }))
    expect(groups.find((g) => g.key === 's:done')?.sessions.map((s) => s.id)).toEqual(['a', 'b'])
  })
})

describe('collapsed', () => {
  it('reads project keys off the ui by group key', () => {
    const groups = listGroups(PROJECTS, SESSIONS, ui({ collapsed: ['p:q'] }))
    expect(groups.map((g) => [g.key, g.collapsed])).toEqual([['p:q', true], ['p:p', false]])
  })

  it('reads status keys off the ui by group key', () => {
    const groups = listGroups(PROJECTS, SESSIONS, ui({ groupBy: 'status', collapsed: ['s:done'] }))
    expect(groups.filter((g) => g.collapsed).map((g) => g.key)).toEqual(['s:done'])
  })

  it('reads the single ungrouped key off the ui', () => {
    expect(listGroups(PROJECTS, SESSIONS, ui({ groupBy: 'none', collapsed: ['all'] }))[0].collapsed).toBe(true)
  })

  it('does not let one key shape collapse another', () => {
    const groups = listGroups(PROJECTS, SESSIONS, ui({ collapsed: ['s:p', 'all', 'p:done'] }))
    expect(groups.map((g) => g.collapsed)).toEqual([false, false])
  })
})

describe('orderedSessions', () => {
  it('returns every visible session once, in group order, collapsed groups included', () => {
    for (const groupBy of ['project', 'status', 'none'] as const) {
      const groups = listGroups(PROJECTS, SESSIONS, ui({ groupBy, collapsed: ['p:p', 's:in-progress'] }))
      const order = orderedSessions(groups).map((s) => s.id)
      expect(new Set(order).size).toBe(SESSIONS.length)
      expect(order.sort()).toEqual(['a', 'b', 'c', 'z'])
    }
  })

  it('follows group order: status order, then config order', () => {
    expect(orderedSessions(listGroups(PROJECTS, SESSIONS, ui({ groupBy: 'status' }))).map((s) => s.id)).toEqual(['z', 'a', 'c', 'b'])
    expect(orderedSessions(listGroups(PROJECTS, SESSIONS, ui())).map((s) => s.id)).toEqual(['c', 'z', 'a', 'b'])
  })

  it('skips sessions in hidden projects', () => {
    const groups = listGroups(PROJECTS, SESSIONS, ui({ groupBy: 'none', hiddenProjects: ['q'] }))
    expect(orderedSessions(groups).map((s) => s.id)).toEqual(['z', 'a', 'b'])
  })
})

describe('visibleSessions', () => {
  it('drops collapsed groups, which is what a shift-click range runs over', () => {
    // p:p and s:in-progress collapsed: those groups' sessions are off screen, so a range must not
    // reach them — right-click then delete would otherwise remove sessions the human can't see.
    const byProject = listGroups(PROJECTS, SESSIONS, ui({ groupBy: 'project', collapsed: ['p:p'] }))
    expect(orderedSessions(byProject).map((s) => s.id)).toEqual(['c', 'z', 'a', 'b'])
    expect(visibleSessions(byProject).map((s) => s.id)).toEqual(['c'])

    // status keys collapse too. Groups come in WORKFLOW_STATUSES order, where in-progress
    // (index 1) comes before done (index 5): 'a' and 'c' are in-progress, 'b' is done.
    const mixed = [session('a', { workflowStatus: 'in-progress' }), session('b', { workflowStatus: 'done' }), session('c', { projectId: 'q' })]
    const byStatus = listGroups(PROJECTS, mixed, ui({ groupBy: 'status', collapsed: ['s:in-progress'] }))
    expect(orderedSessions(byStatus).map((s) => s.id)).toEqual(['a', 'c', 'b'])
    expect(visibleSessions(byStatus).map((s) => s.id)).toEqual(['b'])
  })

  it('is orderedSessions when nothing is collapsed', () => {
    const groups = listGroups(PROJECTS, SESSIONS, ui({ groupBy: 'project' }))
    expect(visibleSessions(groups)).toEqual(orderedSessions(groups))
  })
})