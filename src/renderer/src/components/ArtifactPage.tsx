import { useEffect, useRef } from 'react'
import { artifactUrl } from '@shared/artifactUrl'
import type { ArtifactRef } from '@shared/types'
import { stepKey, type ArtifactCard } from '../artifactsBoard'
import { Button } from './ui/Button'
import s from './ArtifactPage.module.css'

interface Props {
  projectId: string
  card: ArtifactCard
  prev: ArtifactRef | null // the artifacts either side in board order, filter applied; null at an end
  next: ArtifactRef | null
  index: number // of card among the board's cards, from 0
  total: number
  onBack(): void
  onStep(ref: ArtifactRef): void
}

// One artifact full page, in place of the board. Same opaque sandboxed frame as the viewer (ADR 0007);
// keyed on the file's mtime so it reloads when an agent rewrites it. Previous and next, or the arrow
// keys, walk the board's cards; keys pressed inside the frame stay there.
export function ArtifactPage({ projectId, card, prev, next, index, total, onBack, onStep }: Props) {
  const url = artifactUrl({ kind: 'file', projectId, path: card.path, hash: null, fromDiff: null })

  const nav = useRef({ prev, next, onStep })
  nav.current = { prev, next, onStep }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return // an open menu or picker, or an IME, took the key
      if (document.querySelector('[role="dialog"]')) return // a modal over the page owns the keys
      const { prev, next, onStep } = nav.current
      const dir = stepKey(e)
      const to = dir === -1 ? prev : dir === 1 ? next : null
      if (!to) return
      e.preventDefault()
      onStep(to)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, []) // attached once: prev, next and onStep read the ref

  return (
    <div className={s.page}>
      <div className={s.header}>
        <Button variant="ghost" size="sm" onClick={onBack}>← Back</Button>
        <span className={s.name}>{card.name}</span>
        <div className={s.step}>
          <Button variant="ghost" size="sm" aria-label="Previous artifact" disabled={!prev} onClick={() => prev && onStep(prev)}>Previous</Button>
          {index >= 0 && <span className={s.position}>{index + 1} of {total}</span>}
          <Button variant="ghost" size="sm" aria-label="Next artifact" disabled={!next} onClick={() => next && onStep(next)}>Next</Button>
        </div>
      </div>
      <iframe key={url + card.mtimeMs} className={s.frame} sandbox="allow-scripts" src={url} title={card.path} />
    </div>
  )
}
