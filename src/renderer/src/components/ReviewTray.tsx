import { useEffect, useRef, useState, type ReactNode } from 'react'
import { linkedDrafts, repoFeatureDrafts } from '@shared/comments'
import type { Comment, FeatureKey, Project, Session, SessionKind } from '@shared/types'
import { groupForTray } from '../reviewView'
import { defaultKind, resolveTarget } from '../sendTarget'
import { useSlices } from '../stores/slices'
import { CommentEditor } from './CommentEditor'
import { SendTargetChip } from './SendTargetChip'
import { Button } from './ui/Button'
import s from './ReviewTray.module.css'

const SEND_ERRORS: Record<string, string> = {
  empty: 'Nothing to send',
  'not-ready': 'The session did not become ready. Try again.',
  gone: 'This session has ended and cannot be resumed.',
  busy: 'A send is already running.',
  'bad-kind': 'A terminal cannot take comments. Pick an agent.',
  'not-found': 'This session no longer exists.',
  'no-feature': 'This feature is no longer listed.',
}

const SENDING_LABEL = { send: 'Sending…', resume: 'Resuming…', start: 'Starting…' } as const

const sentAt = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '')

const lineLabel = (c: Comment) => {
  const a = c.anchor
  if (a.kind === 'note') return ''
  return `L${a.start === a.end ? a.start : `${a.start}-${a.end}`}${a.kind === 'diff' && a.side === 'old' ? ' (removed)' : ''}`
}

// One draft in the tray: where it is, its quote, its body; Edit and Delete. A click on the quote opens the diff or the artifact.
// marked: tag a draft kept on the feature rather than the session.
function TrayItem({ comment, marked, onJump }: { comment: Comment; marked: boolean; onJump: () => void }) {
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
        {marked && comment.sessionId === null && <span className={s.kept}>on the feature</span>}
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

// The Comments (n) button and its popover; Escape or a click outside closes it.
function TrayPopover({ count, children }: { count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
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
  return (
    <div ref={root} className={s.root}>
      <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
        Comments ({count})
      </Button>
      {open && <div className={s.panel} role="dialog" aria-label="Comments">{children}</div>}
    </div>
  )
}

// The drafts with a place, grouped by file.
function TrayGroups({ drafts, marked = false, onJump }: { drafts: Comment[]; marked?: boolean; onJump: (c: Comment) => void }) {
  const projects = useSlices((x) => x.projects)
  return <>{groupForTray(drafts, projects).map((g) => (
    <section key={g.id} className={s.group}>
      <div className={s.groupLabel}>{g.label}</div>
      <ul className={s.items}>
        {g.comments.map((c) => <TrayItem key={c.id} comment={c} marked={marked} onJump={() => onJump(c)} />)}
      </ul>
    </section>
  ))}</>
}

// Comments (n) in the diff and artifact viewers' headers: its tray of drafts, a general note, Send, and the Sent list.
// The tray lists the session's own drafts and those kept on its feature (design D3); Send sends them all.
// SAVE uses the session whose content is being viewed (sessionId prop); SEND uses focusedSessionId.
export function ReviewMenu({ sessionId }: { sessionId: string }) {
  const all = useSlices((x) => x.comments)
  const projects = useSlices((x) => x.projects)
  const session = useSlices((x) => x.sessions.find((v) => v.id === sessionId))
  const comments = all.filter((c) => c.sessionId === sessionId)
  const drafts = comments.filter((c) => c.state === 'draft')
  const listed = session ? linkedDrafts(all, session, projects) : drafts
  const sent = comments.filter((c) => c.state === 'sent').sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))
  const openDiff = useSlices((x) => x.openDiff)
  const openArtifact = useSlices((x) => x.openArtifact)
  const note = drafts.find((c) => c.anchor.kind === 'note')
  const focusedSessionId = useSlices((x) => x.ui.focusedSessionId)
  const [text, setText] = useState(note?.body ?? '')
  const [sending, setSending] = useState(false)
  const [resuming, setResuming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // follow the stored note when it changes elsewhere (sent, deleted)
  useEffect(() => setText(note?.body ?? ''), [note?.id, note?.body])

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
    <TrayPopover count={listed.length}>
      <TrayGroups drafts={listed} marked onJump={(c) => (c.anchor.kind === 'file'
        ? openArtifact({ kind: 'file', projectId: c.anchor.projectId, path: c.anchor.path, hash: null, fromDiff: null })
        : openDiff(sessionId))} />
      <label className={s.label} htmlFor={`note-${sessionId}`}>General note</label>
      <textarea id={`note-${sessionId}`} className={s.note} rows={4} value={text} placeholder="Anything for the agent…"
        onChange={(e) => setText(e.target.value)} onBlur={() => void saveNote()} />
      {error && <div className={s.error}>{error}</div>}
      <div className={s.actions}>
        <Button variant="primary" size="sm" disabled={sending || (listed.length === 0 && !text.trim())} onClick={() => void send()}>
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
    </TrayPopover>
  )
}

// Comments (n) on an artifact's full page, with no session: the drafts kept on the feature in any checkout
// of its repo, to edit, delete or send. No general note (a note is a session's).
export function FeatureReviewMenu({ feature, onJump }: { feature: FeatureKey; onJump: (c: Comment) => void }) {
  const projects = useSlices((x) => x.projects)
  const sessions = useSlices((x) => x.sessions)
  const drafts = repoFeatureDrafts(useSlices((x) => x.comments), feature, projects)
  return (
    <TrayPopover count={drafts.length}>
      <FeatureReviewPanel feature={feature} drafts={drafts} sessions={sessions} projects={projects} onJump={onJump} />
    </TrayPopover>
  )
}

// The popover's body: the drafts, where Send goes (D4), and Send. Sending leaves focus on the full page.
export function FeatureReviewPanel({ feature, drafts, sessions, projects, onJump }: {
  feature: FeatureKey; drafts: Comment[]; sessions: Session[]; projects: Project[]; onJump: (c: Comment) => void
}) {
  const target = resolveTarget(feature, sessions, projects)
  // a session the human picked, or a new session of a kind; null: the default
  const [pick, setPick] = useState<{ session: string } | { kind: SessionKind } | null>(null)
  // the mode Send ran in, fixed at the click so its label holds while it runs; null: idle
  const [sending, setSending] = useState<'send' | 'resume' | 'start' | null>(null)
  const [error, setError] = useState<string | null>(null)
  // a picked session that can no longer take it falls back to the default
  const chosen = pick && 'session' in pick ? [...target.candidates, ...target.others].find((c) => c.id === pick.session) : undefined
  const picked = chosen ?? target.default // a kind is only offered when no session is linked, so no default to override
  const startKind = pick && 'kind' in pick ? pick.kind : defaultKind(sessions, projects, feature.projectId)
  const resuming = picked?.lastStatus === 'gone'

  async function send() {
    setError(null)
    setSending(picked ? (resuming ? 'resume' : 'send') : 'start')
    try {
      if (picked) {
        // the feature goes with it, so an unlinked session gets this feature's drafts too
        const res = await window.api.invoke('review:send', { sessionId: picked.id, feature })
        if (!res.ok) setError(SEND_ERRORS[res.error] ?? res.error)
      } else {
        const res = await window.api.invoke('review:start-and-send', { feature, kind: startKind, cols: 120, rows: 40 })
        // here a missing target is the feature, not a session
        if (!res.ok) setError(res.error === 'not-found' ? 'This feature is no longer listed.' : SEND_ERRORS[res.error] ?? res.error)
      }
    } finally {
      setSending(null)
    }
  }

  return (
    <>
      <TrayGroups drafts={drafts} onJump={onJump} />
      <div className={s.hint}>Comments are kept on this feature until they are sent to a session.</div>
      <SendTargetChip target={target} picked={picked} onPick={(id) => setPick({ session: id })} kind={startKind} onKind={(k) => setPick({ kind: k })} />
      {error && <div className={s.error}>{error}</div>}
      <div className={s.actions}>
        <Button variant="primary" size="sm" disabled={!!sending || drafts.length === 0} onClick={() => void send()}>
          {sending ? SENDING_LABEL[sending] : picked ? 'Send' : 'Start a session and send'}
        </Button>
      </div>
    </>
  )
}
