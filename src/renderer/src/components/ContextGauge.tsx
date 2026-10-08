import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { formatPct, formatUsage, gaugeFill, type ContextView } from '../contextGauge'
import { cx } from './ui/cx'
import { GaugeIcon, Icon } from './ui/Icon'
import s from './ContextGauge.module.css'

const title = (v: ContextView) => (v.pct === null ? 'Context window: no reading yet' : `Context window: ${formatPct(v.pct)} used`)

// The grid pane header's gauge: the icon and the number, dimmed once the session has ended.
export function ContextGauge({ view }: { view: ContextView }) {
  return (
    <span className={cx(s.gauge, view.dim && s.dim)} title={title(view)}>
      <GaugeIcon fill={gaugeFill(view.pct)} size={14} />
      <span>{formatPct(view.pct)}</span>
    </span>
  )
}

// The session header's gauge: a ring and a chevron; clicking opens the context details.
export function ContextPopover({ view }: { view: ContextView }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [open])
  const usage = formatUsage(view.tokens, view.window)
  return (
    <div className={s.wrap} ref={ref}>
      <button type="button" className={cx(s.trigger, view.dim && s.dim)} aria-expanded={open} aria-label="Context usage" title={title(view)} onClick={() => setOpen(!open)}>
        <GaugeIcon fill={gaugeFill(view.pct)} size={16} />
        <Icon name="chevron-down" size={12} />
      </button>
      {open && (
        <div className={s.popover} role="dialog" aria-label="Context usage">
          <div className={s.row}>
            <span className={s.label}>Context Usage</span>
            <span className={s.pct}>{formatPct(view.pct)}</span>
          </div>
          <div className={s.bar}><div className={s.fill} style={{ '--fill': `${gaugeFill(view.pct) * 100}%` } as CSSProperties} /></div>
          {usage && <div className={s.usage}>{usage}</div>}
        </div>
      )}
    </div>
  )
}
