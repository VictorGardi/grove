import type { UiState } from '@shared/types'
import { Button } from '../ui/Button'
import s from './BoardSwitch.module.css'

const boards: { board: UiState['board']; label: string }[] = [
  { board: 'features', label: 'Features' },
  { board: 'sessions', label: 'Sessions' },
]

// What the project page's board shows (⌘B also switches it).
export function BoardSwitch({ board, onChange }: { board: UiState['board']; onChange(b: UiState['board']): void }) {
  return (
    <div className={s.toggle}>
      {boards.map((b) => (
        <Button key={b.board} size="sm" variant={board === b.board ? 'secondary' : 'ghost'}
          aria-pressed={board === b.board} onClick={() => onChange(b.board)}>
          {b.label}
        </Button>
      ))}
    </div>
  )
}
