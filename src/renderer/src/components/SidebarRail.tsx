import { GRID_MAX, type Session } from '@shared/types'
import { gridShown } from '../gridView'
import { longestWaiting, shownStatus } from '../sessionStatus'
import { useSlices } from '../stores/slices'
import { colorTags } from '../tags'
import { sessionGroups } from '../tree'
import { cx } from './ui/cx'
import { Icon } from './ui/Icon'
import { tagClass } from './ui/Tag'
import { WorkflowStatusButton } from './ui/WorkflowStatusPicker'
import css from './SidebarRail.module.css'

// The collapsed sidebar (⌘B): a tile per session, grouped by project colour. Same state as the full sidebar.
function Tile({ s, focused, inGrid, onFocus }: { s: Session; focused: boolean; inGrid: boolean; onFocus: () => void }) {
  const shown = shownStatus(s)
  const done = shown === 'waiting' && s.waitingFor === 'done'
  const tone = done ? 'done' : shown
  return (
    <button type="button" className={cx(css.tile, focused && css.focused, shown === 'gone' && css.ended)}
      aria-pressed={focused} aria-label={s.label} title={`${s.label} · ${shown}`} onClick={onFocus}>
      <span className={css.statusCorner} onClick={(e) => e.stopPropagation()}>
        <WorkflowStatusButton session={s} size={13} />
      </span>
      <Icon name={s.kind} size={16} />
      <span className={cx(css.dot, css[tone])} />
      {inGrid && <span className={css.grid} />}
    </button>
  )
}

export function SidebarRail() {
  const { projects, sessions, ui, features, waitingSince, setFocused, toggleGrid, toggleSidebar } = useSlices()
  const tags = colorTags(projects, features.items)
  const waiting = sessions.filter((x) => shownStatus(x) === 'waiting').length
  const members = ui.grid.members.length

  return (
    <div className={css.rail}>
      <button type="button" className={css.expand} aria-label="Expand sidebar" title="Expand sidebar (⌘B)" onClick={toggleSidebar}>
        <Icon name="sidebar" size={16} />
      </button>
      <div className={css.list}>
        {sessionGroups(projects, sessions, ui).filter((g) => g.sessions.length > 0).map((g) => (
          <div key={g.key} className={css.group} title={g.project.name}>
            <span className={cx(css.bar, tagClass(tags.project(g.project.id), 'fg'))} />
            {g.sessions.map((x) => (
              <Tile key={x.id} s={x} focused={x.id === ui.focusedSessionId} inGrid={ui.grid.members.includes(x.id)} onFocus={() => setFocused(x.id)} />
            ))}
          </div>
        ))}
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
