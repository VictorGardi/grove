import type { Project, Session } from '@shared/types'
import { layoutLabel, type GridView } from '../gridView'
import { Button } from './ui/Button'
import { cx } from './ui/cx'
import s from './GridToolbar.module.css'

// Filter tabs, layout label, column slider, eye and Empty grid. View-only: nothing here is persisted.
export function GridToolbar({ members, projects, view, visibleCount, onChange, onEmpty }: {
  members: Session[]
  projects: Project[]
  view: GridView
  visibleCount: number
  onChange: (view: GridView) => void
  onEmpty: () => void
}) {
  const tabs = projects.flatMap((p) => {
    const count = members.filter((m) => m.projectId === p.id).length
    return count > 0 ? [{ id: p.id, name: p.name, count }] : []
  })
  const filter = tabs.some((t) => t.id === view.filter) ? view.filter : null // a stale filter reads as ALL
  const tab = (id: string | null, label: string, count: number) => (
    <button key={id ?? 'all'} type="button" className={cx(s.tab, filter === id && s.active)} aria-pressed={filter === id}
      onClick={() => onChange({ ...view, filter: id })}>
      {label} <span className={s.count}>{count}</span>
    </button>
  )
  return (
    <div className={s.toolbar}>
      <div className={s.tabs}>
        {tab(null, 'ALL', members.length)}
        {tabs.map((t) => tab(t.id, t.name, t.count))}
      </div>
      <span className={s.spacer} />
      <span className={s.layout} title="Columns × rows">{layoutLabel(visibleCount, view.maxCols)}</span>
      <input type="range" className={s.slider} min={1} max={3} step={1} value={view.maxCols} aria-label="Maximum columns"
        title="Maximum columns" onChange={(e) => onChange({ ...view, maxCols: Number(e.target.value) as 1 | 2 | 3 })} />
      <Button variant="ghost" size="sm" round icon={view.hideEnded ? 'eye-off' : 'eye'} aria-pressed={view.hideEnded}
        aria-label={view.hideEnded ? 'Show ended sessions' : 'Hide ended sessions'}
        title={view.hideEnded ? 'Show ended sessions' : 'Hide ended sessions'}
        onClick={() => onChange({ ...view, hideEnded: !view.hideEnded })} />
      <Button size="sm" onClick={onEmpty}>Empty grid</Button>
    </div>
  )
}
