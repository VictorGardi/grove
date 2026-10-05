import { isViewable } from '@shared/artifactUrl'
import type { Feature } from '@shared/types'

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
