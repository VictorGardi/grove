import type { ViewerTarget } from '@shared/types'
import { artifactUrl } from '@shared/artifactUrl'
import { Button } from './ui/Button'
import s from './ArtifactViewer.module.css'

// Opaque sandboxed frame: no allow-same-origin, so the artifact gets a null origin (ADR 0007).
export function ArtifactViewer({ target, onClose }: { target: ViewerTarget; onClose: () => void }) {
  return (
    <div className={s.viewer}>
      <div className={s.header}>
        <span className={s.title}>{target.path}</span>
        <Button variant="ghost" size="sm" icon="x" round aria-label="Close viewer" onClick={onClose} />
      </div>
      <iframe className={s.frame} sandbox="allow-scripts" src={artifactUrl(target)} title={target.path} />
    </div>
  )
}
