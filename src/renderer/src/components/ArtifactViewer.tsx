import { useEffect, useRef } from 'react'
import type { DocTarget } from '@shared/types'
import { artifactUrl } from '@shared/artifactUrl'
import { isCommentable } from '../artifactComments'
import { useSlices } from '../stores/slices'
import type { FileGroup } from '../viewerFiles'
import { useArtifactComments } from './ArtifactComments'
import { ReviewMenu } from './ReviewTray'
import { Button } from './ui/Button'
import s from './ArtifactViewer.module.css'

// Opaque sandboxed frame: no allow-same-origin, so the artifact gets a null origin (ADR 0007).
export function ArtifactViewer({ target, dir, groups, mtimeMs, expanded, onOpen, onBack, onToggleExpanded, onReload, onClose }: {
  target: DocTarget
  dir: string // the feature folder's project-relative path with a trailing '/', or '' (groups list names inside it)
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

  // Commenting on markdown (ADR 0026), for the session whose diff opened it or the focused one.
  const frame = useRef<HTMLIFrameElement>(null)
  const focusedSessionId = useSlices((x) => x.ui.focusedSessionId)
  const sessionId = target.fromDiff ?? focusedSessionId
  const { editor } = useArtifactComments({ frame, target, owner: sessionId ? { kind: 'session', sessionId } : null, commentable: isCommentable(target) })

  // a file outside the feature's folder isn't listed: show it, unselectable
  const listed = groups.some((g) => g.files.some((n) => dir + n === target.path))
  return (
    <div className={s.viewer}>
      <div className={s.header}>
        {onBack && <Button variant="ghost" size="sm" onClick={onBack}>← Diff</Button>}
        <select className={s.switcher} aria-label="Artifact" value={target.path} onChange={(e) => onOpen(e.target.value)}>
          {!listed && <option value={target.path} disabled>{target.path}</option>}
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.files.map((n) => <option key={n} value={dir + n}>{n}</option>)}
            </optgroup>
          ))}
        </select>
        {sessionId && <ReviewMenu sessionId={sessionId} />}
        <Button variant="ghost" size="sm" icon={expanded ? 'minimize' : 'maximize'} round
          aria-label={expanded ? 'Collapse viewer' : 'Expand viewer'} onClick={onToggleExpanded} />
        <Button variant="ghost" size="sm" icon="x" round aria-label="Close viewer" onClick={onClose} />
      </div>
      <iframe ref={frame} className={s.frame} sandbox="allow-scripts" src={url} title={target.path} />
      {editor}
    </div>
  )
}
