// The launch picker's ranking. Subsequence matching is what every branch picker does (VS Code's
// fuzzyScorer, Zed's Nucleo): `fhl` finds `fix-header-layout`, because a branch name is a name you
// already half-know, not a value you scroll to. A prefix beats scattered characters, so `gro` means
// grove rather than every branch that happens to contain g-r-o in order.
export function score(query: string, text: string): number | null {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let at = 0
  let hits = 0
  let streak = 0
  for (const ch of q) {
    const found = t.indexOf(ch, at)
    if (found < 0) return null
    streak = found === at && at > 0 ? streak + 1 : 0
    hits += streak
    at = found + 1
  }
  return (t.startsWith(q) ? 100 : 0) + hits + (t === q ? 200 : 0)
}