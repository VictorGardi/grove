import type { Feature } from '@shared/types'
import type { RepoGroup } from './repoGroups'

// One feature, as each of a repo's checkouts found it (design D3). A drawing value: which
// checkout, and the copy it holds. Never stored, and not a field on Project — a worktree is its
// own Project (ADR 0037), and this says nothing about how grove models that.
export interface Checkout { projectId: string; name: string; feature: Feature }

// A card's feature, with the rest of its copies behind it. It *is* the canonical Feature, so
// everything downstream that takes a Feature takes this unchanged; `headId` is the repo's
// checkout, for the places that count a repo rather than the copy in front of them.
export interface UnionFeature extends Feature {
  copies: Checkout[]   // every checkout's copy, in the order the features arrived
  headId: string       // the repo's checkout: the board counts its sessions, the palette names it
}

// Core discovers features once per checkout and stamps each with that checkout's id, so the
// copies of one feature arrive as separate records (ADR 0037). The renderer collapses them:
// identity is (repo, slug), the checkout's copy is canonical so the board stays put while agents
// write, and flags are unioned across copies. A feature only a worktree has stands on that
// copy — it must not vanish from the repo's board, and `projectId` stays that checkout's so its
// artifacts and its "open" still point at files that exist.
export function unionFeatures(features: Feature[], groups: RepoGroup[]): UnionFeature[] {
  return groups.flatMap(({ project, worktrees }) => {
    const checkouts = [project, ...worktrees]
    const nameOf = new Map(checkouts.map((c) => [c.id, c.name]))
    const bySlug = new Map<string, Feature[]>()
    for (const f of features) {
      if (!checkouts.some((c) => c.id === f.projectId)) continue
      bySlug.set(f.slug, [...(bySlug.get(f.slug) ?? []), f])
    }
    return [...bySlug.values()].map((copies) => {
      const canonical = copies.find((c) => c.projectId === project.id) ?? copies[0]
      return {
        ...canonical,
        flags: flagsOf(copies),
        headId: project.id,
        copies: copies.map((c) => ({ projectId: c.projectId, name: nameOf.get(c.projectId)!, feature: c })),
      }
    })
  })
}

function flagsOf(copies: Feature[]): Feature['flags'] {
  const seen = new Map<string, Feature['flags'][number]>()
  for (const c of copies) for (const fl of c.flags) if (!seen.has(fl.id)) seen.set(fl.id, fl)
  return [...seen.values()]
}

// The copies that have moved on: a chip on the canonical card, opening that copy (design D3). A
// copy still at the canonical's stage has said nothing the card does not already show.
export function divergentCopies(feature: UnionFeature): Checkout[] {
  return feature.copies.filter((c) => c.projectId !== feature.projectId && c.feature.currentStage !== feature.currentStage)
}