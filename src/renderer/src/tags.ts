import type { Feature, Project } from '@shared/types'

// Size of the --tag-N palette in tokens.css (and .tN classes in ui/Tag.module.css).
export const TAG_COUNT = 8

// Projects take palette colours by position; each project's group features take the
// colours after it, by slug, so a group differs from its own project's colour.
export function colorTags(projects: Project[], features: Feature[]) {
  const projectIndex = new Map(projects.map((p, i) => [p.id, i]))
  const groups = new Map<string, number>()
  for (const [id, i] of projectIndex) {
    const own = features.filter((f) => f.group && f.projectId === id).sort((a, b) => a.slug.localeCompare(b.slug))
    own.forEach((g, j) => groups.set(id + '/' + g.slug, (i + 1 + j) % TAG_COUNT))
  }
  return {
    project: (id: string): number | null => {
      const i = projectIndex.get(id)
      return i === undefined ? null : i % TAG_COUNT
    },
    group: (projectId: string, slug: string | null): number | null =>
      slug === null ? null : groups.get(projectId + '/' + slug) ?? null,
  }
}
