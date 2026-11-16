import { describe, expect, it } from 'vitest'
import type { AgentStateName } from '../protocol/messages.ts'
import {
  foldQuiet,
  headingOf,
  headingOpen,
  jumpTargets,
  mostUrgent,
  nextUrgent,
  openCounts,
  rowName,
  rowSummary,
  shortFolder,
  sidebarItems,
  sidebarSpaceOrder,
  spaceAt,
  tabStateOf,
  tileIndex,
  urgentTabs,
  type SidebarSpace,
  type SummaryTab,
} from './sidebar-model.ts'

describe('tabStateOf', () => {
  it('gives idle for a gone tab, whatever state it holds', () => {
    expect(tabStateOf({ exited: true, kind: 'claude', state: 'needs-you' })).toBe('idle')
    expect(tabStateOf({ exited: true, kind: 'shell', state: 'working' })).toBe('idle')
  })

  it('gives idle for a shell with no agent watched', () => {
    expect(tabStateOf({ exited: false, kind: 'shell', state: null })).toBe('idle')
  })

  it('gives the state of an agent typed into a shell tab, as of a launched one', () => {
    expect(tabStateOf({ exited: false, kind: 'shell', state: 'working' })).toBe('working')
    expect(tabStateOf({ exited: false, kind: 'shell', state: 'needs-you' })).toBe('needs-you')
  })

  it('gives unknown for an agent tab with no state yet', () => {
    expect(tabStateOf({ exited: false, kind: 'opencode', state: null })).toBe('unknown')
  })

  it('gives the agent state otherwise', () => {
    expect(tabStateOf({ exited: false, kind: 'copilot', state: 'finished' })).toBe('finished')
  })
})

describe('rowSummary', () => {
  const tab = (id: string, state: AgentStateName, extra: Partial<SummaryTab> = {}): SummaryTab => ({
    id,
    name: `Tab ${id}`,
    agent: true,
    exited: false,
    state,
    since: 1_000,
    ...extra,
  })

  it('is empty for a space with no tabs, and for one with only gone tabs', () => {
    expect(rowSummary([], []).empty).toBe(true)
    const gone = rowSummary([tab('a', 'needs-you', { exited: true })], [])
    expect(gone).toMatchObject({ empty: true, state: 'idle', tabId: null, tabName: null, agents: 0, terminals: 0, since: null })
  })

  it('decides by needs-you, finished, working, unknown, idle', () => {
    const states: AgentStateName[] = ['idle', 'unknown', 'working', 'finished', 'needs-you']
    for (let i = 0; i < states.length; i++) {
      const tabs = states.slice(0, i + 1).map((state, at) => tab(String(at), state))
      expect(rowSummary(tabs, []).state).toBe(states[i])
    }
  })

  it('names the deciding tab, and gives a tie to the most recently visited one', () => {
    const tabs = [tab('a', 'working'), tab('b', 'working'), tab('c', 'idle')]
    expect(rowSummary(tabs, ['c', 'b', 'a']).tabId).toBe('b')
    expect(rowSummary(tabs, ['a']).tabId).toBe('a')
    expect(rowSummary(tabs, []).tabId).toBe('a')
  })

  it('counts live agent and terminal tabs, and leaves gone tabs out', () => {
    const tabs = [tab('a', 'idle'), tab('b', 'idle'), tab('c', 'idle', { agent: false }), tab('d', 'idle', { exited: true }), tab('e', 'idle', { agent: false, exited: true })]
    expect(rowSummary(tabs, [])).toMatchObject({ agents: 2, terminals: 1 })
  })

  it('shows the start of the deciding tab\'s state, and no time when it has none', () => {
    expect(rowSummary([tab('a', 'working', { since: 5 }), tab('b', 'idle', { since: 9 })], []).since).toBe(5)
    expect(rowSummary([tab('a', 'idle', { agent: false, since: null })], []).since).toBeNull()
  })
})

describe('openCounts', () => {
  it('counts by type, in singular and plural, and leaves out a zero', () => {
    expect(openCounts({ agents: 4, terminals: 1 })).toBe('4 agents, 1 terminal')
    expect(openCounts({ agents: 1, terminals: 0 })).toBe('1 agent')
    expect(openCounts({ agents: 0, terminals: 2 })).toBe('2 terminals')
  })
  it('says no tabs are open for none', () => {
    expect(openCounts({ agents: 0, terminals: 0 })).toBe('No tabs open')
  })
})

describe('tileIndex', () => {
  it('gives a number from 1 to 8', () => {
    for (const name of ['grove', 'notes', 'a', '', 'a long folder name with spaces']) {
      const index = tileIndex(name)
      expect(index).toBeGreaterThanOrEqual(1)
      expect(index).toBeLessThanOrEqual(8)
    }
  })

  it('is stable for the same name', () => {
    expect(tileIndex('grove')).toBe(tileIndex('grove'))
  })
})

describe('shortFolder', () => {
  it('shows the home folder as ~ and the folders under it from ~', () => {
    expect(shortFolder('/Users/victor', '/Users/victor')).toBe('~')
    expect(shortFolder('/Users/victor/git/grove', '/Users/victor')).toBe('~/git/grove')
  })

  it('shows other paths in full, and not a folder that only starts the same way', () => {
    expect(shortFolder('/Users/victor2/git', '/Users/victor')).toBe('/Users/victor2/git')
    expect(shortFolder('/srv/app', '/Users/victor')).toBe('/srv/app')
  })

  it('leaves the path alone when there is no home folder', () => {
    expect(shortFolder('/srv/app', '')).toBe('/srv/app')
  })
})

const space = (id: string, extra: Partial<SidebarSpace> = {}): SidebarSpace => ({
  id,
  name: id,
  label: null,
  parent: null,
  worktree: false,
  repoName: null,
  branch: null,
  ...extra,
})

// What the sidebar draws, as heading names with their row ids and plain ids.
const shape = (spaces: SidebarSpace[]) =>
  sidebarItems(spaces).map((item) => (item.kind === 'heading' ? { [item.repo]: item.rows.map((row) => row.space.id) } : item.row.space.id))

describe('sidebarItems', () => {
  it('draws a repo with worktrees as a heading with its main checkout first, and other spaces plain', () => {
    const spaces = [
      space('a', { repoName: 'app' }),
      space('plain'),
      space('a-wt', { parent: 'a', worktree: true, repoName: 'app' }),
      space('a-wt2', { parent: 'a', worktree: true, repoName: 'app' }),
    ]
    expect(shape(spaces)).toEqual([{ app: ['a', 'a-wt', 'a-wt2'] }, 'plain'])
  })

  it('gives a worktree whose main checkout is not a space a heading named after the repo', () => {
    const spaces = [space('x-wt', { worktree: true, repoName: 'app' }), space('x-wt2', { worktree: true, repoName: 'app' })]
    expect(shape(spaces)).toEqual([{ app: ['x-wt', 'x-wt2'] }])
  })

  it('keeps the heading when the main checkout is added later, with the checkout as the first row', () => {
    const wt = space('wt', { parent: null, worktree: true, repoName: 'app' })
    expect(shape([wt])).toEqual([{ app: ['wt'] }])
    expect(shape([space('main', { repoName: 'app' }), { ...wt, parent: 'main' }])).toEqual([{ app: ['main', 'wt'] }])
  })

  it('keeps the worktrees under the repo when the main checkout space is removed', () => {
    const spaces = [space('wt', { parent: 'gone', worktree: true, repoName: 'app' })]
    expect(shape(spaces)).toEqual([{ app: ['wt'] }])
  })

  it('leaves a second space on one folder as its own row', () => {
    const spaces = [space('a', { repoName: 'app' }), space('a-wt', { parent: 'a', worktree: true, repoName: 'app' }), space('a-2', { repoName: 'app' })]
    expect(shape(spaces)).toEqual([{ app: ['a', 'a-wt'] }, 'a-2'])
  })

  it('shows a space git cannot place as a plain row', () => {
    expect(shape([space('odd', { worktree: true })])).toEqual(['odd'])
  })

  it('is empty for no spaces', () => {
    expect(sidebarItems([])).toEqual([])
  })
})

describe('rowName', () => {
  const main = (extra: Partial<SidebarSpace>) => ({ space: space('m', { name: 'folder', ...extra }), main: true })

  it('names a main checkout by its rename, else its branch, else its folder', () => {
    expect(rowName(main({ label: 'mine', branch: 'dev' }))).toBe('mine')
    expect(rowName(main({ branch: 'dev' }))).toBe('dev')
    expect(rowName(main({}))).toBe('folder')
  })

  it('names any other space by its space name', () => {
    expect(rowName({ space: space('w', { name: 'wt-name', branch: 'feature' }), main: false })).toBe('wt-name')
  })
})

describe('sidebarSpaceOrder', () => {
  it('lists the rows of each heading and each plain space as the sidebar draws them, folded rows included', () => {
    const spaces = [
      space('a', { repoName: 'app' }),
      space('c'),
      space('a-wt', { parent: 'a', worktree: true, repoName: 'app' }),
      space('d'),
    ]
    expect(sidebarSpaceOrder(spaces)).toEqual(['a', 'a-wt', 'c', 'd'])
  })
  it('lists a worktree whose repo is missing under its repo, with the others of that repo', () => {
    const spaces = [space('x', { parent: 'gone', worktree: true, repoName: 'app' }), space('y'), space('z', { worktree: true, repoName: 'app' })]
    expect(sidebarSpaceOrder(spaces)).toEqual(['x', 'z', 'y'])
  })
  it('is empty for no spaces', () => {
    expect(sidebarSpaceOrder([])).toEqual([])
  })
})

describe('spaceAt', () => {
  it('counts places from 1 and is null past the last space', () => {
    const order = ['a', 'a-wt', 'c']
    expect(spaceAt(order, 1)).toBe('a')
    expect(spaceAt(order, 3)).toBe('c')
    expect(spaceAt(order, 4)).toBeNull()
    expect(spaceAt(order, 0)).toBeNull()
    expect(spaceAt([], 1)).toBeNull()
  })
})

describe('urgentTabs and nextUrgent', () => {
  const tab = (id: string, state: AgentStateName, since: number) => ({ id, state, since })

  it('keeps only needs-you and finished tabs: needs-you first, then the longest waiting', () => {
    const tabs = [tab('a', 'finished', 1), tab('b', 'working', 0), tab('c', 'needs-you', 9), tab('d', 'needs-you', 5), tab('e', 'idle', 0), tab('f', 'unknown', 0)]
    expect(urgentTabs(tabs).map((item) => item.id)).toEqual(['d', 'c', 'a'])
  })

  it('has no urgent tab when none waits', () => {
    expect(urgentTabs([tab('a', 'working', 1), tab('b', 'idle', 2)])).toEqual([])
  })

  it('goes to the first when the active tab is not urgent, or there is none active', () => {
    const urgent = urgentTabs([tab('a', 'needs-you', 1), tab('b', 'finished', 2)])
    expect(nextUrgent(urgent, 'x')?.id).toBe('a')
    expect(nextUrgent(urgent, null)?.id).toBe('a')
  })

  it('goes to the one after the active tab, and wraps round', () => {
    const urgent = urgentTabs([tab('a', 'needs-you', 1), tab('b', 'needs-you', 2), tab('c', 'finished', 3)])
    expect(nextUrgent(urgent, 'a')?.id).toBe('b')
    expect(nextUrgent(urgent, 'b')?.id).toBe('c')
    expect(nextUrgent(urgent, 'c')?.id).toBe('a')
  })

  it('goes nowhere when nothing is urgent, or the active tab is the only one', () => {
    expect(nextUrgent([], 'a')).toBeNull()
    expect(nextUrgent(urgentTabs([tab('a', 'needs-you', 1)]), 'a')).toBeNull()
  })
})

describe('jumpTargets', () => {
  const tab = (id: string, state: AgentStateName, since: number) => ({ id, state, since })

  it('is the urgent tabs while any exist, and leaves working ones out', () => {
    expect(jumpTargets([tab('a', 'working', 1), tab('b', 'finished', 2), tab('c', 'needs-you', 3)]).map((item) => item.id)).toEqual(['c', 'b'])
  })

  it('falls back to the working tabs, the longest running first, when none is urgent', () => {
    const tabs = [tab('a', 'working', 9), tab('b', 'idle', 0), tab('c', 'working', 4), tab('d', 'unknown', 0)]
    expect(jumpTargets(tabs).map((item) => item.id)).toEqual(['c', 'a'])
  })

  it('is empty when nothing is urgent or working', () => {
    expect(jumpTargets([tab('a', 'idle', 1), tab('b', 'unknown', 2)])).toEqual([])
  })
})

describe('headingOpen', () => {
  it('opens every heading by default, and folds the ones the human folded', () => {
    expect(headingOpen('app', [], null)).toBe(true)
    expect(headingOpen('app', ['app'], null)).toBe(false)
    expect(headingOpen('lib', ['app'], null)).toBe(true)
  })
  it('keeps the active space\'s heading open without touching the saved folds', () => {
    const folded = ['app']
    expect(headingOpen('app', folded, 'app')).toBe(true)
    expect(headingOpen('app', folded, 'lib')).toBe(false)
    expect(folded).toEqual(['app'])
  })
})

describe('headingOf', () => {
  const items = sidebarItems([space('a', { repoName: 'app' }), space('a-wt', { parent: 'a', worktree: true, repoName: 'app' }), space('p')])
  it('names the repo whose heading holds the space, and none for a plain row or no space', () => {
    expect(headingOf(items, 'a-wt')).toBe('app')
    expect(headingOf(items, 'p')).toBeNull()
    expect(headingOf(items, null)).toBeNull()
  })
})

describe('mostUrgent', () => {
  it('picks needs-you, finished, working, unknown, idle in that order', () => {
    expect(mostUrgent(['idle', 'unknown', 'working', 'finished', 'needs-you'])).toBe('needs-you')
    expect(mostUrgent(['idle', 'working', 'finished'])).toBe('finished')
    expect(mostUrgent(['idle', 'unknown', 'working'])).toBe('working')
    expect(mostUrgent(['idle', 'unknown'])).toBe('unknown')
    expect(mostUrgent(['idle'])).toBe('idle')
  })
  it('is null for no states', () => {
    expect(mostUrgent([])).toBeNull()
  })
})

describe('Cmd+digit over folded headings', () => {
  it('numbers every row, so a shortcut means the same space whether or not its heading is folded', () => {
    const order = sidebarSpaceOrder([space('a', { repoName: 'app' }), space('a-wt', { parent: 'a', worktree: true, repoName: 'app' }), space('p')])
    expect(spaceAt(order, 2)).toBe('a-wt')
    expect(spaceAt(order, 3)).toBe('p')
  })
})

describe('foldQuiet', () => {
  const sp = (id: string, extra: Partial<SidebarSpace> = {}): SidebarSpace => ({ id, name: id, label: null, parent: null, worktree: false, repoName: null, branch: null, ...extra })
  const items = sidebarItems([
    sp('proj', { repoName: 'proj', branch: 'master' }),
    sp('proj-wt', { worktree: true, parent: 'proj', repoName: 'proj' }),
    sp('old', { repoName: 'old', branch: 'master' }),
    sp('old-wt', { worktree: true, parent: 'old', repoName: 'old' }),
    sp('lone'),
    sp('lone2', { branch: 'master' }),
  ])
  const ids = (list: ReturnType<typeof foldQuiet>['items']) => list.map((item) => (item.kind === 'heading' ? item.repo : item.row.space.id))

  it('drops a plain quiet space, and a heading only when all its rows are quiet', () => {
    const folded = foldQuiet(items, { ids: new Set(['proj-wt', 'old', 'old-wt', 'lone']), last: null })
    expect(ids(folded.items)).toEqual(['proj', 'lone2'])
  })

  it('counts spaces, not headings, and counts none of a heading that stays', () => {
    expect(foldQuiet(items, { ids: new Set(['proj-wt', 'old', 'old-wt', 'lone']), last: null }).count).toBe(3)
    expect(foldQuiet(items, { ids: new Set(), last: null }).count).toBe(0)
  })

  it('names the last space as its row does, adding the repo or branch only where the name is ambiguous', () => {
    expect(foldQuiet(items, { ids: new Set(['old', 'old-wt']), last: 'old' }).last).toBe('master · old')
    expect(foldQuiet(items, { ids: new Set(['old', 'old-wt']), last: 'old-wt' }).last).toBe('old-wt')
    expect(foldQuiet(items, { ids: new Set(['lone']), last: 'lone' }).last).toBe('lone')
    expect(foldQuiet(items, { ids: new Set(['lone2']), last: 'lone2' }).last).toBe('lone2')
  })

  it('names no last space when it stays listed', () => {
    expect(foldQuiet(items, { ids: new Set(['proj-wt', 'lone']), last: 'proj-wt' }).last).toBeNull()
  })
})
