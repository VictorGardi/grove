import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { Session } from '@shared/types'
import { DOT_TONE, STATE_WORD, drawerState, filterDrawer, tabCounts, type DrawerTab } from '../childDrawer'
import { statusAge, statusView } from '../sessionStatus'
import { StatusDot } from './ui/StatusDot'
import { WorkflowStatusButton } from './ui/WorkflowStatusPicker'
import { cx } from './ui/cx'
import s from './ChildDrawer.module.css'

const POLL_MS = 2000
const LINES = 12

const TABS: { id: DrawerTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'needs', label: 'Needs you' },
  { id: 'running', label: 'Running' },
  { id: 'done', label: 'Done' },
]

// The live screen of one child while it is hovered or focused: polled every 2s, and only then.
// Empty or failed, there is no pane to show, so the status stands alone.
function Screen({ kid }: { kid: Session }) {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    const read = () => {
      void window.api.invoke('session:read', { id: kid.id, lines: LINES }).then((res) => {
        if (live) setText(res.ok && res.data.text.trim() ? res.data.text : '')
      }, () => { if (live) setText('') })
    }
    setText(null)
    read()
    const t = setInterval(read, POLL_MS)
    return () => { live = false; clearInterval(t) }
  }, [kid.id])
  if (text) return <pre className={s.screen} aria-label={`${kid.label} screen`}>{text}</pre>
  return <div className={s.status}>{statusView(kid).label}{text === '' && ', status only, pane gone'}</div>
}

// A parent's children as a panel beside the sidebar: tabs by state, a name filter, one line each
// (status control, state dot, jump, promote), and the hovered child's live screen. It is
// portalled and swallows its own pointer events, so nothing reaches the row that opened it.
export function ChildDrawer({ parent, kids, onJump, onClose }: { parent: Session; kids: Session[]; onJump: (id: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState<DrawerTab>('all')
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<string | null>(null) // the hovered or focused child
  const [left, setLeft] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const counts = tabCounts(kids)
  const list = filterDrawer(kids, tab, query)
  const shown = kids.find((c) => c.id === active)
  const now = Date.now()
  // beside the sidebar: at its right edge, wherever it has been dragged to
  useLayoutEffect(() => { setLeft(document.querySelector('aside')?.getBoundingClientRect().right ?? 0) }, [])
  useEffect(() => {
    // a trigger (the sidebar bar, the header chip) toggles the drawer itself
    const away = (e: MouseEvent) => {
      const el = e.target as Element
      if (!ref.current?.contains(el) && !el.closest?.('[data-drawer-trigger]')) onClose()
    }
    // capture phase, and swallowed: a focused terminal would otherwise take the Escape for the agent
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation(); e.preventDefault(); onClose()
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc, true)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc, true) }
  }, [onClose])
  const promote = (id: string, promoted: boolean) => void window.api.invoke('session:promote', { id, promoted })
  return createPortal(
    <div ref={ref} className={s.drawer} style={{ '--left': `${left}px` } as CSSProperties} role="dialog" aria-label={`${parent.label} children`}
      onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <header className={s.head}>
        <span className={s.title}>{parent.label}</span>
        <button type="button" className={s.close} aria-label="Close" onClick={onClose}>×</button>
      </header>
      <div className={s.tabs} role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={cx(s.tab, tab === t.id && s.tabOn)} onClick={() => setTab(t.id)}>
            {t.label} <span className={s.count}>{counts[t.id]}</span>
          </button>
        ))}
      </div>
      <input className={s.filter} value={query} placeholder="Filter by name" aria-label="Filter children by name" autoFocus
        onChange={(e) => setQuery(e.target.value)} />
      <div className={s.list} onMouseLeave={() => setActive(null)}>
        {list.map((c) => {
          const state = drawerState(c)
          const age = c.statusAt ? statusAge(Date.parse(c.statusAt), now) : ''
          return (
            <div key={c.id} className={cx(s.row, active === c.id && s.rowOn)} tabIndex={0}
              onMouseEnter={() => setActive(c.id)} onFocus={() => setActive(c.id)}>
              <WorkflowStatusButton session={c} />
              <StatusDot tone={DOT_TONE[state]} />
              <button type="button" className={s.jump} title={`${c.label} · ${statusView(c).label}`} onClick={() => { onJump(c.id); onClose() }}>{c.label}</button>
              <span className={cx(s.state, s[state])}>{STATE_WORD[state]}</span>
              <span className={s.age}>{age}</span>
              <button type="button" className={s.promote} title={c.promoted ? 'Back behind its parent' : 'Show as a row of its own'}
                onClick={() => promote(c.id, !c.promoted)}>
                {c.promoted ? 'unpromote' : '↗ promote'}
              </button>
            </div>
          )
        })}
        {list.length === 0 && <div className={s.empty}>No children match</div>}
      </div>
      {shown && <Screen key={shown.id} kid={shown} />}
    </div>,
    document.body,
  )
}
