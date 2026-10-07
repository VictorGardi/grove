import { useEffect, useRef } from 'react'
import type { DocTarget } from '@shared/types'
import { artifactUrl } from '@shared/artifactUrl'
import type { FileGroup } from '../viewerFiles'
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
        <Button variant="ghost" size="sm" icon={expanded ? 'minimize' : 'maximize'} round
          aria-label={expanded ? 'Collapse viewer' : 'Expand viewer'} onClick={onToggleExpanded} />
        <Button variant="ghost" size="sm" icon="x" round aria-label="Close viewer" onClick={onClose} />
      </div>
      <iframe className={s.frame} sandbox="allow-scripts" src={url} title={target.path} />
    </div>
  )
}
