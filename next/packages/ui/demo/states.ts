// The development-only states page (`/?demo=states`): fabricated spaces, tabs and agents in every state, so the look can be
// checked without a core. main.ts loads this module only under import.meta.env.DEV, so a production build leaves it out.
import type { AgentInfo, SpaceInfo } from '../../protocol/messages.ts'
import type { AgentKind } from '../../core/status/adapter.ts'

export interface DemoTab {
  id: string
  spaceId: string
  kind: 'shell' | AgentKind
  label: string | null
  exited: boolean
}

export interface DemoRows {
  home: string
  spaces: SpaceInfo[]
  tabs: DemoTab[]
  agents: AgentInfo[]
}

// True only in development and only for `?demo=states`.
export function isDemoStates(location: { search: string }, dev: boolean): boolean {
  return dev && new URLSearchParams(location.search).get('demo') === 'states'
}

// Four spaces (one a worktree of the first, one a second space at the first's folder), tabs in all five states, one gone tab,
// and agents with a resumable gone one. Spaces are told apart by id, not by path.
export function demoRows(now: number = Date.now()): DemoRows {
  const home = '/Users/demo'
  const grove = `${home}/git/grove`
  const worktree = `${home}/git/grove-wt`
  const notes = `${home}/git/notes`
  const spaces: SpaceInfo[] = [
    { id: 'demo-space-grove', path: grove, name: 'grove', repoName: 'grove', parent: null, branch: 'main' },
    { id: 'demo-space-wt', path: worktree, name: 'grove-wt', repoName: 'grove', parent: 'demo-space-grove', branch: 'feature/look' },
    { id: 'demo-space-notes', path: notes, name: 'notes', repoName: null, parent: null, branch: null },
    { id: 'demo-space-grove-2', path: grove, name: 'grove review', repoName: 'grove', parent: null, branch: 'main' },
  ]
  const tabs: DemoTab[] = [
    { id: 'demo-1', spaceId: 'demo-space-grove', kind: 'shell', label: null, exited: false },
    { id: 'demo-2', spaceId: 'demo-space-grove', kind: 'claude', label: 'v2 plan', exited: false },
    { id: 'demo-3', spaceId: 'demo-space-grove', kind: 'opencode', label: null, exited: false },
    { id: 'demo-4', spaceId: 'demo-space-notes', kind: 'copilot', label: null, exited: false },
    { id: 'demo-5', spaceId: 'demo-space-notes', kind: 'claude', label: null, exited: false },
    { id: 'demo-6', spaceId: 'demo-space-wt', kind: 'claude', label: null, exited: true },
    { id: 'demo-7', spaceId: 'demo-space-wt', kind: 'shell', label: 'logs', exited: false },
    { id: 'demo-8', spaceId: 'demo-space-grove-2', kind: 'shell', label: null, exited: false },
  ]
  const agents: AgentInfo[] = [
    { tabId: 'demo-2', agent: 'claude', state: 'needs-you', reason: 'permission', since: now - 42_000, source: 'demo', resumable: false },
    { tabId: 'demo-3', agent: 'opencode', state: 'working', since: now - 185_000, source: 'demo', resumable: false },
    { tabId: 'demo-4', agent: 'copilot', state: 'finished', since: now - 3_600_000, source: 'demo', resumable: false },
    { tabId: 'demo-6', agent: 'claude', state: 'idle', since: now - 7_200_000, source: 'demo', resumable: true },
  ]
  return { home, spaces, tabs, agents }
}
