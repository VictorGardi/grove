import { useState } from 'react'
import { Button } from './ui/Button'
import s from './CommentEditor.module.css'

// A small editor for one comment: ⇧↩ or ⌘↩ saves, Esc cancels.
export function CommentEditor({ initial = '', error, onSave, onCancel }: {
  initial?: string
  error?: string | null
  onSave: (body: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(initial)
  const save = () => {
    if (text.trim()) onSave(text)
  }
  return (
    <div className={s.editor}>
      <textarea className={s.text} rows={3} autoFocus value={text} placeholder="Comment…" aria-label="Comment"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onCancel()
          } else if (e.key === 'Enter' && (e.shiftKey || e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            save()
          }
        }} />
      {error && <div className={s.error}>{error}</div>}
      <div className={s.actions}>
        <span className={s.hint}>⇧↩ to save</span>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={!text.trim()} onClick={save}>Save</Button>
      </div>
    </div>
  )
}
