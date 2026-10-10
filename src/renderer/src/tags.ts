import type { Feature, Project } from '@shared/types'

// Size of the --tag-N palette in tokens.css (and .tN classes in ui/Tag.module.css).
export const TAG_COUNT = 8

// Projects take palette colours by position; each project's group features take the
// colours after it, by slug, so a group differs from its own project's colour. A worktree
// takes no slot of its own — there are eight, and a new worktree must not push the projects
// after it onto a different colour — but it wears its repo's colour, so a repo's checkouts
// read as one thing and its row in the rail still has a bar (ADR 0037).
export function colorTags(projects: Project[], features: Feature[]) {
  const checkouts = projects.filter((p) => !p.worktreeOf)
  const projectIndex = new Map(checkouts.map((p, i) => [p.id, i]))
  const checkoutOf = new Map(projects.flatMap((p) => (p.worktreeOf ? [[p.id, p.worktreeOf] as const] : [])))
  const groups = new Map<string, number>()
  for (const [id, i] of projectIndex) {
    const own = features.filter((f) => f.group && f.projectId === id).sort((a, b) => a.slug.localeCompare(b.slug))
    own.forEach((g, j) => groups.set(id + '/' + g.slug, (i + 1 + j) % TAG_COUNT))
  }
  return {
    // The checkout's own colour, or — for a worktree — the colour of the checkout it hangs
    // under. null when neither is a configured project.
    project: (id: string): number | null => {
      const i = projectIndex.get(id) ?? projectIndex.get(checkoutOf.get(id) ?? '')
      return i === undefined ? null : i % TAG_COUNT
    },
    group: (projectId: string, slug: string | null): number | null =>
      slug === null ? null : groups.get(projectId + '/' + slug) ?? null,
  }
}
