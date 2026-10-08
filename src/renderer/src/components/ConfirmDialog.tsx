import { Button } from './ui/Button'
import { Modal } from './ui/Modal'
import s from './ConfirmDialog.module.css'

interface Props {
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ title, body, confirmLabel, onConfirm, onCancel }: Props) {
  return (
    <Modal width="sm" onClose={onCancel} onConfirm={onConfirm}>
      <div className={s.title}>{title}</div>
      <div className={s.body}>{body}</div>
      <div className={s.actions}>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" autoFocus onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Modal>
  )
}
