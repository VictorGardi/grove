import { useEffect, useRef } from 'react'
import type { Session } from '@shared/types'
import { contextView } from '../contextGauge'
import { gridShape, paneTitle, visibleMembers, type GridView } from '../gridView'
import { useSlices } from '../stores/slices'
import { colorTags } from '../tags'
import { linkedFeature } from '../tree'
import { SessionMeta } from './SessionMeta'
import { Button } from './ui/Button'
import { cx } from './ui/cx'
import { ContextGauge } from './ContextGauge'
import { GridToolbar } from './GridToolbar'
import { TerminalView } from './TerminalView'
import s from './SessionGrid.module.css'

// The members side by side. Panes are keyed by session id, so reflow never remounts or re-attaches a terminal.
export function SessionGrid({ sessions, focusedId, view, onViewChange, onFocusPane, onResume, overlayOpen }: {
  sessions: Session[] // every member, in grid order; the view narrows them
  view: GridView
  onViewChange: (view: GridView) => void
  focusedId: string
  onFocusPane: (id: string) => void // a click or terminal focus inside a pane
  onResume(id: string): void // a pane that ended; the app owns the downgrade notice
  overlayOpen: boolean // a modal or the palette is open: no terminal takes the keyboard
}) {
  const { projects, features, toggleGridMember, openAlone, clearGrid } = useSlices()
  const visible = visibleMembers(sessions, view, projects)
  const root = useRef<HTMLDivElement>(null)
  // the dimming slider sets the unfocused panes' opacity for this grid only
  useEffect(() => { root.current?.style.setProperty('--pane-dim', String(view.dim)) }, [view.dim])
  const { cols, rows } = gridShape(visible.length, view.layout)
  useEffect(() => {
    root.current?.style.setProperty('--cols', String(cols))
    root.current?.style.setProperty('--rows', String(rows))
  }, [cols, rows])
  const tags = colorTags(projects, features.items)
  return (
    <div className={s.root} ref={root}>
      <GridToolbar members={sessions} projects={projects} view={view} visibleCount={visible.length} onChange={onViewChange} onEmpty={clearGrid} />
      <div className={s.grid}>
        {visible.length === 0 && <div className={s.none}>No sessions match</div>}
        {visible.map((x) => {
          const focused = x.id === focusedId
          const focus = () => { if (!focused) onFocusPane(x.id) }
          const feature = linkedFeature(x, features.items)
          const context = contextView(x)
          return (
            <div key={x.id} className={cx(s.pane, focused ? s.focused : s.dim)} onMouseDownCapture={focus}>
              <div className={s.header}>
                <SessionMeta lead={<span className={s.title}>{paneTitle(projects.find((p) => p.id === x.projectId), x)}</span>}
                  session={x} feature={feature} tagIndex={feature ? tags.group(feature.projectId, feature.group ? feature.slug : feature.parent) : null}
                  context={context ? <ContextGauge view={context} /> : undefined} dense
                  actions={<>
                    <Button variant="ghost" size="sm" round icon="maximize" aria-label="Open alone" title="Open alone" onClick={() => openAlone(x.id)} />
                    <Button variant="ghost" size="sm" round icon="x" aria-label="Remove from grid" title="Remove from grid" onClick={() => toggleGridMember(x.id)} />
                  </>} />
              </div>
              {x.lastStatus === 'running'
                ? <TerminalView sessionId={x.id} active={focused && !overlayOpen} onFocus={focus} />
                : (
                  <div className={s.ended}>
                    <div>Session ended</div>
                    <div className={s.endedActions}>
                      {x.kind !== 'terminal' && (
                        <Button variant="primary" size="sm" icon="resume" onClick={() => onResume(x.id)}>Resume</Button>
                      )}
                      <Button size="sm" icon="trash" onClick={() => toggleGridMember(x.id)}>Remove</Button>
                    </div>
                  </div>
                )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
