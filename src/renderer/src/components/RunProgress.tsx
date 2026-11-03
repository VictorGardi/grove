import type { CSSProperties, MouseEvent } from 'react'
import type { Session } from '@shared/types'
import type { RunProgress as Progress } from '../family'
import { barCounts } from '../family'
import { cx } from './ui/cx'
import css from './RunProgress.module.css'

const BLOCKS = ['done', 'failed', 'run', 'wait', 'queued'] as const

// A parent's progress on line two of its row. With children: one bar of blocks sized by count
// (done, failed, running, waiting, queued), the counts text, and an amber chip when children need
// the human; the whole bar is a button that opens the child drawer. Without children it is the
// plain fill of `grove progress`.
export function RunProgress({ parent, kids, progress, onOpen }: { parent: Session; kids: Session[]; progress: Progress | null; onOpen: (id: string) => void }) {
  if (kids.length === 0) {
    if (!progress) return null
    return (
      <div className={css.root}>
        <div className={css.bar} role="progressbar" aria-label={progress.label}
          aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
          <div className={css.fill} style={{ '--fill': `${progress.pct}%` } as CSSProperties} />
        </div>
        <span className={css.label}>{progress.label}</span>
      </div>
    )
  }
  const c = barCounts(parent, kids)
  const open = (e: MouseEvent) => { e.stopPropagation(); onOpen(parent.id) }
  return (
    <div className={css.root}>
      <button type="button" className={css.trigger} data-drawer-trigger aria-label={c.label} aria-haspopup="dialog" title="Show children" onClick={open}>
        <span className={css.bar} aria-hidden>
          {BLOCKS.map((k) => {
            const n = c[k]
            return n > 0 && <span key={k} className={cx(css.seg, css[k])} style={{ '--n': n } as CSSProperties} />
          })}
        </span>
        <span className={css.label}>{c.text}</span>
      </button>
      {c.needsYou > 0 && <span className={css.chip}>{c.needsYou} needs you</span>}
    </div>
  )
}
