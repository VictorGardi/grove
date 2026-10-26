import { useState } from 'react'
import type { Session, SessionKind } from '@shared/types'
import { LAUNCH_KINDS } from '../launchKinds'
import type { SendTarget } from '../sendTarget'
import { ContextMenu, type MenuEntry } from './ui/ContextMenu'
import s from './SendTargetChip.module.css'

const AGENT_KINDS = LAUNCH_KINDS.filter((k) => k.kind !== 'terminal')
const kindLabel = (k: SessionKind) => LAUNCH_KINDS.find((x) => x.kind === k)?.label ?? k

// "Sending to: …" above the full page's Send (D4). One linked session and nothing else: plain.
// Otherwise a menu, the current pick checked: the linked sessions, the repo's unlinked ones below
// them, and, when none is linked, a new session of each agent kind.
export function SendTargetChip({ target, picked, onPick, kind, onKind }: {
  target: SendTarget; picked: Session | null; onPick: (id: string) => void; kind: SessionKind; onKind: (k: SessionKind) => void
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const text = picked ? picked.label : `new ${kindLabel(kind)} session`
  if (target.kind === 'one' && target.others.length === 0) return <div className={s.chip}>Sending to: <span className={s.name}>{text}</span></div>
  const check = (on: boolean) => <span className={s.check} aria-hidden="true">{on ? '✓' : ''}</span>
  const sessionItem = (c: Session, i: number, linked: boolean): MenuEntry => ({
    label: `${c.label}${c.lastStatus === 'gone' ? ' (ended)' : ''}${linked ? '' : ' · not linked'}`,
    glyph: check(c.id === picked?.id), separatorBefore: !linked && i === 0 && target.candidates.length > 0, onSelect: () => onPick(c.id),
  })
  const items: MenuEntry[] = [
    ...target.candidates.map((c, i) => sessionItem(c, i, true)),
    ...target.others.map((c, i) => sessionItem(c, i, false)),
    ...(target.kind === 'none' ? AGENT_KINDS.map((k, i): MenuEntry => ({
      label: `New ${k.label} session`, glyph: check(!picked && k.kind === kind), separatorBefore: i === 0 && target.others.length > 0, onSelect: () => onKind(k.kind),
    })) : []),
  ]
  return (
    <>
      <button type="button" className={s.chip} aria-haspopup="menu" aria-expanded={!!menu}
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu(menu ? null : { x: r.left, y: r.bottom + 4 }) }}>
        Sending to: <span className={s.name}>{text}</span> <span className={s.caret}>▾</span>
      </button>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </>
  )
}
