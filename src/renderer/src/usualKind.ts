import type { Project, Session, SessionKind } from '@shared/types'
import { repoProjectIds } from './repoGroups'

// What the dialog offers before the human says otherwise: the kind this repo is actually run with.
// A guess is worth having because choosing the wrong agent is the one mistake here that costs a
// whole session — everything else on the form is either obvious or free to change.

// Terminal is left out on purpose. The question is "which agent does this repo run", and a shell
// someone opened to look at a file says nothing about it; letting terminals outvote the agents
// would answer it with whichever kind happens to be rarer.
const AGENTS: SessionKind[] = ['claude', 'opencode', 'copilot']

// Where a session lands with no history to read: Claude Code, as before.
export const KIND_DEFAULT: SessionKind = 'claude'

// Newest first. `startedAt` is always present, so this never has to guess what it meant to say.
const byNewest = (a: Session, b: Session) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0)

// The kind to preselect for a repo: that of the most recent agent session in it, or failing that
// anywhere, or failing that the default.
//
// Recency, not a count. A repo's history is mostly the past: someone who moved from OpenCode to
// Claude Code a month ago still has every OpenCode session they ever ran sitting behind it, and a
// majority would keep offering them the agent they stopped using. The most recent session is the
// one the human is working in *now*, so it is the one worth guessing.
//
// The scope is the whole repo, not one checkout: a worktree is the same repo with another folder
// checked out (ADR 0037), and work is done across both, so habits learned in a worktree count here.
export function usualKind(sessions: Session[], projects: Project[], projectId: string | undefined): SessionKind {
  const agents = sessions.filter((s) => AGENTS.includes(s.kind))
  const repo = projectId ? repoProjectIds(projects, projectId) : null
  const here = repo ? agents.filter((s) => repo.has(s.projectId)) : []
  return [...(here.length ? here : agents)].sort(byNewest)[0]?.kind ?? KIND_DEFAULT
}