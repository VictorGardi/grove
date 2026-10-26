import { artifactUrl } from '@shared/artifactUrl'
import type { ArtifactCard } from '../artifactsBoard'
import { Button } from './ui/Button'
import s from './ArtifactPage.module.css'

// One artifact full page, in place of the board. Same opaque sandboxed frame as the viewer (ADR 0007);
// keyed on the file's mtime so it reloads when an agent rewrites it.
export function ArtifactPage({ projectId, card, onBack }: { projectId: string; card: ArtifactCard; onBack(): void }) {
  const url = artifactUrl({ kind: 'file', projectId, path: card.path, hash: null, fromDiff: null })
  return (
    <div className={s.page}>
      <div className={s.header}>
        <Button variant="ghost" size="sm" onClick={onBack}>← Back</Button>
        <span className={s.name}>{card.name}</span>
      </div>
      <iframe key={url + card.mtimeMs} className={s.frame} sandbox="allow-scripts" src={url} title={card.path} />
    </div>
  )
}
