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

type Obj = Record<string, unknown>
const isMapping = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string'
const isScalar = (v: unknown) => ['string', 'number', 'boolean'].includes(typeof v)

const TOP_KEYS = ['discovery', 'kinds', 'flows', 'stages', 'flags', 'actions', 'stage_actions']
const STAGE_KEYS = ['id', 'label', 'artifact', 'review', 'complete_when']
const TEMPLATE_VARS = ['slug', 'stage', 'project_path', 'feature_path', 'feedback']
const RESERVED_VARS = ['repo', 'repo_path']

// Every problem as `path: message`; empty when valid.
function validate(w: unknown): string[] {
  const errs: string[] = []
  const err = (path: string, msg: string) => errs.push(`${path}: ${msg}`)
  if (!isMapping(w)) return ['workflow: not a mapping']
  for (const k of Object.keys(w)) if (!TOP_KEYS.includes(k)) err(k, 'unknown key')

  const d = w.discovery
  if (!isMapping(d) || !isString(d.manifest)) err('discovery.manifest', 'expected a string')
  if (!isMapping(d) || !isMapping(d.root) || !isString(d.root.default)) err('discovery.root.default', 'expected a string')
  else if (isString(d.root.from_file) !== isString(d.root.key) || (d.root.from_file !== undefined && !isString(d.root.from_file)))
    err('discovery.root', 'from_file and key must both be strings or both be absent')

  const stageIds: string[] = []
  if (!Array.isArray(w.stages) || w.stages.length === 0) err('stages', 'expected a non-empty list')
  else w.stages.forEach((s, i) => {
    const at = `stages[${i}]`
    if (!isMapping(s)) return void err(at, 'expected a mapping')
    for (const k of Object.keys(s)) {
      if (k === 'per_repo') err(`${at}.per_repo`, 'reserved for a later hub')
      else if (!STAGE_KEYS.includes(k)) err(`${at}.${k}`, 'unknown key')
    }
    if (!isString(s.id)) err(`${at}.id`, 'expected a string')
    else if (stageIds.includes(s.id)) err(`${at}.id`, `duplicate "${s.id}"`)
    else stageIds.push(s.id)
    for (const k of ['label', 'artifact']) if (!isString(s[k])) err(`${at}.${k}`, 'expected a string')
    if (s.review !== undefined && !isString(s.review)) err(`${at}.review`, 'expected a string')
    predicate(`${at}.complete_when`, s.complete_when)
  })

  function predicate(at: string, p: unknown): void {
    if (!isMapping(p)) return void err(at, 'unknown predicate')
    const keys = Object.keys(p).sort().join(',')
    const ok =
      (keys === 'exists' && p.exists === true) ||
      (keys === 'equals,field' && isString(p.field) && isScalar(p.equals)) ||
      (keys === 'field,in' && isString(p.field) && Array.isArray(p.in)) ||
      (keys === 'all_checked' && isString(p.all_checked))
    if (!ok) err(at, 'unknown predicate')
  }

  function axis(at: string, a: unknown, withKind: boolean): void {
    if (!isMapping(a)) return void err(at, 'expected a mapping')
    if (!isString(a.field)) err(`${at}.field`, 'expected a string')
    if (withKind && a.parent_field !== undefined && !isString(a.parent_field)) err(`${at}.parent_field`, 'expected a string')
    if (!isMapping(a.values) || Object.keys(a.values).length === 0) return void err(`${at}.values`, 'expected a non-empty mapping')
    if (!isString(a.default) || !Object.hasOwn(a.values, a.default)) err(`${at}.default`, 'not a key of values')
    for (const [name, v] of Object.entries(a.values)) {
      const vAt = `${at}.values.${name}`
      if (!isMapping(v)) { err(vAt, 'expected a mapping'); continue }
      if (v.stages !== 'all') {
        if (!Array.isArray(v.stages)) err(`${vAt}.stages`, 'expected "all" or a list')
        else for (const id of v.stages) if (!stageIds.includes(id)) err(`${vAt}.stages`, `unknown stage "${id}"`)
      }
      if (withKind && v.group !== undefined && typeof v.group !== 'boolean') err(`${vAt}.group`, 'expected a boolean')
    }
  }
  axis('kinds', w.kinds, true)
  if (w.flows !== undefined) axis('flows', w.flows, false)

  if (w.flags !== undefined) {
    if (!Array.isArray(w.flags)) err('flags', 'expected a list')
    else w.flags.forEach((f, i) => {
      if (!isMapping(f) || !isString(f.id) || !isString(f.label)) err(`flags[${i}]`, 'expected id and label strings')
      predicate(`flags[${i}].when`, isMapping(f) ? f.when : undefined)
    })
  }

  function template(at: string, t: unknown): void {
    if (!isString(t)) return void err(at, 'expected a string')
    for (const [, name] of t.matchAll(/\{([^{}]*)\}/g)) {
      if (RESERVED_VARS.includes(name)) err(at, `{${name}} is reserved for a later hub`)
      else if (!TEMPLATE_VARS.includes(name)) err(at, `unknown variable {${name}}`)
    }
  }
  const actionIds: string[] = []
  if (w.actions !== undefined) {
    if (!isMapping(w.actions)) err('actions', 'expected a mapping')
    else for (const [id, a] of Object.entries(w.actions)) {
      actionIds.push(id)
      if (!isMapping(a)) { err(`actions.${id}`, 'expected a mapping'); continue }
      template(`actions.${id}.label`, a.label)
      template(`actions.${id}.prompt`, a.prompt)
      if (a.cwd !== undefined) template(`actions.${id}.cwd`, a.cwd)
      if (a.needs_input !== undefined && typeof a.needs_input !== 'boolean') err(`actions.${id}.needs_input`, 'expected a boolean')
    }
  }

  if (w.stage_actions !== undefined) {
    if (!isMapping(w.stage_actions)) err('stage_actions', 'expected a mapping')
    else for (const [key, ids] of Object.entries(w.stage_actions)) {
      const at = `stage_actions.${key}`
      if (key !== 'default' && !stageIds.includes(key)) err(at, 'not "default" or a stage id')
      if (!Array.isArray(ids)) err(at, 'expected a list')
      else for (const id of ids) if (!actionIds.includes(id)) err(at, `unknown action "${id}"`)
    }
  }
  return errs
}

export function parseWorkflow(text: string): WorkflowResult {
  let raw: unknown
  try {
    raw = YAML.parse(text, { schema: 'core' })
  } catch (e) {
    return { ok: false, error: (e as Error).message.split('\n')[0] } // carries "at line L, column C"
  }
  const errors = validate(raw)
  if (errors.length) return { ok: false, error: errors.join('; ') }
  const w = raw as Workflow
  return { ok: true, workflow: { ...w, flags: w.flags ?? [], actions: w.actions ?? {}, stage_actions: w.stage_actions ?? {} } }
}
