// Case-insensitive subsequence match for the command palette (design D4).
// Bonuses: start of text, start of a word, and consecutive runs; a small penalty for each skipped letter.
const isBoundary = (c: string) => ' /-_.:'.includes(c)

export function fuzzy(query: string, text: string): { score: number; indices: number[] } | null {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  const indices: number[] = []
  let score = 0
  let from = 0
  for (const ch of q) {
    const at = t.indexOf(ch, from)
    if (at < 0) return null
    const prev = indices[indices.length - 1]
    score += 1
    if (at === 0) score += 8
    else if (isBoundary(t[at - 1])) score += 5
    if (prev !== undefined && at === prev + 1) score += 4
    else if (prev !== undefined) score -= Math.min(at - prev - 1, 3) * 0.5
    indices.push(at)
    from = at + 1
  }
  return { score, indices }
}
