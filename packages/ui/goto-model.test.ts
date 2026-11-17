import { describe, expect, it } from 'vitest'
import { fuzzyMatch, goToView, marksOf, RECENT_SPACES, toggleMark, unnamedTabName, type GoToInput, type GoToSpace, type GoToTab } from './goto-model.ts'

function space(id: string, name = id, extra: Partial<GoToSpace> = {}): GoToSpace {
  return { id, name, label: null, parent: null, worktree: false, repoName: null, branch: null, ...extra }
}

function tab(id: string, spaceId: string, name: string, extra: Partial<GoToTab> = {}): GoToTab {
  return { id, spaceId, name, agent: null, state: 'idle', ...extra }
}

function input(extra: Partial<GoToInput>): GoToInput {
  return { spaces: [], tabs: [], recent: [], activeSpaceId: null, activeTabId: null, query: '', expandQuiet: false, ...extra }
}

describe('goToView', () => {
  it('lists a space with its tabs under it', () => {
    const view = goToView(input({ spaces: [space('a', 'grove')], tabs: [tab('t1', 'a', '1'), tab('t2', 'a', '2')], activeSpaceId: 'a' }))
    expect(view.groups.map((group) => [group.name, group.rows.map((row) => row.name)])).toEqual([['grove', ['1', '2']]])
  })

  it('orders spaces and their tabs by recent use, the current space first', () => {
    const view = goToView(
      input({
        spaces: [space('a'), space('b'), space('c')],
        tabs: [tab('a1', 'a', '1'), tab('a2', 'a', '2'), tab('b1', 'b', '1'), tab('c1', 'c', '1')],
        recent: ['c1', 'a2', 'b1'],
        activeSpaceId: 'b',
        activeTabId: 'b1',
        expandQuiet: true,
      }),
    )
    expect(view.groups.map((group) => group.spaceId)).toEqual(['b', 'c', 'a'])
    expect(view.groups[2].rows.map((row) => row.tabId)).toEqual(['a2', 'a1'])
  })

  describe('quiet spaces', () => {
    // b is current, a has a tab with something for the human, c and d are idle and never visited.
    const base = {
      spaces: [space('a'), space('b'), space('c'), space('d')],
      tabs: [tab('a1', 'a', '1', { state: 'finished' }), tab('b1', 'b', '1'), tab('c1', 'c', '1'), tab('d1', 'd', '1', { state: 'unknown' })],
      recent: ['b1', 'a1'],
      activeSpaceId: 'b',
      activeTabId: 'b1',
    }

    it('collapses the idle spaces that are not current behind a count', () => {
      const view = goToView(input(base))
      expect(view.groups.map((group) => group.spaceId)).toEqual(['a', 'b'])
      expect(view.quiet).toEqual({ count: 2, expanded: false, last: null })
    })

    it('lists them after the others when expanded', () => {
      const view = goToView(input({ ...base, expandQuiet: true }))
      expect(view.groups.map((group) => group.spaceId)).toEqual(['a', 'b', 'c', 'd'])
      expect(view.quiet).toEqual({ count: 2, expanded: true, last: null })
    })

    it('has no quiet part when every space is current or busy', () => {
      const view = goToView(input({ ...base, spaces: [space('a'), space('b')], tabs: base.tabs.slice(0, 2) }))
      expect(view.quiet).toBeNull()
    })

    describe('by recent use', () => {
      // An idle space per name, the current one first in `recent`, then the others from the most recently visited.
      const names = ['cur', ...Array.from({ length: RECENT_SPACES + 2 }, (_, i) => `s${i}`)]
      const spaces = names.map((name) => space(name))
      const tabs = names.map((name) => tab(`${name}-1`, name, '1'))
      const recent = names.map((name) => `${name}-1`)
      const view = goToView(input({ spaces, tabs, recent, activeSpaceId: 'cur', activeTabId: 'cur-1' }))

      it('keeps an idle space listed while it is among the most recently visited', () => {
        expect(view.groups.map((group) => group.spaceId)).toEqual(['cur', ...names.slice(1, 1 + RECENT_SPACES)])
      })

      it('collapses the older ones, and names the most recent of them', () => {
        expect(view.quiet).toEqual({ count: 2, expanded: false, last: `s${RECENT_SPACES}` })
      })

      it('does not count the current space among the recent ones', () => {
        const without = goToView(input({ spaces, tabs, recent: recent.slice(1), activeSpaceId: 'cur', activeTabId: null }))
        expect(without.groups.map((group) => group.spaceId)).toContain(`s${RECENT_SPACES - 1}`)
        expect(without.groups.map((group) => group.spaceId)).not.toContain(`s${RECENT_SPACES}`)
      })
    })
  })

  describe('urgency', () => {
    const base = {
      spaces: [space('a', 'a'), space('b', 'b'), space('c', 'c'), space('d', 'd'), space('e', 'e')],
      tabs: [
        tab('a1', 'a', '1'),
        tab('b1', 'b', '1', { state: 'working' }),
        tab('c1', 'c', '1', { state: 'finished' }),
        tab('d1', 'd', '1', { state: 'needs-you', reason: 'permission' }),
        tab('e1', 'e', '1'),
      ],
      recent: ['a1', 'b1', 'c1', 'd1', 'e1'],
      activeSpaceId: 'a',
      activeTabId: 'a1',
    }

    it('puts spaces that need you first, then finished, then the current one, then working, then the rest', () => {
      expect(goToView(input(base)).groups.map((group) => group.spaceId)).toEqual(['d', 'c', 'a', 'b', 'e'])
    })

    it('puts the tabs that need you first within a space', () => {
      const view = goToView(
        input({
          spaces: [space('a')],
          tabs: [tab('t1', 'a', '1'), tab('t2', 'a', '2', { state: 'working' }), tab('t3', 'a', '3', { state: 'needs-you' }), tab('t4', 'a', '4', { state: 'finished' })],
          recent: ['t1', 't2', 't3', 't4'],
          activeSpaceId: 'a',
        }),
      )
      expect(view.groups[0].rows.map((row) => row.tabId)).toEqual(['t3', 't4', 't2', 't1'])
    })

    it('adds the reason to a needs-you row', () => {
      const rows = goToView(input(base)).groups.flatMap((group) => group.rows)
      expect(rows.find((row) => row.tabId === 'd1')?.stateLabel).toBe('needs you · permission')
    })

    it('says only that it needs you when the agent gave no reason', () => {
      const view = goToView(input({ spaces: [space('a')], tabs: [tab('t1', 'a', '1', { state: 'needs-you' })], activeSpaceId: 'a' }))
      expect(view.groups[0].rows[0].stateLabel).toBe('needs you')
    })
  })

  describe('state filters', () => {
    const base = {
      spaces: [space('a', 'grove'), space('b', 'notes')],
      tabs: [
        tab('a1', 'a', 'build', { state: 'needs-you' }),
        tab('a2', 'a', 'review', { state: 'working' }),
        tab('b1', 'b', 'build', { state: 'working' }),
        tab('b2', 'b', 'todo'),
      ],
      recent: ['a1', 'a2', 'b1', 'b2'],
      activeSpaceId: 'a',
    }
    const matched = (query: string) => goToView(input({ ...base, query })).groups.map((group) => [group.spaceId, group.rows.map((row) => row.tabId)])

    it('keeps the tabs that need you with !', () => {
      expect(matched('!')).toEqual([['a', ['a1']]])
    })

    it('keeps the tabs that are working with ~, in quiet spaces too', () => {
      expect(matched('~')).toEqual([
        ['a', ['a2']],
        ['b', ['b1']],
      ])
    })

    it('combines with words, in the same word or apart', () => {
      expect(matched('~build')).toEqual([['b', ['b1']]])
      expect(matched('~ notes')).toEqual([['b', ['b1']]])
    })

    it('keeps both states when both marks are given', () => {
      expect(matched('!~')).toEqual([
        ['a', ['a1', 'a2']],
        ['b', ['b1']],
      ])
    })
  })

  describe('query', () => {
    const base = {
      spaces: [space('a', 'grove'), space('b', 'test-grove'), space('c', 'notes')],
      tabs: [
        tab('a1', 'a', 'build'),
        tab('a2', 'a', 'review', { agent: 'claude', state: 'working' }),
        tab('b1', 'b', 'build'),
        tab('c1', 'c', 'todo', { agent: 'opencode' }),
      ],
      recent: ['a1', 'a2', 'b1', 'c1'],
      activeSpaceId: 'a',
      activeTabId: 'a1',
    }
    const matched = (query: string) => goToView(input({ ...base, query })).groups.map((group) => [group.spaceId, group.rows.map((row) => row.tabId)])

    it('matches a tab by a fuzzy subsequence of its name, case-insensitively', () => {
      expect(matched('RVW')).toEqual([['a', ['a2']]])
    })

    it('keeps every tab of a space whose name matches', () => {
      expect(matched('notes')).toEqual([['c', ['c1']]])
      expect(matched('test-g')).toEqual([['b', ['b1']]])
    })

    it('matches a tab by its agent name', () => {
      expect(matched('claude')).toEqual([['a', ['a2']]])
      expect(matched('opencode')).toEqual([['c', ['c1']]])
    })

    it('searches quiet spaces too, with no collapsed part', () => {
      const view = goToView(input({ ...base, query: 'todo' }))
      expect(view.groups.map((group) => group.spaceId)).toEqual(['c'])
      expect(view.quiet).toBeNull()
    })

    it('finds the worktrees of a repo by the repo name, with the repo itself', () => {
      const view = goToView(
        input({
          spaces: [space('a', 'platform'), space('b', 'feature-x', { parent: 'a', worktree: true }), space('c', 'orphan', { worktree: true, repoName: 'platform' }), space('d', 'notes')],
          tabs: [tab('a1', 'a', '1'), tab('b1', 'b', '1'), tab('c1', 'c', '1'), tab('d1', 'd', '1')],
          activeSpaceId: 'd',
          query: 'platform',
        }),
      )
      expect(view.groups.map((group) => group.spaceId).sort()).toEqual(['a', 'b', 'c'])
    })

    it('shows nothing when nothing matches', () => {
      expect(matched('zzz')).toEqual([])
    })
  })

  describe('ranking', () => {
    it('puts the better match first, and the more recent of equals', () => {
      const view = goToView(
        input({
          spaces: [space('a', 'grove')],
          tabs: [tab('t1', 'a', 'unbuilt'), tab('t2', 'a', 'build'), tab('t3', 'a', 'build'), tab('t4', 'a', 'x')],
          recent: ['t3', 't1', 't2', 't4'],
          activeSpaceId: 'a',
          query: 'bu',
        }),
      )
      expect(view.groups[0].rows.map((row) => row.tabId)).toEqual(['t3', 't2', 't1'])
    })

    it('needs every word of the query to match, each against the tab, space or agent', () => {
      const view = goToView(
        input({
          spaces: [space('a', 'grove'), space('b', 'notes')],
          tabs: [tab('a1', 'a', 'build', { agent: 'claude' }), tab('a2', 'a', 'review'), tab('b1', 'b', 'build')],
          activeSpaceId: 'a',
          query: 'grove build',
        }),
      )
      expect(view.groups.map((group) => group.rows.map((row) => row.tabId))).toEqual([['a1']])
    })

    it('puts the space with the best match first', () => {
      const view = goToView(
        input({
          spaces: [space('a', 'alpha'), space('b', 'beta')],
          tabs: [tab('a1', 'a', 'api'), tab('b1', 'b', 'a1pi-extra-long')],
          recent: ['b1', 'a1'],
          activeSpaceId: 'a',
          query: 'api',
        }),
      )
      expect(view.groups.map((group) => group.spaceId)).toEqual(['a', 'b'])
    })
  })

  describe('rows and groups', () => {
    it('names the agent and the state only when there is something to say', () => {
      const view = goToView(
        input({
          spaces: [space('a')],
          tabs: [
            tab('t1', 'a', '1', { agent: 'claude', state: 'finished' }),
            tab('t2', 'a', '2', { agent: 'copilot' }),
            tab('t3', 'a', '3'),
            tab('t4', 'a', '4', { agent: 'opencode', state: 'unknown' }),
          ],
          recent: ['t1', 't2', 't3', 't4'],
          activeSpaceId: 'a',
        }),
      )
      expect(view.groups[0].rows.map((row) => [row.agentName, row.stateLabel])).toEqual([
        ['Claude Code', 'finished'],
        ['Copilot', null],
        [null, null],
        ['OpenCode', null],
      ])
      expect(view.groups[0].rows[0].state).toBe('finished')
    })

    it('says which space a worktree belongs to', () => {
      const view = goToView(
        input({
          spaces: [space('a', 'grove'), space('b', 'feature', { parent: 'a', worktree: true }), space('c', 'orphan', { worktree: true, repoName: 'other' })],
          tabs: [tab('a1', 'a', '1'), tab('b1', 'b', '1'), tab('c1', 'c', '1')],
          activeSpaceId: 'a',
          expandQuiet: true,
        }),
      )
      expect(view.groups.map((group) => [group.spaceId, group.worktreeOf])).toEqual([
        ['a', null],
        ['b', 'grove'],
        ['c', 'other'],
      ])
    })

    it('puts a repo\'s spaces under one heading, named as the sidebar names its rows', () => {
      const view = goToView(
        input({
          spaces: [
            space('a', 'grove', { repoName: 'grove', branch: 'master' }),
            space('x', 'lone'),
            space('b', 'feature', { parent: 'a', worktree: true, repoName: 'grove' }),
          ],
          tabs: [tab('a1', 'a', '1'), tab('x1', 'x', '1', { state: 'needs-you' }), tab('b1', 'b', '1', { state: 'working' })],
          recent: ['b1', 'a1', 'x1'],
          activeSpaceId: 'b',
          expandQuiet: true,
        }),
      )
      // The needs-you space leads; the heading stands where its first space is, and its spaces keep Go to's order within it.
      expect(view.groups.map((group) => [group.spaceId, group.repo, group.name])).toEqual([
        ['x', null, 'lone'],
        ['b', 'grove', 'feature'],
        ['a', 'grove', 'master'],
      ])
    })

    it('keeps a lone worktree under its repo\'s heading and gives a space its most urgent live state', () => {
      const view = goToView(
        input({
          spaces: [space('b', 'feature', { worktree: true, repoName: 'grove' }), space('c', 'empty'), space('d', 'gone')],
          tabs: [tab('b1', 'b', '1', { state: 'working' }), tab('b2', 'b', '2', { state: 'finished' }), tab('d1', 'd', '1', { state: 'needs-you', exited: true })],
          activeSpaceId: 'b',
          expandQuiet: true,
        }),
      )
      const by = (id: string) => view.groups.find((group) => group.spaceId === id)!
      expect(by('b')).toMatchObject({ repo: 'grove', state: 'finished', empty: false })
      expect(by('c')).toMatchObject({ repo: null, state: 'idle', empty: true })
      expect(by('d')).toMatchObject({ state: 'idle', empty: true })
    })

    it('draws a space\'s state whole while a query keeps some of its tabs', () => {
      const view = goToView(input({ spaces: [space('a')], tabs: [tab('a1', 'a', 'one'), tab('a2', 'a', 'two', { state: 'needs-you' })], query: 'one', activeSpaceId: 'a' }))
      expect(view.groups[0]).toMatchObject({ state: 'needs-you' })
      expect(view.groups[0].rows.map((row) => row.name)).toEqual(['one'])
    })

    it('starts on the current tab, or on the top match when there is a query', () => {
      const base = {
        spaces: [space('a', 'grove'), space('b', 'notes')],
        tabs: [tab('a1', 'a', 'one'), tab('a2', 'a', 'two'), tab('b1', 'b', 'target', { state: 'working' })],
        recent: ['a2', 'a1', 'b1'],
        activeSpaceId: 'a',
        activeTabId: 'a1',
      }
      expect(goToView(input(base)).highlight).toBe('a1')
      expect(goToView(input({ ...base, query: 'targ' })).highlight).toBe('b1')
      expect(goToView(input({ ...base, query: 'zzz' })).highlight).toBeNull()
    })

    it('starts on the first row when the current tab is hidden among quiet spaces', () => {
      const view = goToView(
        input({ spaces: [space('a'), space('b')], tabs: [tab('a1', 'a', '1'), tab('b1', 'b', '1')], recent: ['a1'], activeSpaceId: 'a', activeTabId: 'b1' }),
      )
      expect(view.highlight).toBe('a1')
    })
  })
})

describe('filter marks', () => {
  it('finds the marks at the start of any word', () => {
    expect([...marksOf('')]).toEqual([])
    expect([...marksOf('!')]).toEqual(['!'])
    expect([...marksOf('grove ~build')]).toEqual(['~'])
    expect([...marksOf('!~x')].sort()).toEqual(['!', '~'])
    expect([...marksOf('a!b')]).toEqual([])
  })

  it('puts a mark in front of the query, or takes it off every word that has it', () => {
    expect(toggleMark('', '!')).toBe('!')
    expect(toggleMark('grove', '~')).toBe('~grove')
    expect(toggleMark('!', '!')).toBe('')
    expect(toggleMark('!grove build', '!')).toBe('grove build ')
    expect(toggleMark('!~x', '!')).toBe('~x ')
    expect(toggleMark('~ notes', '~')).toBe('notes ')
  })

  describe('the tree', () => {
    it('marks a space with one tab as a single row, and counts the tabs of the others', () => {
      const view = goToView(input({ spaces: [space('a'), space('b'), space('c')], tabs: [tab('a1', 'a', '1'), tab('b1', 'b', '1'), tab('b2', 'b', '2')], activeSpaceId: 'a', expandQuiet: true }))
      const by = (id: string) => view.groups.find((group) => group.spaceId === id)!
      expect(by('a')).toMatchObject({ single: true, tabCount: 1 })
      expect(by('b')).toMatchObject({ single: false, tabCount: 2 })
      expect(by('c')).toMatchObject({ single: false, tabCount: 0 })
      expect(view.results).toBeNull()
    })

    it('counts the tabs that need you and are working, and keeps the tree for a state filter alone', () => {
      const tabs = [tab('a1', 'a', 'x', { state: 'needs-you' }), tab('a2', 'a', 'y', { state: 'working' }), tab('a3', 'a', 'z', { state: 'working' })]
      const view = goToView(input({ spaces: [space('a')], tabs, query: '!', activeSpaceId: 'a' }))
      expect(view.counts).toEqual({ needsYou: 1, working: 2 })
      expect(view.results).toBeNull()
      expect(view.rows.map((row) => row.tabId)).toEqual(['a1'])
    })
  })

  describe('results for a query', () => {
    const spaces = [space('a', 'ass-121', { repoName: 'plat', branch: 'ass-121' }), space('b', 'main', { repoName: 'plat', branch: 'main' }), space('c', 'other', { repoName: 'plat', worktree: true, parent: 'b' })]
    const tabs = [
      tab('a1', 'a', 'ass-121', { state: 'finished', since: 5 }),
      tab('b1', 'b', 'ass-83'),
      tab('b2', 'b', 'Remaining work on ASS-69', { agent: 'claude' }),
      tab('c1', 'c', 'zsh', { state: 'working' }),
    ]
    const view = goToView(input({ spaces, tabs, query: 'ass', activeSpaceId: 'c', expandQuiet: true }))

    it('lists worktrees, then tabs, flat, with the match marked and a muted line', () => {
      expect(view.results!.worktrees.map((row) => [row.key, row.name, row.where, row.matched])).toEqual([['space:a', 'ass-121', 'plat', [0, 1, 2]]])
      expect(view.results!.tabs.map((row) => [row.key, row.where, row.matched])).toEqual([
        ['b1', 'plat / main', [0, 1, 2]],
        ['b2', 'plat / main', [18, 19, 20]],
      ])
      expect(view.rows.map((row) => row.key)).toEqual(['space:a', 'b1', 'b2'])
    })

    it('starts on the top hit, and a worktree row goes to the tab that decides its state', () => {
      expect(view.highlight).toBe('space:a')
      expect(view.rows[0]).toMatchObject({ tabId: 'a1', state: 'finished', stateLabel: 'finished', since: 5 })
    })

    it('does not list the sole tab of a listed worktree again', () => {
      expect(view.results!.tabs.map((row) => row.tabId)).not.toContain('a1')
    })

    it('sends a worktree row to the tab that needs you, and counts what it has open', () => {
      const several = goToView(
        input({
          spaces: [space('w', 'feature')],
          tabs: [tab('w1', 'w', 'one', { agent: 'claude' }), tab('w2', 'w', 'two', { agent: 'claude', state: 'needs-you' }), tab('w3', 'w', 'sh')],
          recent: ['w1'],
          query: 'feat',
          activeSpaceId: 'w',
        }),
      )
      expect(several.results!.worktrees[0]).toMatchObject({ tabId: 'w2', open: { agents: 2, terminals: 1, agent: 'claude' } })
    })

    it('counts the matching tabs by state for the chips, whatever the state filters say', () => {
      expect(view.counts).toEqual({ needsYou: 0, working: 0 })
      expect(goToView(input({ spaces: [space('a')], tabs: [tab('a1', 'a', 'build', { state: 'working' })], query: '~ bui', activeSpaceId: 'a' })).counts).toEqual({ needsYou: 0, working: 1 })
    })
  })

  it('finds the places a word matched', () => {
    expect(fuzzyMatch('ass', 'x-ass-1')?.at).toEqual([2, 3, 4])
    expect(fuzzyMatch('zz', 'abc')).toBeNull()
  })

  it('names a tab with no name of its own by what it runs and where, or by its agent', () => {
    expect(unnamedTabName({ agent: null, foreground: 'zsh', cwd: '/Users/me/git/app' }, '/Users/me')).toBe('zsh ~/git/app')
    expect(unnamedTabName({ agent: null, foreground: null, cwd: null }, '/Users/me')).toBe('shell')
    expect(unnamedTabName({ agent: 'claude', foreground: 'claude', cwd: '/x' }, '')).toBe('claude, untitled')
  })
})
