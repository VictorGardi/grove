import { useEffect, useRef, useState } from 'react'
import type { Comment } from '@shared/types'
import { groupForTray } from '../reviewView'
import { useSlices } from '../stores/slices'
import { CommentEditor } from './CommentEditor'
import { Button } from './ui/Button'
import s from './ReviewTray.module.css'

const SEND_ERRORS: Record<string, string> = {
  empty: 'Nothing to send',
  'not-ready': 'The session did not become ready. Try again.',
  gone: 'This session has ended and cannot be resumed.',
  busy: 'A send is already running.',
}

const sentAt = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '')

const lineLabel = (c: Comment) => {
  const a = c.anchor
  if (a.kind === 'note') return ''
  return `L${a.start === a.end ? a.start : `${a.start}-${a.end}`}${a.kind === 'diff' && a.side === 'old' ? ' (removed)' : ''}`
}

// One draft in the tray: where it is, its quote, its body; Edit and Delete. A click on the quote opens the diff or the artifact.
function TrayItem({ comment, onJump }: { comment: Comment; onJump: () => void }) {
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const a = comment.anchor
  async function save(body: string) {
    const res = await window.api.invoke('comment:update', { id: comment.id, body })
    if (res.ok) setEditing(false)
    else setError(res.error)
  }
  return (
    <li className={s.item}>
      <button type="button" className={s.where} onClick={onJump}>
        <span>{lineLabel(comment)}</span>
        {comment.orphaned && <span className={s.orphan}>orphaned</span>}
        {a.kind === 'diff' && <span className={s.quote}>{a.lines[0]}</span>}
        {a.kind === 'file' && <span className={s.quote}>{a.exact}</span>}
      </button>
      {editing ? <CommentEditor initial={comment.body} error={error} onSave={(b) => void save(b)} onCancel={() => setEditing(false)} /> : (
        <div className={s.itemRow}>
          <span className={s.body}>{comment.body}</span>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
          <Button size="sm" variant="ghost" onClick={() => void window.api.invoke('comment:delete', { id: comment.id })}>Delete</Button>
        </div>
      )}
    </li>
  )
}

// Comments (n) in the diff and artifact viewers' headers: its tray of drafts, a general note, Send, and the Sent list.
// SAVE uses the session whose content is being viewed (sessionId prop); SEND uses focusedSessionId.
export function ReviewMenu({ sessionId }: { sessionId: string }) {
  const comments = useSlices((x) => x.comments).filter((c) => c.sessionId === sessionId)
  const drafts = comments.filter((c) => c.state === 'draft')
  const sent = comments.filter((c) => c.state === 'sent').sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))
  const groups = groupForTray(drafts)
  const openDiff = useSlices((x) => x.openDiff)
  const openArtifact = useSlices((x) => x.openArtifact)
  const note = drafts.find((c) => c.anchor.kind === 'note')
  const focusedSessionId = useSlices((x) => x.ui.focusedSessionId)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(note?.body ?? '')
  const [sending, setSending] = useState(false)
  const [resuming, setResuming] = useState(false)
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
    const targetSessionId = focusedSessionId ?? sessionId
    const targetIsGone = useSlices.getState().sessions.find((v) => v.id === targetSessionId)?.lastStatus === 'gone'
    setResuming(targetIsGone)
    try {
      if (!(await saveNote())) return
      const res = await window.api.invoke('review:send', { sessionId: targetSessionId })
      if (!res.ok) setError(SEND_ERRORS[res.error] ?? res.error)
    } finally {
      setSending(false)
    }
  }

  return (
    <div ref={root} className={s.root}>
      <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
        Comments ({drafts.length})
      </Button>
      {open && (
        <div className={s.panel} role="dialog" aria-label="Comments">
          {groups.map((g) => (
            <section key={g.label} className={s.group}>
              <div className={s.groupLabel}>{g.label}</div>
              <ul className={s.items}>
                {g.comments.map((c) => <TrayItem key={c.id} comment={c} onJump={() => (c.anchor.kind === 'file'
                  ? openArtifact({ kind: 'file', projectId: c.anchor.projectId, path: c.anchor.path, hash: null, fromDiff: null })
                  : openDiff(sessionId))} />)}
              </ul>
            </section>
          ))}
          <label className={s.label} htmlFor={`note-${sessionId}`}>General note</label>
          <textarea id={`note-${sessionId}`} className={s.note} rows={4} value={text} placeholder="Anything for the agent…"
            onChange={(e) => setText(e.target.value)} onBlur={() => void saveNote()} />
          {error && <div className={s.error}>{error}</div>}
          <div className={s.actions}>
            <Button variant="primary" size="sm" disabled={sending || (drafts.length === 0 && !text.trim())} onClick={() => void send()}>
              {sending ? (resuming ? 'Resuming…' : 'Sending…') : 'Send'}
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
