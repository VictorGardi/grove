import { cx } from '../ui/cx'
import { Icon } from '../ui/Icon'
import s from './TopBar.module.css'

export function TopBar() {
  return (
    <header className={cx(s.bar, 'app-drag')}>
      <span className={s.logo}><Icon name="logo" size={15} /></span>
    </header>
  )
}
