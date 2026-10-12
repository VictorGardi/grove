import { GRID_MAX, type Session } from '@shared/types'
import { gridShown } from '../gridView'
import { longestWaiting, shownStatus, statusTone } from '../sessionStatus'
import { listGroups, orderedSessions, type ListGroup } from '../sessionList'
import { useSlices } from '../stores/slices'
import { colorTags } from '../tags'
import { monogram } from '../monogram'
import { workflowStatusOf } from '../workflowStatus'
import { cx } from './ui/cx'
import { Icon } from './ui/Icon'
import { tagClass } from './ui/Tag'
import css from './SidebarRail.module.css'

// The collapsed sidebar (⌘B): a tile per session, grouped the way the panel says. Same state as the full sidebar.
function Tile({ s, focused, inGrid, onFocus }: { s: Session; focused: boolean; inGrid: boolean; onFocus: () => void }) {
  const shown = shownStatus(s)
  return (
    <button type="button" className={cx(css.tile, focused && css.focused, shown === 'gone' && css.ended)}
      aria-pressed={focused} aria-label={s.label} title={`${s.label} · ${shown}`} onClick={onFocus}>
      <Icon name={s.kind} size={16} />
      <span className={cx(css.dot, css[`t-${statusTone(s)}`])} />
      {inGrid && <span className={css.grid} />}
    </button>
  )
}

// The group's colour: the project's tag, or the workflow status's tone. A group with
// neither (grouping by none) has no bar at all.
function barClass(group: ListGroup, tag: number | null): string | undefined {
  if (group.project) return tagClass(tag, 'fg')
  return group.status ? css[`tone-${workflowStatusOf(group.status).tone}`] : undefined
}

export function SidebarRail({ onNew }: { onNew: () => void }) {
  const { projects, sessions, ui, features, waitingSince, setFocused, toggleGrid } = useSlices()
  const tags = colorTags(projects, features.items)
  const waiting = sessions.filter((x) => shownStatus(x) === 'waiting').length
  const members = ui.grid.members.length
  // One run of tiles per group, a repo's worktrees folded into it. The rail has no room for
  // a heading per level, and the colour bar is the only grouping cue it has: drawing a
  // worktree as a second block would put a gap between two bars of the same colour, which
  // reads as two projects rather than one repo (ADR 0037). `orderedSessions` keeps the rail
  // in the sidebar's order, so ⌘N is the tile the human counts to.
  const blocks = listGroups(projects, sessions, ui)
    .map((g) => ({ ...g, sessions: orderedSessions([g]) }))
    .filter((g) => g.sessions.length > 0)

  return (
    <div className={css.rail}>
      <div className={css.top}>
        <button type="button" className={css.newBtn} aria-label="New session" title="New session (⌘T)" onClick={onNew}>
          <Icon name="plus" size={16} />
        </button>
      </div>
      <div className={css.list}>
        {blocks.map((g) => {
          const bar = barClass(g, g.project ? tags.project(g.project.id) : null)
          return (
            <div key={g.key} className={css.group} title={g.label}>
              {g.project && <span className={cx(css.mono, bar)}>{monogram(g.project.name)}</span>}
              <div className={css.run}>
                {bar && <span className={cx(css.bar, bar)} />}
                <div className={css.tiles}>
                  {g.sessions.map((x) => (
                    <Tile key={x.id} s={x} focused={x.id === ui.focusedSessionId} inGrid={ui.grid.members.includes(x.id)} onFocus={() => setFocused(x.id)} />
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <div className={css.bottom}>
        {waiting > 0 && (
          <button type="button" className={css.waitingPill} aria-label={`${waiting} waiting`} title={`${waiting} waiting: focus the longest`}
            onClick={() => { const w = longestWaiting(sessions, waitingSince); if (w) setFocused(w.id) }}>
            {waiting}
          </button>
        )}
        <button type="button" className={cx(css.gridBtn, gridShown(ui) && css.on)} aria-pressed={gridShown(ui)} disabled={members === 0}
          title={members === 0 ? `Add sessions to the grid (up to ${GRID_MAX})` : 'Session grid (⌘G)'} onClick={toggleGrid}>
          <Icon name="grid" size={16} />
          {members > 0 && <span className={css.count}>{members}</span>}
        </button>
      </div>
    </div>
  )
}
