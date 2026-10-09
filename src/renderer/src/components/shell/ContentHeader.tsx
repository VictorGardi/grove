import { Fragment, type ReactNode } from 'react'
import s from './ContentHeader.module.css'

export interface HeaderCrumb { label: string; onClick?: () => void } // onClick: an up-link (ADR 0018)

export function ContentHeader({ crumbs, after, right }: { crumbs: HeaderCrumb[]; after?: ReactNode; right?: ReactNode }) {
  const last = crumbs.length - 1
  return (
    <header className={`${s.header} app-drag`}>
      <div className={`${s.crumbs} app-no-drag`}>
        {crumbs.map((c, i) => (i < last
          ? (
            <Fragment key={i}>
              {c.onClick
                ? <button type="button" className={s.link} onClick={c.onClick}>{c.label}</button>
                : <span className={s.parent}>{c.label}</span>}
              <span className={s.parent}> › </span>
            </Fragment>
          )
          : <span key={i} className={s.current}>{c.label}</span>))}
      </div>
      {after && <div className="app-no-drag">{after}</div>}
      {right && <div className={`${s.right} app-no-drag`}>{right}</div>}
    </header>
  )
}
