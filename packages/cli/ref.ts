import { spaceHeadings } from './output.ts'

export type RefResult = { ok: true; id: string } | { ok: false; error: 'ambiguous' | 'not-found' }

const MIN_PREFIX = 4

// A tab by full id, a unique id prefix (≥ 4 chars), or an exact label.
export function resolveTabRef(tabs: { id: string; label: string | null }[], ref: string): RefResult {
  const exact = tabs.find((tab) => tab.id === ref)
  if (exact) return { ok: true, id: exact.id }
  const pick = (found: { id: string }[]): RefResult | null =>
    found.length === 1 ? { ok: true, id: found[0].id } : found.length > 1 ? { ok: false, error: 'ambiguous' } : null
  const byPrefix = ref.length >= MIN_PREFIX ? pick(tabs.filter((tab) => tab.id.startsWith(ref))) : null
  return byPrefix ?? pick(tabs.filter((tab) => tab.label === ref)) ?? { ok: false, error: 'not-found' }
}

// A space by full id, a unique id prefix (≥ 4 chars), or the heading `ls` shows for it (`path`, or `path#2` for a second space at one folder).
export function resolveSpaceRef(spaces: { id: string; path: string }[], ref: string): RefResult {
  const pick = (found: { id: string }[]): RefResult | null =>
    found.length === 1 ? { ok: true, id: found[0].id } : found.length > 1 ? { ok: false, error: 'ambiguous' } : null
  const exact = spaces.find((space) => space.id === ref)
  if (exact) return { ok: true, id: exact.id }
  const headings = spaceHeadings(spaces)
  const byHeading = pick(spaces.filter((space) => headings.get(space.id) === ref))
  return byHeading ?? (ref.length >= MIN_PREFIX ? pick(spaces.filter((space) => space.id.startsWith(ref))) : null) ?? { ok: false, error: 'not-found' }
}
