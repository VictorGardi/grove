import type { ViewerTarget } from '@shared/types'
import { artifactUrl } from '@shared/artifactUrl'
import type { FileGroup } from '../viewerFiles'
import { Button } from './ui/Button'
import s from './ArtifactViewer.module.css'

// Opaque sandboxed frame: no allow-same-origin, so the artifact gets a null origin (ADR 0007).
export function ArtifactViewer({ target, groups, onOpen, onClose }: {
  target: ViewerTarget
  groups: FileGroup[]
  onOpen: (path: string) => void
  onClose: () => void
}) {
  // a linked sub-path or another folder's file isn't listed: show it, unselectable
  const listed = groups.some((g) => g.files.includes(target.path))
  return (
    <div className={s.viewer}>
      <div className={s.header}>
        <select className={s.switcher} aria-label="Artifact" value={target.path} onChange={(e) => onOpen(e.target.value)}>
          {!listed && <option value={target.path} disabled>{target.path}</option>}
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.files.map((n) => <option key={n} value={n}>{n}</option>)}
            </optgroup>
          ))}
        </select>
        <Button variant="ghost" size="sm" icon="x" round aria-label="Close viewer" onClick={onClose} />
      </div>
      <iframe className={s.frame} sandbox="allow-scripts" src={artifactUrl(target)} title={target.path} />
    </div>
  )
}
