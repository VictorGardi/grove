import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { DocTarget } from '@shared/types'
import { artifactUrl } from '@shared/artifactUrl'
import { draftsForFile, fileAnchor, ownerArgs, parseIframeMessage, type CommentOwner, type IframeMessage } from '../artifactComments'
import { useSlices } from '../stores/slices'
import { CommentEditor } from './CommentEditor'
import { Button } from './ui/Button'
import s from './ArtifactComments.module.css'

// Commenting on markdown (ADR 0026) in one artifact frame: messages from the frame's comment script,
// accepted only from this frame; the owner's highlights pushed in; and the editor panel to draw under
// the frame. No owner: the frame shows the drafts of no one and offers no commenting. Save & send is
// a session owner's only: a feature's drafts wait until sent.
export function useArtifactComments({ frame, target, owner, commentable }: {
  frame: RefObject<HTMLIFrameElement | null>
  target: DocTarget
  owner: CommentOwner | null
  commentable: boolean
}): { editor: ReactNode | null } {
  const url = artifactUrl(target)
  const comments = useSlices((x) => x.comments)
  // keyed on values, not identities: callers build target and owner fresh each render
  const ownerKey = owner && (owner.kind === 'session' ? 's:' + owner.sessionId : `f:${owner.feature.projectId}/${owner.feature.slug}`)
  // owner and target are read through ownerKey and target.projectId/target.path
  const drafts = useMemo(() => draftsForFile(comments, owner, target),
    [comments, ownerKey, target.projectId, target.path]) // eslint-disable-line react-hooks/exhaustive-deps
  const [editing, setEditing] = useState<{ sel: Extract<IframeMessage, { type: 'select' }> } | { id: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const tell = (msg: object) => frame.current?.contentWindow?.postMessage({ grove: 1, ...msg }, '*')
  const highlights = useMemo(() => drafts.map((c) => c.anchor).flatMap((a, i) => (a.kind === 'file'
    ? [{ id: drafts[i].id, exact: a.exact, prefix: a.prefix, suffix: a.suffix }] : [])), [drafts])
  const sync = () => {
    tell({ type: 'config', canComment: owner !== null })
    tell({ type: 'highlights', items: highlights })
  }
  const syncRef = useRef(sync)
  syncRef.current = sync
  useEffect(() => { setEditing(null); setError(null) }, [url])
  useEffect(() => {
    if (!commentable) return
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return
      const m = parseIframeMessage(e.data)
      if (!m) return
      if (m.type === 'ready') syncRef.current()
      else if (m.type === 'select') { setError(null); setEditing({ sel: m }) }
      else if (drafts.some((c) => c.id === m.id)) { setError(null); setEditing({ id: m.id }) }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [commentable, drafts, frame])
  useEffect(() => { if (commentable) syncRef.current() }, [commentable, ownerKey, highlights])

  async function save(body: string): Promise<boolean> {
    if (!editing || !owner) return false
    const res = 'sel' in editing
      ? await window.api.invoke('comment:add', { ...ownerArgs(owner), anchor: fileAnchor(target, editing.sel), body })
      : await window.api.invoke('comment:update', { id: editing.id, body })
    if (res.ok) setEditing(null)
    else setError(res.error)
    return res.ok
  }
  // Save, then send every draft of the session, like Send in the Comments tray.
  async function saveAndSend(sessionId: string, body: string) {
    if (!(await save(body))) return
    const res = await window.api.invoke('review:send', { sessionId: useSlices.getState().ui.focusedSessionId ?? sessionId })
    if (!res.ok) setError(res.error)
  }
  const editingDraft = editing && 'id' in editing ? drafts.find((c) => c.id === editing.id) : undefined
  const quote = editing && 'sel' in editing ? editing.sel.exact : editingDraft?.anchor.kind === 'file' ? editingDraft.anchor.exact : ''

  const editor = editing && owner ? (
    <div className={s.editor}>
      <div className={s.quote}>{quote}</div>
      <CommentEditor key={editingDraft?.id ?? 'new'} initial={editingDraft?.body ?? ''} error={error}
        onSave={(b) => void save(b)} onCancel={() => setEditing(null)}
        onSend={owner.kind === 'session' ? (b) => void saveAndSend(owner.sessionId, b) : undefined} />
      {editingDraft && (
        <Button size="sm" variant="ghost" onClick={() => { void window.api.invoke('comment:delete', { id: editingDraft.id }); setEditing(null) }}>Delete</Button>
      )}
    </div>
  ) : null
  return { editor }
}
