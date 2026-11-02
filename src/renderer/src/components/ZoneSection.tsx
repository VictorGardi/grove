import { useState, type MouseEvent } from 'react'
import type { Session } from '@shared/types'
import { kidsKey } from '@shared/groups'
import { childrenSummary, runProgress } from '../family'
import { mostUrgent, statusTone } from '../sessionStatus'
import { rowLine, rowTitle } from '../zoneList'
import { Badge } from './ui/Badge'
import { cx } from './ui/cx'
import { RunProgress } from './RunProgress'
import { Icon } from './ui/Icon'
import { StatusDot } from './ui/StatusDot'
import css from './ZoneSection.module.css'

// A titled section of the zones view: one row per session, a status dot, its title and one line
// on what it was doing. Click focuses it. `collapsible` sections show only a count until opened
// (Running, handled); the others are always open.
export function ZoneSection({ title, sessions, kids, collapsed, onToggleKids, focusedId, picked, collapsible, onFocus, onContextMenu }: {
  title: string
  sessions: Session[]
  kids: Map<string, Session[]> // a parent's children, for the line under its title
  collapsed: string[] // ui.collapsed: a parent's children are open unless its kidsKey is in it, as in the project tree
  onToggleKids: (parentId: string) => void
  focusedId: string | null
  picked: Set<string>
  collapsible?: boolean
  onFocus: (id: string, e: MouseEvent) => void
  onContextMenu: (id: string, e: MouseEvent) => void
}) {
  const [open, setOpen] = useState(false)
  const [handledFor, setHandledFor] = useState<string | null>(null) // the parent whose handled list is open
  const shown = !collapsible || open
  if (sessions.length === 0) return null
  return (
    <section className={css.section} aria-label={title}>
      {collapsible ? (
        <button type="button" className={cx(css.heading, css.toggle)} aria-expanded={open}
          onClick={() => setOpen(!open)}>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={10} />
          <span className={css.name}>{title}</span>
          <Badge tone="muted">{sessions.length}</Badge>
        </button>
      ) : (
        <div className={css.heading}>
          <span className={css.name}>{title}</span>
          <Badge tone="muted">{sessions.length}</Badge>
        </div>
      )}
      {shown && (
        <div className={css.rows}>
          {sessions.map((s) => {
            const list = kids.get(s.id) ?? []
            const urgent = list.length > 0 ? mostUrgent(list) : null
            const progress = runProgress(s, list)
            const kidsOpen = !collapsed.includes(kidsKey(s.id))
            return (
              <div key={s.id} className={cx(css.row, s.id === focusedId && css.selected, picked.has(s.id) && css.picked)}
                onClick={(e) => onFocus(s.id, e)} onContextMenu={(e) => onContextMenu(s.id, e)}>
                <span className={css.dot}><StatusDot tone={statusTone(s)} /></span>
                <span className={css.title}>{rowTitle(s)}</span>
                <span className={css.line}>{rowLine(s)}</span>
                {urgent && (
                  <button type="button" className={css.kids} aria-expanded={kidsOpen}
                    title={kidsOpen ? 'Hide children' : 'Show children'}
                    onClick={(e) => { e.stopPropagation(); onToggleKids(s.id) }}>
                    {!kidsOpen && <StatusDot tone={statusTone(urgent)} />}
                    <Icon name={kidsOpen ? 'chevron-down' : 'chevron-right'} size={10} />
                    {childrenSummary(list)}
                  </button>
                )}
                {s.handled && s.handled.length > 0 && (
                  <div className={css.handled} onClick={(e) => e.stopPropagation()}>
                    <button type="button" className={css.handledBtn} aria-expanded={handledFor === s.id}
                      title="Prompts answered for you" onClick={() => setHandledFor(handledFor === s.id ? null : s.id)}>
                      <Badge tone="muted">{`${s.handled.length} handled`}</Badge>
                    </button>
                    {handledFor === s.id && (
                      <ul className={css.handledList} aria-label="Handled prompts">
                        {s.handled.map((h, i) => (
                          <li key={`${h.childId}-${h.at}-${i}`} className={css.handledItem}>
                            <div className={css.handledHead}><time dateTime={h.at}>{new Date(h.at).toLocaleTimeString()}</time> · {h.kind}</div>
                            <pre className={css.handledScreen}>{h.screen}</pre>
                            <div className={css.handledSent}>Sent: <code>{h.sent}</code></div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {progress && <div className={css.progress}><RunProgress progress={progress} /></div>}
                {urgent && kidsOpen && (
                  <div className={css.kidRows}>
                    {list.map((k) => (
                      <div key={k.id} className={cx(css.kidRow, k.id === focusedId && css.selected, picked.has(k.id) && css.picked)}
                        onClick={(e) => { e.stopPropagation(); onFocus(k.id, e) }}
                        onContextMenu={(e) => { e.stopPropagation(); onContextMenu(k.id, e) }}>
                        <StatusDot tone={statusTone(k)} />
                        <span className={css.kidTitle}>{rowTitle(k)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
