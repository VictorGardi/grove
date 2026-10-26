import { memo, useCallback } from 'react'
import { modifiedAgo, previewKind, previewSrc, type ArtifactCard as Card } from '../artifactsBoard'
import s from './ArtifactCard.module.css'

interface Props {
  id: string        // the board's key for this card, handed back to onOpen and register
  projectId: string
  card: Card
  stage: string     // the stage's label
  live: boolean     // mount the real preview; otherwise a title card (design D2)
  now: number
  onOpen(id: string): void
  register(id: string, el: HTMLButtonElement | null): void // the board measures where the card sits
}

// One card on the artifacts board: the file itself scaled down, or its name when far off or zoomed out.
// The preview is the full page's opaque sandboxed frame (ADR 0007), inert here: the card takes the click
// and the board the drag. A page remounts on its mtime; an image's src carries it (see previewSrc).
// Memoised with stable callbacks from the board, so a pan re-renders only cards whose live flag flips.
export const ArtifactCard = memo(function ArtifactCard({ id, projectId, card, stage, live, now, onOpen, register }: Props) {
  const ref = useCallback((el: HTMLButtonElement | null) => register(id, el), [register, id])
  const src = previewSrc(projectId, card)
  return (
    <button type="button" className={s.card} ref={ref} onClick={() => onOpen(id)}>
      <span className={s.preview} inert>
        {!live ? <span className={s.title}>{card.name}</span>
          : previewKind(card.path) === 'image'
            ? <img className={s.image} src={src} alt="" draggable={false} />
            : <iframe key={src + card.mtimeMs} className={s.frame} sandbox="allow-scripts" src={src} title={card.path} />}
      </span>
      <span className={s.meta}>
        <span className={s.stage}>{stage}</span>
        <span className={s.name}>{card.name}</span>
        <span className={s.time}>{modifiedAgo(card.mtimeMs, now)}</span>
      </span>
    </button>
  )
})
