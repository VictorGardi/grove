import { Button } from './ui/Button'
import { Modal } from './ui/Modal'
import { Spinner } from './ui/Spinner'
import s from './ConfirmDialog.module.css'

interface Props {
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  // work is under way: both buttons stop answering, and the confirm button turns to a spinner
  busy?: boolean
}

export function ConfirmDialog({ title, body, confirmLabel, onConfirm, onCancel, busy }: Props) {
  return (
    <Modal width="sm" onClose={() => { if (!busy) onCancel() }} onConfirm={() => { if (!busy) onConfirm() }}>
      <div className={s.title}>{title}</div>
      <div className={s.body}>{body}</div>
      <div className={s.actions}>
        <Button disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button variant="primary" autoFocus disabled={busy} onClick={onConfirm}>{busy ? <Spinner /> : confirmLabel}</Button>
      </div>
    </Modal>
  )
}
