import { cx } from '../ui/cx'
import s from './TopBar.module.css'

export function TopBar({ onNew }: { onNew: () => void }) {
  return (
    <header className={cx(s.bar, 'app-drag')}>
      <div className={s.wordmark}>grove</div>
      <div className={s.centre}>
        {/* inert until search lands (child 7) */}
        <div role="search" aria-disabled="true" className={cx(s.search, 'app-no-drag')}>Search grove</div>
        <button aria-label="New session" className={cx(s.new, 'app-no-drag')} onClick={onNew}>+</button>
      </div>
      <div />
    </header>
  )
}
