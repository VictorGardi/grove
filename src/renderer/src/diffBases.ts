export const MAX_RECENT_BASES = 5

export interface BaseRefs { branches: string[]; current: string | null; default: string | null }
export interface BaseChoice { ref: string | null; name: string; kind: 'default' | 'recent' | 'match' } // ref null: the auto-detected default branch

// The branches a project's diff was recently compared against, newest first, after picking `base`.
export function pushRecentBase(recents: string[] | undefined, base: string): string[] {
  return [base, ...(recents ?? []).filter((r) => r !== base)].slice(0, MAX_RECENT_BASES)
}

// What the picker lists. No query: the default branch, then recents that still exist (never the current branch, no duplicates).
// A query: the default if it matches, then every local or remote branch whose name contains it, case-insensitively, minus the current branch.
export function baseChoices(refs: BaseRefs, recents: string[] | undefined, query: string): BaseChoice[] {
  const def: BaseChoice[] = refs.default ? [{ ref: null, name: refs.default, kind: 'default' }] : []
  const q = query.trim().toLowerCase()
  if (!q) {
    const out: BaseChoice[] = [...def]
    for (const r of recents ?? []) {
      if (r === refs.current || r === refs.default || !refs.branches.includes(r) || out.some((c) => c.ref === r)) continue
      out.push({ ref: r, name: r, kind: 'recent' })
      if (out.length - def.length === MAX_RECENT_BASES) break
    }
    return out
  }
  const matches = refs.branches
    .filter((b) => b !== refs.current && b !== refs.default && b !== `origin/${refs.default}` && b.toLowerCase().includes(q))
    .map((b): BaseChoice => ({ ref: b, name: b, kind: 'match' }))
  return [...def.filter((c) => c.name.toLowerCase().includes(q)), ...matches]
}
