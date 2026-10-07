import { useEffect, useRef, useState } from 'react'
import { useSlices } from '../stores/slices'
import { Button } from './ui/Button'
import s from './ReviewTray.module.css'

const sentAt = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '')

// Review (n) in a session's header: its tray of drafts, a general note, Send, and the Sent list.
export function ReviewMenu({ sessionId }: { sessionId: string }) {
  const comments = useSlices((x) => x.comments).filter((c) => c.sessionId === sessionId)
  const drafts = comments.filter((c) => c.state === 'draft')
  const sent = comments.filter((c) => c.state === 'sent').sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))
  const note = drafts.find((c) => c.anchor.kind === 'note')
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(note?.body ?? '')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)

  // follow the stored note when it changes elsewhere (sent, deleted)
  useEffect(() => setText(note?.body ?? ''), [note?.id, note?.body])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Stores the textarea as the session's one draft note; false on failure.
  async function saveNote(): Promise<boolean> {
    const body = text.trim()
    const res = note
      ? body === note.body ? { ok: true as const }
        : body ? await window.api.invoke('comment:update', { id: note.id, body })
          : await window.api.invoke('comment:delete', { id: note.id })
      : body ? await window.api.invoke('comment:add', { sessionId, anchor: { kind: 'note' }, body }) : { ok: true as const }
    if (!res.ok) setError(res.error)
    return res.ok
  }

  async function send() {
    setError(null)
    setSending(true)
    try {
      if (!(await saveNote())) return
      const res = await window.api.invoke('review:send', { sessionId })
      if (!res.ok) setError(res.error === 'empty' ? 'Nothing to send' : res.error)
    } finally {
      setSending(false)
    }
  }

  return (
    <div ref={root} className={s.root}>
      <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
        Review ({drafts.length})
      </Button>
      {open && (
        <div className={s.panel} role="dialog" aria-label="Review">
          <label className={s.label} htmlFor={`note-${sessionId}`}>General note</label>
          <textarea id={`note-${sessionId}`} className={s.note} rows={4} value={text} placeholder="Anything for the agent…"
            onChange={(e) => setText(e.target.value)} onBlur={() => void saveNote()} />
          {error && <div className={s.error}>{error}</div>}
          <div className={s.actions}>
            <Button variant="primary" size="sm" disabled={sending || (drafts.length === 0 && !text.trim())} onClick={() => void send()}>
              {sending ? 'Sending…' : 'Send'}
            </Button>
          </div>
          {sent.length > 0 && (
            <details className={s.sent}>
              <summary>Sent ({sent.length})</summary>
              <ul className={s.sentList}>
                {sent.map((c) => (
                  <li key={c.id} className={s.sentItem}>
                    <span className={s.time}>{sentAt(c.sentAt)}</span>
                    <span className={s.body}>{c.body}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
