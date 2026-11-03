import type { CSSProperties } from 'react'
import type { RunProgress as Progress } from '../family'
import css from './RunProgress.module.css'

// A run's progress: a slim bar and its label ("4 of 8 slices done, 3 children done").
export function RunProgress({ progress }: { progress: Progress }) {
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
