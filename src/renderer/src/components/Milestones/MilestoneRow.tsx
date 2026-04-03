import type { MilestoneInfo } from '@shared/types'
import styles from './MilestoneRow.module.css'

interface MilestoneRowProps {
  milestone: MilestoneInfo
  isSelected: boolean
  onClick: () => void
}

export function MilestoneRow({
  milestone,
  isSelected,
  onClick
}: MilestoneRowProps): React.JSX.Element {
  const { taskCounts } = milestone
  const progressPct =
    taskCounts.total > 0 ? Math.round((taskCounts.done / taskCounts.total) * 100) : 0

  return (
    <div
      className={`${styles.row} ${isSelected ? styles.selected : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}
    >
      <div className={styles.topRow}>
        <span className={styles.diamond}>&#9670;</span>
        <span className={styles.title}>{milestone.title}</span>
        <span
          className={`${styles.statusBadge} ${milestone.status === 'open' ? styles.statusOpen : styles.statusClosed}`}
        >
          {milestone.status.toUpperCase()}
        </span>
      </div>

      {milestone.tags.length > 0 && (
        <div className={styles.tags}>
          {milestone.tags.map((tag) => (
            <span key={tag} className={styles.tag}>
              {tag}
            </span>
          ))}
        </div>
      )}

      {taskCounts.total > 0 && (
        <div className={styles.progressRow}>
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${progressPct}%` }} />
          </div>
          <span className={styles.taskCount}>
            {taskCounts.done}/{taskCounts.total} tasks
          </span>
        </div>
      )}
    </div>
  )
}
