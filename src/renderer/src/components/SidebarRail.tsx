import { GRID_MAX, type Session } from '@shared/types'
import { gridShown } from '../gridView'
import { longestWaiting, shownStatus } from '../sessionStatus'
import { listGroups, type ListGroup } from '../sessionList'
import { useSlices } from '../stores/slices'
import { colorTags } from '../tags'
import { workflowStatusOf } from '../workflowStatus'
import { cx } from './ui/cx'
import { Icon } from './ui/Icon'
import { tagClass } from './ui/Tag'
import css from './SidebarRail.module.css'

// The collapsed sidebar (⌘B): a tile per session, grouped the way the panel says. Same state as the full sidebar.
function Tile({ s, focused, inGrid, onFocus }: { s: Session; focused: boolean; inGrid: boolean; onFocus: () => void }) {
  const shown = shownStatus(s)
  const done = shown === 'waiting' && s.waitingFor === 'done'
  const tone = done ? 'done' : shown
  return (
    <button type="button" className={cx(css.tile, focused && css.focused, shown === 'gone' && css.ended)}
      aria-pressed={focused} aria-label={s.label} title={`${s.label} · ${shown}`} onClick={onFocus}>
      <Icon name={s.kind} size={16} />
      <span className={cx(css.dot, css[tone])} />
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

export function SidebarRail() {
  const { projects, sessions, ui, features, waitingSince, setFocused, toggleGrid } = useSlices()
  const tags = colorTags(projects, features.items)
  const waiting = sessions.filter((x) => shownStatus(x) === 'waiting').length
  const members = ui.grid.members.length

  return (
    <div className={css.rail}>
      <div className={css.list}>
        {listGroups(projects, sessions, ui).filter((g) => g.sessions.length > 0).map((g) => {
          const bar = barClass(g, g.project ? tags.project(g.project.id) : null)
          return (
            <div key={g.key} className={css.group} title={g.label}>
              {bar && <span className={cx(css.bar, bar)} />}
              <div className={css.tiles}>
                {g.sessions.map((x) => (
                  <Tile key={x.id} s={x} focused={x.id === ui.focusedSessionId} inGrid={ui.grid.members.includes(x.id)} onFocus={() => setFocused(x.id)} />
                ))}
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
