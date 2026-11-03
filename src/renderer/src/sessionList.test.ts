import { describe, expect, it } from 'vitest'
import type { Project, Session } from '@shared/types'
import { canDrop, dropSession, groupSize, kidRows, kidsGroup, listGroups, orderedSessions, SORT_OPTIONS, visibleSessions, type ListGroup } from './sessionList'

const project = (id: string, name = id, worktreeOf?: string): Project => ({ id, name, path: '/' + id, ...(worktreeOf && { worktreeOf }) })

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
  collapsed: [] as string[], hiddenProjects: [] as string[], sessionSort: 'custom' as const, sessionOrder: [] as string[], ...over,
})

const shape = (groups: ListGroup[]) =>
  groups.map((g) => [g.key, g.label, g.project?.id ?? null, g.sessions.map((s) => s.id)])

const ids = (groups: ListGroup[]) => groups.flatMap((g) => g.sessions.map((s) => s.id))

describe('options', () => {
  it('offers the six sorts, custom first', () => {
    expect(SORT_OPTIONS).toEqual([
      { value: 'custom', label: 'Custom' },
      { value: 'viewed-desc', label: 'Last viewed ↓' },
      { value: 'viewed-asc', label: 'Last viewed ↑' },
      { value: 'created-desc', label: 'Created ↓' },
      { value: 'created-asc', label: 'Created ↑' },
      { value: 'status-age', label: 'Time in status' },
    ])
  })
})

describe('time-in-status sort', () => {
  it('puts what waits on you first, longest first, then the rest by time in status', () => {
    const at = (ms: number) => new Date(ms).toISOString()
    const list = [
      session('idle-old', { status: 'idle', statusAt: at(10) }),
      session('waiting-new', { status: 'waiting', waitingFor: 'permission', statusAt: at(500) }),
      session('working', { status: 'working', statusAt: at(300) }),
      session('finished-old', { status: 'waiting', waitingFor: 'done', statusAt: at(200) }),
    ]
    expect(ids(listGroups(PROJECTS, list, ui({ sessionSort: 'status-age' }))))
      .toEqual(['finished-old', 'waiting-new', 'idle-old', 'working'])
  })
})

describe('time-in-status sort and children', () => {
  it('does not put a finished child among the sessions that wait on you', () => {
    const at = (ms: number) => new Date(ms).toISOString()
    const list = [
      session('idle', { status: 'idle', statusAt: at(300) }),
      session('kid-done', { link: { id: 'x', kind: 'group' }, status: 'waiting', waitingFor: 'done', statusAt: at(100) }),
      session('kid-ask', { link: { id: 'x', kind: 'group' }, status: 'waiting', waitingFor: 'question', statusAt: at(400) }),
    ]
    expect(ids(listGroups(PROJECTS, list, ui({ sessionSort: 'status-age' }))).slice(0, 1)).toEqual(['kid-ask'])
    expect(ids(listGroups(PROJECTS, list, ui({ sessionSort: 'status-age' })))).toEqual(['kid-ask', 'kid-done', 'idle'])
  })
})

describe('listGroups by project', () => {
  it('makes one group per project in config order, with the project set', () => {
    expect(shape(listGroups(PROJECTS, SESSIONS, ui()))).toEqual([
      ['p:q', 'Project Q', 'q', ['c']],
      ['p:p', 'Project P', 'p', ['z', 'a', 'b']],
    ])
  })

  it('drops sessions whose project is not configured', () => {
    expect(ids(listGroups(PROJECTS, [...SESSIONS, session('orphan', { projectId: 'gone' })], ui()))).toEqual(['c', 'z', 'a', 'b'])
  })
})

describe('hidden projects', () => {
  it('drops a hidden project and its sessions ', () => {
    const hideQ = ui({ hiddenProjects: ['q'] })
    expect(shape(listGroups(PROJECTS, SESSIONS, hideQ))).toEqual([
      ['p:p', 'Project P', 'p', ['z', 'a', 'b']],
    ])
    expect(ids(listGroups(PROJECTS, SESSIONS, hideQ))).not.toContain('c')
  })

  it('hides every project when they are all hidden', () => {
    expect(listGroups(PROJECTS, SESSIONS, ui({ hiddenProjects: ['p', 'q'] }))).toEqual([])
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
    ids(listGroups(PROJECTS, list, ui({ sessionSort })))

  it('sorts by start time under created-asc, and under custom with nothing placed', () => {
    expect(bySort('custom')).toEqual(['n2', 'a', 'c', 'b', 'n1'])
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
      ['p:q', 'Project Q', 'q', ['c']],
      ['p:p', 'Project P', 'p', ['b', 'a']],
    ])
  })
})

describe('collapsed', () => {
  it('reads project keys off the ui by group key', () => {
    const groups = listGroups(PROJECTS, SESSIONS, ui({ collapsed: ['p:q'] }))
    expect(groups.map((g) => [g.key, g.collapsed])).toEqual([['p:q', true], ['p:p', false]])
  })

  it('does not let one key shape collapse another', () => {
    const groups = listGroups(PROJECTS, SESSIONS, ui({ collapsed: ['s:p', 'all', 'p:done'] }))
    expect(groups.map((g) => g.collapsed)).toEqual([false, false])
  })
})

// One repo: its checkout 'p' and two worktrees of it.
const REPO_SESSIONS = [
  session('main', { projectId: 'p' }),
  session('inWt', { projectId: 'wt1', startedAt: at(5, 10) }),
  session('inWt2', { projectId: 'wt2', startedAt: at(5, 11) }),
  session('other', { projectId: 'q', startedAt: at(5, 9) }),
]
const REPO_ALL = [project('p', 'Project P'), project('wt1', 'Project P · a', 'p'), project('wt2', 'Project P · b', 'p'), project('q', 'Project Q')]

describe('listGroups for worktrees', () => {
  it('puts a worktree\'s sessions in its repo\'s group, sorted with the repo\'s own', () => {
    expect(shape(listGroups(REPO_ALL, REPO_SESSIONS, ui()))).toEqual([
      ['p:p', 'Project P', 'p', ['main', 'inWt', 'inWt2']],
      ['p:q', 'Project Q', 'q', ['other']],
    ])
  })

  it('collapses the repo group with its worktree sessions in it', () => {
    const groups = listGroups(REPO_ALL, REPO_SESSIONS, ui({ collapsed: ['p:p'] }))
    expect(groups.map((g) => [g.key, g.collapsed])).toEqual([['p:p', true], ['p:q', false]])
    expect(visibleSessions(groups).map((s) => s.id)).toEqual(['other'])
    expect(orderedSessions(groups).map((s) => s.id)).toEqual(['main', 'inWt', 'inWt2', 'other'])
  })

  it('hides a repo and its worktrees together; a worktree is not a hide key of its own', () => {
    const groups = listGroups(REPO_ALL, REPO_SESSIONS, ui({ hiddenProjects: ['p'] }))
    expect(groups.map((g) => g.project?.id)).toEqual(['q'])
    expect(ids(groups)).toEqual(['other'])
    // a worktree id in hiddenProjects is inert rather than a row hidden from under its repo:
    // the repo is the unit, so nothing can hide a checkout the human cannot see listed
    const stale = listGroups(REPO_ALL, REPO_SESSIONS, ui({ hiddenProjects: ['wt1'] }))
    expect(orderedSessions(stale).map((s) => s.id)).toEqual(['main', 'inWt', 'inWt2', 'other'])
  })
})

describe('orderedSessions', () => {
  it('returns every visible session once, in group order, collapsed groups included', () => {
    const groups = listGroups(PROJECTS, SESSIONS, ui({ collapsed: ['p:p'] }))
    const order = orderedSessions(groups).map((s) => s.id)
    expect(new Set(order).size).toBe(SESSIONS.length)
    expect(order.sort()).toEqual(['a', 'b', 'c', 'z'])
  })

  it('follows group order: config order', () => {
    expect(orderedSessions(listGroups(PROJECTS, SESSIONS, ui())).map((s) => s.id)).toEqual(['c', 'z', 'a', 'b'])
  })

  it('skips sessions in hidden projects', () => {
    const groups = listGroups(PROJECTS, SESSIONS, ui({ hiddenProjects: ['q'] }))
    expect(orderedSessions(groups).map((s) => s.id)).toEqual(['z', 'a', 'b'])
  })
})

describe('visibleSessions', () => {
  it('drops collapsed groups, which is what a shift-click range runs over', () => {
    // p:p collapsed: those groups' sessions are off screen, so a range must not
    // reach them — right-click then delete would otherwise remove sessions the human can't see.
    const byProject = listGroups(PROJECTS, SESSIONS, ui({ collapsed: ['p:p'] }))
    expect(orderedSessions(byProject).map((s) => s.id)).toEqual(['c', 'z', 'a', 'b'])
    expect(visibleSessions(byProject).map((s) => s.id)).toEqual(['c'])
  })

  it('is orderedSessions when nothing is collapsed', () => {
    const groups = listGroups(PROJECTS, SESSIONS, ui())
    expect(visibleSessions(groups)).toEqual(orderedSessions(groups))
  })
})

describe('custom order', () => {
  const custom = (sessionOrder: string[], over: Partial<Parameters<typeof listGroups>[2]> = {}, list = SESSIONS) =>
    listGroups(PROJECTS, list, ui({ sessionSort: 'custom', sessionOrder, ...over }))

  it('reads in the saved order inside each project group', () => {
    expect(ids(custom(['b', 'a', 'z', 'c']))).toEqual(['c', 'b', 'a', 'z'])
  })

  it('sinks sessions missing from the order below the placed ones, in creation order', () => {
    expect(ids(custom(['b']))).toEqual(['c', 'b', 'z', 'a'])
    expect(ids(custom(['a', 'gone']))).toEqual(['c', 'a', 'z', 'b'])
  })

  it('feeds orderedSessions, which Cmd+1..9 reads', () => {
    expect(orderedSessions(custom(['c', 'a', 'b', 'z'])).map((s) => s.id)).toEqual(['c', 'a', 'b', 'z'])
  })
})

describe('dropSession', () => {
  const group = (over: Partial<Parameters<typeof listGroups>[2]> = {}) =>
    listGroups(PROJECTS, SESSIONS, ui({ sessionOrder: ['z', 'a', 'b', 'c'], ...over }))
  const byId = (id: string) => SESSIONS.find((s) => s.id === id)!
  const ORDER = ['z', 'a', 'b', 'c']

  it('moves a card before and after a neighbour in its group', () => {
    const [, p] = group()
    expect(dropSession(SESSIONS, ORDER, byId('b'), p, p, { target: 'z', after: false })?.order).toEqual(['b', 'z', 'a', 'c'])
    expect(dropSession(SESSIONS, ORDER, byId('z'), p, p, { target: 'b', after: true })?.order).toEqual(['a', 'b', 'z', 'c'])
  })

  it('does nothing for a drop that leaves the order as it was', () => {
    const [, p] = group()
    expect(dropSession(SESSIONS, ORDER, byId('a'), p, p, { target: 'a', after: false })).toBeNull()
    expect(dropSession(SESSIONS, ORDER, byId('z'), p, p, { target: 'a', after: false })).toBeNull()
  })

  it('refuses another project', () => {
    const [q, p] = group()
    expect(dropSession(SESSIONS, ORDER, byId('a'), p, q, { target: 'c', after: false })).toBeNull()
  })

  it('moves a card to the end of its group when dropped on no neighbour', () => {
    const [, p] = group()
    expect(dropSession(SESSIONS, ORDER, byId('a'), p, p, null)?.order).toEqual(['z', 'b', 'a', 'c'])
  })
})

describe('session groups', () => {
  // r leads k1 and k2, one of which runs in another project; s stands alone
  const sessions = [
    session('r', { startedAt: at(5, 8) }),
    session('k1', { link: { id: 'r', kind: 'group' }, startedAt: at(5, 9) }),
    session('k2', { link: { id: 'r', kind: 'group' }, projectId: 'q', startedAt: at(5, 10) }),
    session('s', { startedAt: at(5, 11) }),
  ]

  it('draws a child under its parent, wherever it runs, and not as a row of its own', () => {
    const g = listGroups(PROJECTS, sessions, ui())
    expect(shape(g)).toEqual([['p:q', 'Project Q', 'q', []], ['p:p', 'Project P', 'p', ['r', 's']]])
    expect(g[0].nest.kids.get('r')?.map((s) => s.id)).toEqual(['k1', 'k2'])
    expect(groupSize(g[1])).toBe(4)
  })

  it('keeps a child whose parent is hidden or missing as a row of its own', () => {
    expect(ids(listGroups(PROJECTS, sessions, ui({ hiddenProjects: ['p'] })))).toEqual(['k2'])
    expect(ids(listGroups(PROJECTS, [session('k1', { link: { id: 'gone', kind: 'group' } })], ui()))).toEqual(['k1'])
  })

  it('keeps a child of a child as a row, so no card is ever lost', () => {
    expect(ids(listGroups(PROJECTS, [session('r'), session('k', { link: { id: 'r', kind: 'group' } }), session('x', { link: { id: 'k', kind: 'group' } })], ui()))).toEqual(['r', 'x'])
  })

  it('counts children through Cmd+1..9 only while the parent is expanded; a range likewise', () => {
    expect(orderedSessions(listGroups(PROJECTS, sessions, ui())).map((s) => s.id)).toEqual(['r', 'k1', 'k2', 's'])
    expect(orderedSessions(listGroups(PROJECTS, sessions, ui({ collapsed: ['k:r'] }))).map((s) => s.id)).toEqual(['r', 's'])
    expect(visibleSessions(listGroups(PROJECTS, sessions, ui({ collapsed: ['k:r'] }))).map((s) => s.id)).toEqual(['r', 's'])
  })

  it('lets a child reorder only among its siblings', () => {
    const g = listGroups(PROJECTS, sessions, ui())
    const p = g[1]
    const kg = kidsGroup(p, p.sessions[0])
    expect(canDrop(kg, p)).toBe(false)
    expect(canDrop(p, kg)).toBe(false)
    expect(canDrop(kg, kg)).toBe(true)
    const moved = dropSession(sessions, [], sessions[1], kg, kg, { target: 'k2', after: true })
    expect(moved?.order.filter((id) => id.startsWith('k'))).toEqual(['k2', 'k1'])
  })
})

describe('done stacks', () => {
  // r leads four children in start order; d1 and d2 are done, with k1 between them
  const sessions = [
    session('r', { startedAt: at(5, 8) }),
    session('k0', { link: { id: 'r', kind: 'group' }, startedAt: at(5, 9) }),
    session('d1', { link: { id: 'r', kind: 'group' }, startedAt: at(5, 10), workflowStatus: 'done' }),
    session('k1', { link: { id: 'r', kind: 'group' }, startedAt: at(5, 11) }),
    session('d2', { link: { id: 'r', kind: 'group' }, startedAt: at(5, 12), workflowStatus: 'done' }),
  ]
  const rows = (collapsed: string[] = []) => kidRows(listGroups(PROJECTS, sessions, ui({ collapsed })).find((g) => g.key === 'p:p')!.nest, 'r')
    .map((r) => 'session' in r ? r.session.id : `[${r.stack.list.map((s) => s.id).join(' ')}${r.stack.open ? ' open' : ''}]`)

  it('folds two or more done children into one stack, below the rest', () => {
    expect(rows()).toEqual(['k0', 'k1', '[d1 d2]'])
  })

  it('leaves a lone done child as a row of its own, last', () => {
    const g = listGroups(PROJECTS, sessions.slice(0, 4), ui())
    expect(kidRows(g[1].nest, 'r').map((r) => 'session' in r && r.session.id)).toEqual(['k0', 'k1', 'd1'])
  })

  it('starts folded and opens by its opened key', () => {
    expect(rows(['o:d:r'])).toEqual(['k0', 'k1', '[d1 d2 open]'])
  })

  it('counts a stack\'s children through Cmd+1..9 and a range only while it is open', () => {
    expect(orderedSessions(listGroups(PROJECTS, sessions, ui())).map((s) => s.id)).toEqual(['r', 'k0', 'k1'])
    expect(visibleSessions(listGroups(PROJECTS, sessions, ui())).map((s) => s.id)).toEqual(['r', 'k0', 'k1'])
    expect(orderedSessions(listGroups(PROJECTS, sessions, ui({ collapsed: ['o:d:r'] }))).map((s) => s.id)).toEqual(['r', 'k0', 'k1', 'd1', 'd2'])
    expect(orderedSessions(listGroups(PROJECTS, sessions, ui({ collapsed: ['o:d:r', 'k:r'] }))).map((s) => s.id)).toEqual(['r'])
  })

  it('still counts a folded stack in the group size', () => {
    expect(groupSize(listGroups(PROJECTS, sessions, ui())[1])).toBe(5)
  })
})

describe('hideDone', () => {
  const sessions = [session('a'), session('b', { workflowStatus: 'done' })]
  it('leaves done sessions out, and keeps them when off', () => {
    expect(ids(listGroups(PROJECTS, sessions, ui({ hideDone: true })))).toEqual(['a'])
    expect(ids(listGroups(PROJECTS, sessions, ui()))).toEqual(expect.arrayContaining(['a', 'b']))
  })
})
