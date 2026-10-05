import type { Feature, FeatureStage, Session } from '@shared/types'
import type { FolderSnapshot } from '../discovery/folder'
import type { Axis, Predicate, Stage, Workflow } from './parse'

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

function axisValue(axis: Axis, manifest: Record<string, unknown>): string {
  const v = str(manifest[axis.field])
  return v !== null && Object.hasOwn(axis.values, v) ? v : axis.default
}

const allows = (stages: 'all' | string[] | undefined, id: string) => stages === 'all' || (stages ?? []).includes(id)

// Stages in both the kind's and the flow's list, in `stages` order.
export function effectiveStages(wf: Workflow, manifest: Record<string, unknown>): Stage[] {
  const kind = wf.kinds.values[axisValue(wf.kinds, manifest)]
  const flow = wf.flows ? wf.flows.values[axisValue(wf.flows, manifest)] : undefined
  return wf.stages.filter((s) => allows(kind?.stages, s.id) && (!wf.flows || allows(flow?.stages, s.id)))
}

export function isComplete(p: Predicate, folder: FolderSnapshot, artifact: string): boolean {
  if ('all_checked' in p) {
    const body = folder.artifacts[p.all_checked]?.body
    return body !== undefined && /^\s*- \[x\]/im.test(body) && !/^\s*- \[ \]/m.test(body)
  }
  const parsed = folder.artifacts[artifact]
  if (!parsed) return false
  if ('exists' in p) return true
  if ('equals' in p) return parsed.data[p.field] === p.equals
  return p.in.includes(parsed.data[p.field])
}

function title(folder: FolderSnapshot): string {
  const h = folder.manifest.body.split('\n').find((l) => l.startsWith('# '))
  return h ? h.slice(2).trim() : folder.slug
}

export function deriveFeatures(
  wf: Workflow,
  folders: (FolderSnapshot & { projectId: string })[],
  _sessions: Session[]
): Feature[] {
  return folders
    .map((f): Feature => {
      const m = f.manifest.data
      const kind = axisValue(wf.kinds, m)
      const done = effectiveStages(wf, m).map((s) => ({ s, complete: isComplete(s.complete_when, f, s.artifact) }))
      const current = done.findIndex((d) => !d.complete)
      const stages = done.map(({ s }, i): FeatureStage => ({
        id: s.id,
        label: s.label,
        artifact: s.artifact,
        review: s.review ?? null,
        state: current < 0 || i < current ? 'complete' : i === current ? 'current' : 'upcoming',
      }))
      return {
        projectId: f.projectId,
        slug: f.slug,
        path: f.path,
        title: title(f),
        kind,
        group: wf.kinds.values[kind]?.group === true,
        parent: wf.kinds.parent_field ? str(m[wf.kinds.parent_field]) : null,
        flow: wf.flows ? str(m[wf.flows.field]) : null,
        stages,
        currentStage: current < 0 ? null : stages[current].id,
      }
    })
    .sort((a, b) => a.projectId.localeCompare(b.projectId) || a.slug.localeCompare(b.slug))
}
