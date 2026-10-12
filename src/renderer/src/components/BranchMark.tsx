import type { PullRequest } from '@shared/types'
import { Icon } from './ui/Icon'
import s from './BranchMark.module.css'

// Only an open or a merged PR changes the mark: a closed one says nothing the branch does not.
export const showsPr = (pr: PullRequest | null | undefined): pr is PullRequest => !!pr && pr.state !== 'closed'

// The branch icon, or in its place the PR's: green while it is open, purple once merged.
export function BranchMark({ pr }: { pr?: PullRequest | null }) {
  if (!showsPr(pr)) return <Icon name="branch" size={12} />
  return (
    <span className={pr.state === 'merged' ? s.merged : s.open} title={`Pull request #${pr.number} (${pr.state})`}>
      <Icon name={pr.state === 'merged' ? 'pr-merged' : 'pr-open'} size={12} />
    </span>
  )
}
