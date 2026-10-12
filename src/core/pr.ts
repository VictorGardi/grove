import { execFile } from 'node:child_process'
import type { PullRequest } from '@shared/types'

// The PR for a branch of the repo at `dir`; null: none, or it cannot be asked (no gh, not signed in,
// no GitHub remote, offline). Never throws: a missing answer is just no marker.
export type PrLookup = (dir: string, branch: string) => Promise<PullRequest | null>

const ORDER: PullRequest['state'][] = ['open', 'merged', 'closed']

// Pure so the ranking is testable: an open PR wins, then a merged one, then a closed one; within a
// state gh lists the newest first, and a sort is stable.
export function pickPr(json: string): PullRequest | null {
  let rows: { number?: number; state?: string; isDraft?: boolean; url?: string }[]
  try {
    rows = JSON.parse(json)
  } catch {
    return null
  }
  const prs: PullRequest[] = []
  for (const r of Array.isArray(rows) ? rows : []) {
    const state = String(r.state).toLowerCase() as PullRequest['state']
    if (typeof r.number === 'number' && ORDER.includes(state)) prs.push({ number: r.number, state, draft: !!r.isDraft, url: r.url ?? '' })
  }
  prs.sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state))
  return prs[0] ?? null
}

// Runs the GitHub CLI. `--head` matches the branch name, whichever fork it came from.
export function ghLookup(ghPath: string, env: NodeJS.ProcessEnv): PrLookup {
  return (dir, branch) => new Promise((resolve) => {
    execFile(ghPath, ['pr', 'list', '--head', branch, '--state', 'all', '--limit', '5', '--json', 'number,state,isDraft,url'],
      { cwd: dir, env: { ...env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' }, timeout: 15_000, encoding: 'utf8' },
      (err, stdout) => resolve(err ? null : pickPr(stdout)))
  })
}
