import type { Session } from '@shared/types'
import { gridCols } from '../gridView'
import { cx } from './ui/cx'
import { TerminalView } from './TerminalView'
import s from './SessionGrid.module.css'

const COLS = { 1: s.cols1, 2: s.cols2, 3: s.cols3 }

// The members side by side. Panes are keyed by session id, so reflow never remounts or re-attaches a terminal.
export function SessionGrid({ sessions, focusedId, overlayOpen }: {
  sessions: Session[]
  focusedId: string
  overlayOpen: boolean // a modal or the palette is open: no terminal takes the keyboard
}) {
  return (
    <div className={cx(s.grid, COLS[gridCols(sessions.length)])}>
      {sessions.map((x) => (
        <div key={x.id} className={s.pane}>
          {x.lastStatus === 'running'
            ? <TerminalView sessionId={x.id} active={x.id === focusedId && !overlayOpen} />
            : <div className={s.ended}>Session ended</div>}
        </div>
      ))}
    </div>
  )
}
