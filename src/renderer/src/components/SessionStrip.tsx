import { useEffect, useRef, useState, type WheelEvent } from 'react'
import type { Session } from '@shared/types'
import { longestWaiting, mostUrgent, shownStatus, statusTone, statusView } from '../sessionStatus'
import { listGroups, orderedSessions, type ListGroup } from '../sessionList'
import { useSlices } from '../stores/slices'
import { colorTags } from '../tags'
import { monogram } from '../monogram'
import { workflowStatusOf } from '../workflowStatus'
import { ConfirmDialog } from './ConfirmDialog'
import { cx } from './ui/cx'
import { tagClass } from './ui/Tag'
import css from './SessionStrip.module.css'

// The group's colour: the project's tag, or the workflow status's tone. A group with neither
// (grouping by none) has no colour bar at all.
function groupClass(group: ListGroup, tag: number | null): string | undefined {
  if (group.project) return tagClass(tag, 'fg')
  return group.status ? css[`tone-${workflowStatusOf(group.status).tone}`] : undefined
}

// The sidebar hidden (⌘B): a dot per session in the content header, grouped the way the sidebar
// says. It scrolls sideways; the waiting count stays pinned outside the scroll. A repo's
// worktrees fold into its run (ADR 0037), and `orderedSessions` keeps the sidebar's order, so
// ⌘N is the dot the human counts to.
export function SessionStrip() {
  const { projects, sessions, ui, features, waitingSince, setFocused } = useSlices()
  // a failed start has no terminal to open: clicking its dot offers to dismiss it
  const [dismissing, setDismissing] = useState<Session | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const tags = colorTags(projects, features.items)
  const waiting = sessions.filter((x) => shownStatus(x) === 'waiting').length
  const blocks = listGroups(projects, sessions, ui).map((g) => ({ g, list: orderedSessions([g]) })).filter((b) => b.list.length > 0)

  // the focused dot scrolls into view, so a session picked by ⌘N or the palette is never off the edge
  useEffect(() => {
    scroller.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [ui.focusedSessionId])

  // a mouse wheel scrolls it sideways too; a trackpad's sideways swipe already does
  const wheel = (e: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY
  }

  const dot = (x: Session, g: ListGroup, list: Session[]) => {
    const focused = x.id === ui.focusedSessionId
    // a folded parent's hidden children show through on its dot: a waiting child is never hidden
    const hidden = (g.nest.kids.get(x.id) ?? []).filter((k) => !list.includes(k))
    const urgent = hidden.length > 0 ? mostUrgent([x, ...hidden]) ?? x : x
    return (
      <button key={x.id} type="button" className={cx(css.tile, x.parentId && css.child, focused && css.focused, shownStatus(x) === 'gone' && css.ended)}
        aria-pressed={focused} aria-label={x.label} title={`${x.label} · ${statusView(x).label}`}
        onClick={() => (shownStatus(x) === 'failed' ? setDismissing(x) : setFocused(x.id))}>
        <span className={cx(css.dot, css[`t-${statusTone(urgent)}`])} />
      </button>
    )
  }

  return (
    <nav className={css.strip} aria-label="Sessions">
      <div className={css.scroller} ref={scroller} onWheel={wheel}>
        {blocks.map(({ g, list }) => {
          const tone = groupClass(g, g.project ? tags.project(g.project.id) : null)
          return (
            <div key={g.key} className={css.group} title={g.label}>
              {g.project && <span className={cx(css.mono, tone)}>{monogram(g.project.name)}</span>}
              {/* the colour bar runs under the group's dots, as it ran down the rail's tiles */}
              <div className={css.run}>
                {tone && <span className={cx(css.bar, tone)} />}
                {list.map((x) => dot(x, g, list))}
              </div>
            </div>
          )
        })}
      </div>
      {waiting > 0 && (
        <button type="button" className={css.waiting} aria-label={`${waiting} waiting`} title={`${waiting} waiting: focus the longest`}
          onClick={() => { const w = longestWaiting(sessions, waitingSince); if (w) setFocused(w.id) }}>
          {waiting}
        </button>
      )}
      {dismissing && (
        <ConfirmDialog title="Dismiss failed session?" body={statusView(dismissing).label} confirmLabel="Dismiss"
          onCancel={() => setDismissing(null)}
          onConfirm={() => { void window.api.invoke('session:dismissStartup', { id: dismissing.id }); setDismissing(null) }} />
      )}
    </nav>
  )
}
