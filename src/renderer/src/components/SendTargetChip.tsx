import { useState } from 'react'
import type { Session, SessionKind } from '@shared/types'
import { LAUNCH_KINDS } from '../launchKinds'
import type { SendTarget } from '../sendTarget'
import { ContextMenu, type MenuEntry } from './ui/ContextMenu'
import s from './SendTargetChip.module.css'

const AGENT_KINDS = LAUNCH_KINDS.filter((k) => k.kind !== 'terminal')
const kindLabel = (k: SessionKind) => LAUNCH_KINDS.find((x) => x.kind === k)?.label ?? k

// "Sending to: …" above the full page's Send (D4). One session: plain. Several: a menu to switch, the current one checked.
// None: the agent a new session starts with, and a menu to change it.
export function SendTargetChip({ target, picked, onPick, kind, onKind }: {
  target: SendTarget; picked: Session | null; onPick: (id: string) => void; kind: SessionKind; onKind: (k: SessionKind) => void
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const text = target.kind === 'none' ? `new ${kindLabel(kind)} session` : picked?.label ?? ''
  if (target.kind === 'one') return <div className={s.chip}>Sending to: <span className={s.name}>{text}</span></div>
  const items: MenuEntry[] = target.kind === 'many'
    ? target.candidates.map((c) => ({ label: c.lastStatus === 'gone' ? `${c.label} (ended)` : c.label, glyph: <span className={s.check} aria-hidden="true">{c.id === picked?.id ? '✓' : ''}</span>, onSelect: () => onPick(c.id) }))
    : AGENT_KINDS.map((k) => ({ label: k.label, icon: k.icon, onSelect: () => onKind(k.kind) }))
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
