import { describe, expect, it } from 'vitest'
import { goToView, type GoToInput, type GoToSpace, type GoToTab } from './goto-model.ts'

function space(id: string, name = id, extra: Partial<GoToSpace> = {}): GoToSpace {
  return { id, name, parent: null, worktree: false, repoName: null, ...extra }
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
    // b is current, a has a tab with something for the human, c and d are idle and not current.
    const base = {
      spaces: [space('a'), space('b'), space('c'), space('d')],
      tabs: [tab('a1', 'a', '1', { state: 'finished' }), tab('b1', 'b', '1'), tab('c1', 'c', '1'), tab('d1', 'd', '1', { state: 'unknown' })],
      recent: ['b1', 'a1', 'c1', 'd1'],
      activeSpaceId: 'b',
      activeTabId: 'b1',
    }

    it('collapses the idle spaces that are not current behind a count', () => {
      const view = goToView(input(base))
      expect(view.groups.map((group) => group.spaceId)).toEqual(['b', 'a'])
      expect(view.quiet).toEqual({ count: 2, expanded: false })
    })

    it('lists them after the others when expanded', () => {
      const view = goToView(input({ ...base, expandQuiet: true }))
      expect(view.groups.map((group) => group.spaceId)).toEqual(['b', 'a', 'c', 'd'])
      expect(view.quiet).toEqual({ count: 2, expanded: true })
    })

    it('has no quiet part when every space is current or busy', () => {
      const view = goToView(input({ ...base, spaces: [space('a'), space('b')], tabs: base.tabs.slice(0, 2) }))
      expect(view.quiet).toBeNull()
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
        input({ spaces: [space('a'), space('b')], tabs: [tab('a1', 'a', '1'), tab('b1', 'b', '1')], recent: ['a1', 'b1'], activeSpaceId: 'a', activeTabId: 'b1' }),
      )
      expect(view.highlight).toBe('a1')
    })
  })
})
