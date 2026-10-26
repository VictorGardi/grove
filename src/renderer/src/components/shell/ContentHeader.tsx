import { Fragment, type ReactNode } from 'react'
import s from './ContentHeader.module.css'

export interface HeaderCrumb { label: string; onClick?: () => void } // onClick: an up-link (ADR 0018)

// The trail itself, so a session header can hand it to SessionMeta and keep the same type and
// truncation the grid panes use. `ancestors`: every crumb is drawn as a parent, for the session
// header's second line, where the session's own name is already on the line above.
export function Crumbs({ crumbs, ancestors }: { crumbs: HeaderCrumb[]; ancestors?: boolean }) {
  const last = crumbs.length - 1
  const part = (c: HeaderCrumb, i: number) => (c.onClick
    ? <button key={i} type="button" className={`${s.link} ${s.part}`} onClick={c.onClick}>{c.label}</button>
    : <span key={i} className={`${s.parent} ${s.part}`}>{c.label}</span>)
  return (
    <span className={s.trail}>
      {crumbs.map((c, i) => (i < last
        ? (
          <Fragment key={i}>
            {part(c, i)}
            <span className={`${s.parent} ${s.sep}`}>›</span>
          </Fragment>
        )
        : ancestors ? part(c, i) : <span key={i} className={s.current}>{c.label}</span>))}
    </span>
  )
}

// `meta` replaces the crumb trail for a session, so the header draws the same row a grid pane
// does. `right` stays for the header's own actions, which are not session facts.
export function ContentHeader({ crumbs, meta, right }: { crumbs: HeaderCrumb[]; meta?: ReactNode; right?: ReactNode }) {
  return (
    <header className={`${s.header} app-drag`}>
      <div className={`${s.left} app-no-drag`}>{meta ?? <Crumbs crumbs={crumbs} />}</div>
      {right && <div className={`${s.right} app-no-drag`}>{right}</div>}
    </header>
  )
}
