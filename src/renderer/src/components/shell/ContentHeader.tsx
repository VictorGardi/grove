import type { ReactNode } from 'react'
import s from './ContentHeader.module.css'

export function ContentHeader({ crumbs, right }: { crumbs: string[]; right?: ReactNode }) {
  const last = crumbs.length - 1
  return (
    <header className={s.header}>
      <div className={s.crumbs}>
        {crumbs.map((c, i) => (i < last
          ? <span key={i} className={s.parent}>{c} / </span>
          : <span key={i} className={s.current}>{c}</span>))}
      </div>
      {right && <div className={s.right}>{right}</div>}
    </header>
  )
}
