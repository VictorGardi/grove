import { useEffect, useMemo, useRef, useState } from 'react'
import type { DocTarget } from '@shared/types'
import { artifactUrl } from '@shared/artifactUrl'
import { artifactAnchor, draftsForFile, isCommentable, parseIframeMessage, type IframeMessage } from '../artifactComments'
import { useSlices } from '../stores/slices'
import type { FileGroup } from '../viewerFiles'
import { CommentEditor } from './CommentEditor'
import { ReviewMenu } from './ReviewTray'
import { Button } from './ui/Button'
import s from './ArtifactViewer.module.css'

// Opaque sandboxed frame: no allow-same-origin, so the artifact gets a null origin (ADR 0007).
export function ArtifactViewer({ target, groups, mtimeMs, expanded, onOpen, onBack, onToggleExpanded, onReload, onClose }: {
  target: DocTarget
  groups: FileGroup[]
  mtimeMs: number | undefined // the open file's, from the features slice
  expanded: boolean
  onOpen: (path: string) => void
  onBack?: () => void // opened from a diff: "← Diff"
  onToggleExpanded: () => void
  onReload: () => void
  onClose: () => void
}) {
  const url = artifactUrl(target)
  // the same file changed on disk: reload in place (a new target loads through src instead)
  const seen = useRef<{ url: string; mtimeMs: number | undefined }>({ url, mtimeMs })
  useEffect(() => {
    const prev = seen.current
    if (prev.url === url && prev.mtimeMs !== undefined && mtimeMs !== undefined && mtimeMs !== prev.mtimeMs) onReload()
    seen.current = { url, mtimeMs }
  }, [url, mtimeMs, onReload])

  // Commenting on markdown (ADR 0026): messages from the frame's comment script, accepted only from this frame.
  const frame = useRef<HTMLIFrameElement>(null)
  const sessionId = useSlices((x) => x.ui.focusedSessionId)
  const comments = useSlices((x) => x.comments)
  const commentable = isCommentable(target)
  const drafts = useMemo(() => draftsForFile(comments, sessionId, target), [comments, sessionId, target])
  const [editing, setEditing] = useState<{ sel: Extract<IframeMessage, { type: 'select' }> } | { id: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const tell = (msg: object) => frame.current?.contentWindow?.postMessage({ grove: 1, ...msg }, '*')
  const highlights = useMemo(() => drafts.map((c) => c.anchor).flatMap((a, i) => (a.kind === 'artifact'
    ? [{ id: drafts[i].id, exact: a.exact, prefix: a.prefix, suffix: a.suffix }] : [])), [drafts])
  const sync = () => {
    tell({ type: 'config', canComment: sessionId !== null })
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
  }, [commentable, drafts])
  useEffect(() => { if (commentable) syncRef.current() }, [commentable, sessionId, highlights])

  async function save(body: string) {
    if (!editing) return
    const res = 'sel' in editing
      ? await window.api.invoke('comment:add', { sessionId: sessionId!, anchor: artifactAnchor(target as Extract<typeof target, { kind: 'artifact' }>, editing.sel), body })
      : await window.api.invoke('comment:update', { id: editing.id, body })
    if (res.ok) setEditing(null)
    else setError(res.error)
  }
  const editingDraft = editing && 'id' in editing ? drafts.find((c) => c.id === editing.id) : undefined
  const quote = editing && 'sel' in editing ? editing.sel.exact : editingDraft?.anchor.kind === 'artifact' ? editingDraft.anchor.exact : ''

  // a linked sub-path or another folder's file isn't listed: show it, unselectable
  const listed = groups.some((g) => g.files.includes(target.path))
  return (
    <div className={s.viewer}>
      <div className={s.header}>
        {onBack && <Button variant="ghost" size="sm" onClick={onBack}>← Diff</Button>}
        <select className={s.switcher} aria-label="Artifact" value={target.path} onChange={(e) => onOpen(e.target.value)}>
          {!listed && <option value={target.path} disabled>{target.path}</option>}
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.files.map((n) => <option key={n} value={n}>{n}</option>)}
            </optgroup>
          ))}
        </select>
        {sessionId && <ReviewMenu sessionId={sessionId} />}
        <Button variant="ghost" size="sm" icon={expanded ? 'minimize' : 'maximize'} round
          aria-label={expanded ? 'Collapse viewer' : 'Expand viewer'} onClick={onToggleExpanded} />
        <Button variant="ghost" size="sm" icon="x" round aria-label="Close viewer" onClick={onClose} />
      </div>
      <iframe ref={frame} className={s.frame} sandbox="allow-scripts" src={url} title={target.path} />
      {editing && sessionId && (
        <div className={s.editor}>
          <div className={s.quote}>{quote}</div>
          <CommentEditor key={editingDraft?.id ?? 'new'} initial={editingDraft?.body ?? ''} error={error}
            onSave={(b) => void save(b)} onCancel={() => setEditing(null)} />
          {editingDraft && (
            <Button size="sm" variant="ghost" onClick={() => { void window.api.invoke('comment:delete', { id: editingDraft.id }); setEditing(null) }}>Delete</Button>
          )}
        </div>
      )}
    </div>
  )
}
