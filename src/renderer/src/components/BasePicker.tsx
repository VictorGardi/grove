import { useEffect, useMemo, useRef, useState } from 'react'
import { baseChoices, type BaseRefs } from '../diffBases'
import { cx } from './ui/cx'
import { Icon } from './ui/Icon'
import s from './BasePicker.module.css'

const NO_REFS: BaseRefs = { branches: [], current: null, default: null }

// "Compare against": a button naming the current target; open, a search box over a short list (the default
// branch, then recent picks) that finds any local or remote branch once you type. The branch list is read
// when it opens.
export function BasePicker({ sessionId, base, defaultName, recents, onPick }: {
  sessionId: string
  base: string | null // null: the auto-detected default branch
  defaultName: string | null
  recents: string[] | undefined
  onPick: (base: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [at, setAt] = useState(0)
  const [refs, setRefs] = useState<BaseRefs | null>(null) // null until this open's branch list arrives
  const root = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    let alive = true
    setRefs(null)
    void window.api.invoke('diff:refs', { sessionId }).then((res) => { if (alive && res.ok) setRefs(res.data) })
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) { setOpen(false); setQuery(''); setAt(0) } }
    document.addEventListener('mousedown', onDown)
    return () => { alive = false; document.removeEventListener('mousedown', onDown) }
  }, [open, sessionId])

  const choices = useMemo(() => baseChoices(refs ?? NO_REFS, recents, query), [refs, recents, query])
  const current = Math.min(at, Math.max(choices.length - 1, 0))
  useEffect(() => { rowRef.current?.scrollIntoView({ block: 'nearest' }) }, [current, choices])

  const close = () => { setOpen(false); setQuery(''); setAt(0) }
  const pick = (i: number) => {
    const c = choices[i]
    if (!c) return
    close()
    onPick(c.ref)
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close() }
    else if (e.key === 'Enter') { e.preventDefault(); pick(current) }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = choices.length
      if (n) setAt((current + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
    }
  }
  const shown = base ?? defaultName
  const hint = !defaultName && !query ? 'No main branch found — type to search' : 'No matching branch'

  return (
    <div className={s.picker} ref={root}>
      <button type="button" className={s.button} aria-haspopup="listbox" aria-expanded={open} aria-label="Diff against"
        title={shown ? `Compared against ${shown}` : undefined} onClick={() => (open ? close() : setOpen(true))}>
        <span className={s.name}>{shown ?? 'Pick a branch'}</span>
        <Icon name="chevron-down" />
      </button>
      {open && (
        <div className={s.pop}>
          <input autoFocus className={s.input} placeholder="Search branches…" aria-label="Search branches" value={query}
            onChange={(e) => { setQuery(e.target.value); setAt(0) }} onKeyDown={onKeyDown} />
          <div className={s.list} role="listbox">
            {refs && choices.length === 0 && <div className={s.empty}>{hint}</div>}
            {choices.map((c, i) => (
              <div key={c.ref ?? '(default)'} ref={i === current ? rowRef : undefined} role="option" aria-selected={i === current}
                className={cx(s.row, i === current && s.on, (c.ref ?? null) === base && s.chosen)}
                onMouseMove={() => setAt(i)} onClick={() => pick(i)}>
                <span className={s.rowName}>{c.name}</span>
                {c.kind === 'default' && <span className={s.tag}>default</span>}
                {c.kind === 'recent' && <span className={s.tag}>recent</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
