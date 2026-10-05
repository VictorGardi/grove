import type { UiState } from '@shared/types'
import { Button } from '../ui/Button'
import s from './ViewToggle.module.css'

const views: { view: UiState['view']; label: string }[] = [
  { view: 'list', label: 'List' },
  { view: 'board', label: 'Board' },
]

export function ViewToggle({ view, onChange }: { view: UiState['view']; onChange(v: UiState['view']): void }) {
  return (
    <div className={s.toggle}>
      {views.map((v) => (
        <Button key={v.view} size="sm" variant={view === v.view ? 'secondary' : 'ghost'}
          aria-pressed={view === v.view} onClick={() => onChange(v.view)}>
          {v.label}
        </Button>
      ))}
    </div>
  )
}
