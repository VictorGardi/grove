import { Button } from '../ui/Button'
import { cx } from '../ui/cx'
import { Icon } from '../ui/Icon'
import s from './TopBar.module.css'

export function TopBar({ onNew, onSearch, waiting, onWaiting }: {
  onNew: () => void
  onSearch: () => void // opens the command palette
  waiting: number // sessions waiting on the human
  onWaiting: () => void // focuses the longest-waiting one
}) {
  return (
    <header className={cx(s.bar, 'app-drag')}>
      <div className={s.brand}>
        <span className={s.logo}><Icon name="logo" size={15} /></span>
        <span className={s.wordmark}>grove</span>
      </div>
      <div className={s.centre}>
        <button type="button" className={cx(s.search, 'app-no-drag')} onClick={onSearch}>
          <Icon name="search" />
          Search grove
        </button>
        <Button round icon="plus" aria-label="New session" className="app-no-drag" onClick={onNew} />
      </div>
      {waiting > 0 ? (
        <div className={s.right}>
          <Button size="sm" className={cx(s.waiting, 'app-no-drag')} onClick={onWaiting}>{waiting} waiting</Button>
        </div>
      ) : <div />}
    </header>
  )
}
