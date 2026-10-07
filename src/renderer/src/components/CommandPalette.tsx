import { useEffect, useMemo, useRef, useState } from 'react'
import { rank, type PaletteItem } from '../paletteItems'
import { cx } from './ui/cx'
import { Modal } from './ui/Modal'
import s from './CommandPalette.module.css'

// The label with its matched characters wrapped in <mark>.
function Marked({ text, indices }: { text: string; indices: number[] }) {
  if (indices.length === 0) return <>{text}</>
  const hit = new Set(indices)
  return <>{[...text].map((ch, i) => (hit.has(i) ? <mark key={i}>{ch}</mark> : ch))}</>
}

export function CommandPalette({ items, onClose }: { items: PaletteItem[]; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [at, setAt] = useState(0)
  const results = useMemo(() => rank(items, query), [items, query])
  const current = Math.min(at, Math.max(results.length - 1, 0))
  const rowRef = useRef<HTMLDivElement>(null)

  useEffect(() => { rowRef.current?.scrollIntoView({ block: 'nearest' }) }, [current, results])

  const pick = (item: PaletteItem | undefined) => {
    if (!item) return
    onClose()
    item.run()
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const n = results.length
    if (n) setAt((current + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
  }

  return (
    <Modal onClose={onClose} onConfirm={() => pick(results[current]?.item)}>
      <input
        autoFocus
        className={s.input}
        placeholder="Jump to a session, feature or project, or run a command…"
        aria-label="Command palette"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setAt(0) }}
        onKeyDown={onKeyDown}
      />
      <div className={s.list} role="listbox">
        {results.length === 0 && <div className={s.empty}>No matches</div>}
        {results.map(({ item, indices }, i) => (
          <div key={item.id} ref={i === current ? rowRef : undefined} role="option" aria-selected={i === current}
            className={cx(s.row, i === current && s.on)}
            onMouseMove={() => setAt(i)} onClick={() => pick(item)}>
            <span className={s.kind}>{item.kind}</span>
            <span className={cx(s.label, item.waiting && s.waiting)}><Marked text={item.label} indices={indices} /></span>
            <span className={s.detail}>{item.detail}</span>
            {item.hint && <span className={s.hint}>{item.hint}</span>}
          </div>
        ))}
      </div>
    </Modal>
  )
}
