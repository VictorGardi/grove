import type { CardState, Feature, FeatureStage, Session } from '@shared/types'
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

// `<name>?` when the manifest names a value the axis doesn't define.
function axisWarning(axis: Axis, manifest: Record<string, unknown>, name: string): string[] {
  const v = str(manifest[axis.field])
  return v !== null && !Object.hasOwn(axis.values, v) ? [name + '?'] : []
}

export function deriveFeatures(
  wf: Workflow,
  folders: (FolderSnapshot & { projectId: string })[],
  sessions: Session[]
): Feature[] {
  return withGroups(folders
    .map((f): Feature => {
      const m = f.manifest.data
      const kind = axisValue(wf.kinds, m)
      const eff = effectiveStages(wf, m)
      const exists = (s: Stage) => Object.hasOwn(f.artifacts, s.artifact)
      // complete, else passed ("unapproved") if a later effective stage's artifact exists
      const states = eff.map((s, i) =>
        isComplete(s.complete_when, f, s.artifact) ? 'complete' : eff.slice(i + 1).some(exists) ? 'unapproved' : null)
      const current = states.indexOf(null)
      const stages = eff.map((s, i): FeatureStage => ({
        id: s.id,
        label: s.label,
        artifact: s.artifact,
        review: s.review ?? null,
        state: states[i] ?? (i === current ? 'current' : 'upcoming'),
      }))
      const running = sessions.some((s) => s.projectId === f.projectId && s.feature === f.slug && s.lastStatus === 'running')
      const cardState: CardState =
        current < 0 ? 'done' : running ? 'running'
          : !eff.some(exists) ? 'backlog' : exists(eff[current]) ? 'needs-review' : 'ready'
      const tagged = (name: string) => {
        const a = eff.find((s) => s.artifact === name)
        if (a) return { stage: a.id, role: 'artifact' as const }
        const r = eff.find((s) => s.review === name)
        return r ? { stage: r.id, role: 'review' as const } : { stage: null, role: null }
      }
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
        cardState,
        flags: wf.flags.filter((fl) => eff.some((s) => isComplete(fl.when, f, s.artifact))).map(({ id, label }) => ({ id, label })),
        warnings: [
          ...(wf.flows ? axisWarning(wf.flows, m, 'flow') : []),
          ...axisWarning(wf.kinds, m, 'kind'),
          ...(f.manifest.error ? [`frontmatter?: ${wf.discovery.manifest}`] : []),
          ...Object.keys(f.artifacts).sort().filter((n) => f.artifacts[n].error).map((n) => `frontmatter?: ${n}`),
        ],
        artifacts: f.files.map((name) => ({ name, ...tagged(name) })),
        progress: null,
      }
    }))
    .sort((a, b) => a.projectId.localeCompare(b.projectId) || a.slug.localeCompare(b.slug))
}

// A group is done only when its own stages are and every child (same project, by
// `parent`) is done; until then, with its own stages complete, it is `active`.
function withGroups(features: Feature[]): Feature[] {
  const memo = new Map<Feature, Feature>()
  const resolve = (f: Feature, seen: Set<Feature>): Feature => {
    const hit = memo.get(f)
    if (hit) return hit
    const kids = f.group ? features.filter((c) => c !== f && c.projectId === f.projectId && c.parent === f.slug) : []
    let out = f
    if (kids.length > 0 && !seen.has(f)) {
      const next = new Set(seen).add(f)
      const done = kids.filter((c) => resolve(c, next).cardState === 'done').length
      const cardState = f.cardState === 'done' && done < kids.length ? 'active' : f.cardState
      out = { ...f, cardState, progress: { done, total: kids.length } }
    }
    memo.set(f, out)
    return out
  }
  return features.map((f) => resolve(f, new Set()))
}
