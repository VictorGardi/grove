import YAML from 'yaml'

export type Predicate =
  | { exists: true }
  | { field: string; equals: unknown }
  | { field: string; in: unknown[] }
  | { all_checked: string }

export interface Stage {
  id: string
  label: string
  artifact: string
  review?: string
  complete_when: Predicate
}
export interface AxisValue { stages: 'all' | string[]; group?: boolean }
export interface Axis { field: string; default: string; values: Record<string, AxisValue> }

export interface Workflow {
  discovery: { manifest: string; root: { from_file?: string; key?: string; default: string } }
  kinds: Axis & { parent_field?: string }
  flows?: Axis
  stages: Stage[]
  flags: { id: string; label: string; when: Predicate }[]
  actions: Record<string, unknown>
  stage_actions: Record<string, string[]>
}

export type WorkflowResult = { ok: true; workflow: Workflow } | { ok: false; error: string }

const isMapping = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string'

// Shape only: enough for derivation not to crash. Full validation is separate.
function shapeError(w: unknown): string | null {
  if (!isMapping(w)) return 'workflow: not a mapping'
  const d = w.discovery
  if (!isMapping(d) || !isString(d.manifest)) return 'discovery.manifest: expected a string'
  if (!isMapping(d.root) || !isString(d.root.default)) return 'discovery.root.default: expected a string'
  const k = w.kinds
  if (!isMapping(k) || !isString(k.field) || !isString(k.default) || !isMapping(k.values))
    return 'kinds: expected field, default and values'
  if (!Array.isArray(w.stages) || w.stages.length === 0) return 'stages: expected a non-empty list'
  for (const [i, s] of w.stages.entries()) {
    if (!isMapping(s) || !isString(s.id) || !isString(s.label) || !isString(s.artifact) || !isMapping(s.complete_when))
      return `stages[${i}]: expected id, label, artifact and complete_when`
  }
  return null
}

export function parseWorkflow(text: string): WorkflowResult {
  let raw: unknown
  try {
    raw = YAML.parse(text, { schema: 'core' })
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
  const error = shapeError(raw)
  if (error) return { ok: false, error }
  const w = raw as Workflow
  return { ok: true, workflow: { ...w, flags: w.flags ?? [], actions: w.actions ?? {}, stage_actions: w.stage_actions ?? {} } }
}
