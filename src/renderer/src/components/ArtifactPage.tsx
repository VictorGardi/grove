import { useEffect, useMemo, useRef, useState } from 'react'
import { artifactUrl } from '@shared/artifactUrl'
import type { ArtifactRef, DocTarget, FeatureKey } from '@shared/types'
import { isCommentable } from '../artifactComments'
import { commentCard, stepKey, type ArtifactCard } from '../artifactsBoard'
import { useArtifactComments } from './ArtifactComments'
import { FeatureReviewMenu } from './ReviewTray'
import { Button } from './ui/Button'
import s from './ArtifactPage.module.css'

interface Props {
  projectId: string
  feature: FeatureKey // the open card's feature: its comments are kept here, no session needed (design D3)
  cards: ArtifactCard[] // that feature's cards, to find where a comment is
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
// keys, walk the board's cards; keys pressed inside the frame stay there. A card with an html face can
// show its markdown instead, which is the one to comment on; comments go on the feature.
export function ArtifactPage({ projectId, feature, cards, card, prev, next, index, total, onBack, onStep }: Props) {
  // the card showing its markdown, by its path: stepping to another card shows that one's face again
  const [markdownOf, setMarkdownOf] = useState<string | null>(null)
  const source = markdownOf === card.path ? card.source : null
  const shown = source ?? card
  const target = useMemo<DocTarget>(() => ({ kind: 'file', projectId, path: shown.path, hash: null, fromDiff: null }), [projectId, shown.path])
  const url = artifactUrl(target)

  const frame = useRef<HTMLIFrameElement>(null)
  const { editor } = useArtifactComments({ frame, target, owner: { kind: 'feature', feature }, commentable: isCommentable(target) })

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
        {card.source && (
          <Button variant="ghost" size="sm" aria-pressed={source !== null}
            onClick={() => setMarkdownOf(source ? null : card.path)}>Markdown</Button>
        )}
        <div className={s.step}>
          <Button variant="ghost" size="sm" aria-label="Previous artifact" disabled={!prev} onClick={() => prev && onStep(prev)}>Previous</Button>
          {index >= 0 && <span className={s.position}>{index + 1} of {total}</span>}
          <Button variant="ghost" size="sm" aria-label="Next artifact" disabled={!next} onClick={() => next && onStep(next)}>Next</Button>
        </div>
        <FeatureReviewMenu feature={feature} onJump={(c) => {
          const hit = c.anchor.kind === 'file' ? commentCard(cards, feature, c.anchor) : null
          if (!hit) return
          setMarkdownOf(hit.markdown ? hit.card.path : null)
          onStep(hit.ref)
        }} />
      </div>
      <iframe ref={frame} key={url + shown.mtimeMs} className={s.frame} sandbox="allow-scripts" src={url} title={shown.path} />
      {editor}
    </div>
  )
}
