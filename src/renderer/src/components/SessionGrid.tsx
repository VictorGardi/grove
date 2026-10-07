import type { Session } from '@shared/types'
import { gridCols } from '../gridView'
import { cx } from './ui/cx'
import { TerminalView } from './TerminalView'
import s from './SessionGrid.module.css'

const COLS = { 1: s.cols1, 2: s.cols2, 3: s.cols3 }

// The members side by side. Panes are keyed by session id, so reflow never remounts or re-attaches a terminal.
export function SessionGrid({ sessions, focusedId, onFocusPane, overlayOpen }: {
  sessions: Session[]
  focusedId: string
  onFocusPane: (id: string) => void // a click or terminal focus inside a pane
  overlayOpen: boolean // a modal or the palette is open: no terminal takes the keyboard
}) {
  return (
    <div className={cx(s.grid, COLS[gridCols(sessions.length)])}>
      {sessions.map((x) => {
        const focused = x.id === focusedId
        const focus = () => { if (!focused) onFocusPane(x.id) }
        return (
          <div key={x.id} className={cx(s.pane, focused ? s.focused : s.dim)} onMouseDownCapture={focus}>
            {x.lastStatus === 'running'
              ? <TerminalView sessionId={x.id} active={focused && !overlayOpen} onFocus={focus} />
              : <div className={s.ended}>Session ended</div>}
          </div>
        )
      })}
    </div>
  )
}
