import { isViewable } from '@shared/artifactUrl'
import type { DocTarget, Feature, Project } from '@shared/types'

export type FileGroup = { label: string; files: string[] }

// The viewer's switcher: stage-tagged files by stage in workflow order, then "Other"; no empty groups.
export function viewableFiles(f: Feature, stages: { id: string; label: string }[]): FileGroup[] {
  const files = f.artifacts.filter((a) => isViewable(a.name))
  const known = (stage: string | null) => stages.some((st) => st.id === stage)
  return [
    ...stages.map((st) => ({ label: st.label, files: files.filter((a) => a.stage === st.id).map((a) => a.name) })),
    { label: 'Other', files: files.filter((a) => !known(a.stage)).map((a) => a.name) },
  ].filter((g) => g.files.length > 0)
}

// Open review: the current stage's review file, else its artifact; null when neither exists or the feature is done.
export function reviewTarget(f: Feature): string | null {
  const st = f.stages.find((s) => s.id === f.currentStage)
  if (!st) return null
  const has = (n: string) => f.artifacts.some((a) => a.name === n)
  return st.review && has(st.review) ? st.review : has(st.artifact) ? st.artifact : null
}

// The feature whose folder holds the open file, with that folder's project-relative path and trailing '/'.
// Strings only: shared code is compiled for the renderer too, so no node:path.
export function featureOfFile(t: DocTarget, features: Feature[], projects: Project[]): { feature: Feature; dir: string } | undefined {
  const project = projects.find((p) => p.id === t.projectId)
  if (!project) return undefined
  const base = project.path.replace(/\/+$/, '') + '/'
  let best: { feature: Feature; dir: string } | undefined
  for (const f of features) {
    if (f.projectId !== t.projectId || !f.path.startsWith(base)) continue
    const dir = f.path.slice(base.length).replace(/\/+$/, '') + '/'
    if (t.path.startsWith(dir) && (!best || dir.length > best.dir.length)) best = { feature: f, dir }
  }
  return best
}

export const featureDir = (f: Feature, projects: Project[]): string | null => {
  const base = projects.find((p) => p.id === f.projectId)?.path.replace(/\/+$/, '') + '/'
  return f.path.startsWith(base) ? f.path.slice(base.length).replace(/\/+$/, '') + '/' : null
}
