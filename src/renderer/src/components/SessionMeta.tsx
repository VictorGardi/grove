import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import type { Project, Session } from '@shared/types'
import type { Family } from '../family'
import { statusTone, statusView } from '../sessionStatus'
import { BranchMark, showsPr } from './BranchMark'
import { ChildrenPopover } from './ChildrenPopover'
import { Icon } from './ui/Icon'
import { StatusDot } from './ui/StatusDot'
import { cx } from './ui/cx'
import s from './SessionMeta.module.css'

function BranchCopyButton({ branch, worktree }: { branch: string; worktree?: Project }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const reset = useRef<number | null>(null)

  useEffect(() => () => {
    if (reset.current !== null) window.clearTimeout(reset.current)
  }, [])

  async function copy(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation()
    if (reset.current !== null) window.clearTimeout(reset.current)
    try {
      await navigator.clipboard.writeText(branch)
      setCopyState('copied')
    } catch (error) {
      console.error(`Failed to copy branch "${branch}" to the clipboard`, error)
      setCopyState('failed')
    }
    reset.current = window.setTimeout(() => {
      setCopyState('idle')
      reset.current = null
    }, 1400)
  }

  const detail = worktree ? `\nWorktree: ${worktree.path}` : ''
  const title = copyState === 'copied' ? `Copied branch: ${branch}`
    : copyState === 'failed' ? `Could not copy branch: ${branch}`
      : `Copy branch: ${branch}${detail}`
  const announcement = copyState === 'copied' ? 'Branch copied to clipboard'
    : copyState === 'failed' ? 'Could not copy branch to clipboard'
      : ''

  return (
    <button type="button" className={cx(s.truncate, s.branchCopy, worktree && s.worktree)}
      aria-label={`Copy branch ${branch}`} title={title} onClick={(e) => void copy(e)}>
      <span className={s.truncate}>{branch}</span>
      {copyState === 'copied' && <Icon name="check" size={12} className={s.copySuccess} />}
      {copyState === 'failed' && <Icon name="info" size={12} className={s.copyFailed} />}
      <span className={s.srOnly} aria-live="polite">{announcement}</span>
    </button>
  )
}

// The row that names a session, shared by the content header and a grid pane header so the two
// cannot drift: same facts, same order, same type. `lead` is whatever identifies it — the
// session's name when it is focused, "project / label" in a pane — and everything after it is the
// same in both. `trail` stacks it for the content header: the session's name and its facts on top,
// its repo and its branch on a second, smaller line. `family` adds chips: "↑ parent" on a child (running or ended), and on a
// parent its active child plus "N children", which lists them all; a click focuses one. `worktree`
// turns the branch purple, as the sidebar does, instead of naming the worktree.
export function SessionMeta({ lead, trail, session, worktree, context, actions, family }: {
  lead: ReactNode
  trail?: ReactNode
  session: Session
  worktree?: Project // set when the session runs in a git worktree
  context?: ReactNode // ContextPopover in a header, ContextGauge in a pane: a density, not a difference
  actions?: ReactNode
  family?: Family & { onJump: (id: string) => void }
}) {
  const status = statusView(session)
  const parent = family?.parent ?? null
  const child = family?.active ?? null
  const branch = session.branch && (
    <span className={s.branch}>
      <BranchMark pr={session.pr} />
      {session.pr && showsPr(session.pr) && <a className={s.pr} href={session.pr.url} target="_blank" rel="noreferrer" title={`Pull request #${session.pr.number} (${session.pr.state})`}>#{session.pr.number}</a>}
      <BranchCopyButton branch={session.branch} worktree={worktree} />
    </span>
  )
  const facts = (
    <>
      <span className={s.status}><StatusDot tone={status.tone} /><span className={s.secondary}>{status.label}</span></span>
      {/* buttons, so the grid's drag handler leaves them alone */}
      {family && parent && (
        <button type="button" className={s.chip} aria-label={`Jump to parent ${parent.label}`}
          title={`${parent.label} · ${statusView(parent).label}`} onClick={() => family.onJump(parent.id)}>
          <span>↑</span>
          <span className={s.truncate}>{parent.label}</span>
        </button>
      )}
      {family && child && (
        <button type="button" className={s.chip} aria-label={`Jump to child ${child.label}`}
          title={`${child.label} · ${statusView(child).label}`} onClick={() => family.onJump(child.id)}>
          <StatusDot tone={statusTone(child)} />
          <span className={s.truncate}>{child.label}</span>
        </button>
      )}
      {family && family.children.length > 0 && <ChildrenPopover kids={family.children} onJump={family.onJump} />}
    </>
  )
  return (
    <div className={s.row}>
      {trail ? (
        <div className={s.lines}>
          <div className={s.line}><div className={cx(s.lead, s.name)}>{lead}</div>{facts}</div>
          <div className={cx(s.line, s.sub)}>{trail}{branch}</div>
        </div>
      ) : (
        <>
          <div className={s.lead}>{lead}</div>
          {branch}
          {facts}
        </>
      )}
      <span className={s.spacer} />
      {context}
      {actions}
    </div>
  )
}