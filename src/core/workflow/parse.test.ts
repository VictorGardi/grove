import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import YAML from 'yaml'
import { parseWorkflow } from './parse'

const bundled = fs.readFileSync(new URL('../../../resources/workflow.yaml', import.meta.url), 'utf8')

// The bundled workflow, edited by `mutate`, run through parseWorkflow.
function edited(mutate: (w: Record<string, any>) => void) {
  const w = YAML.parse(bundled)
  mutate(w)
  return parseWorkflow(YAML.stringify(w))
}

describe('parseWorkflow', () => {
  it('accepts the bundled workflow', () => {
    expect(parseWorkflow(bundled).ok).toBe(true)
  })

  it.each<[string, (w: Record<string, any>) => void, string]>([
    ['an unknown stage in a kind', (w) => { w.kinds.values.epic.stages.push('nope') }, 'kinds.values.epic.stages: unknown stage "nope"'],
    ['an unknown stage in a flow', (w) => { w.flows.values.small.stages.push('nope') }, 'flows.values.small.stages: unknown stage "nope"'],
    ['an unknown predicate', (w) => { w.stages[0].complete_when = { field: 'status', matches: 'x' } }, 'stages[0].complete_when: unknown predicate'],
    ['{repo} in a template', (w) => { w.actions.start.prompt = 'cd {repo}' }, 'actions.start.prompt: {repo} is reserved'],
    ['per_repo on a stage', (w) => { w.stages[0].per_repo = true }, 'stages[0].per_repo: reserved'],
    ['an unknown template variable', (w) => { w.actions.start.prompt = '{nope}' }, 'actions.start.prompt: unknown variable {nope}'],
    ['a duplicate stage id', (w) => { w.stages[1].id = 'questions' }, 'stages[1].id: duplicate "questions"'],
    ['a kinds default not in values', (w) => { w.kinds.default = 'story' }, 'kinds.default: not a key of values'],
    ['stage_actions naming an unknown action', (w) => { w.stage_actions.default.push('ship') }, 'stage_actions.default: unknown action "ship"'],
    ['an unknown top-level key', (w) => { w.stagez = [] }, 'stagez: unknown key'],
  ])('rejects %s', (_, mutate, message) => {
    const res = edited(mutate)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain(message)
  })

  it('reports YAML errors with line and column', () => {
    const res = parseWorkflow('stages: [a\nkinds: x\n')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('line 2, column 1')
  })
})
