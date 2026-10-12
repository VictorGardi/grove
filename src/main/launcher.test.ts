import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installAgentSkill } from './launcher'

describe('installAgentSkill', () => {
  let dir: string
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-skill-')) })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  const source = () => {
    const s = path.join(dir, 'app', 'grove')
    fs.mkdirSync(s, { recursive: true })
    fs.writeFileSync(path.join(s, 'SKILL.md'), '# grove')
    return s
  }

  it('links the skill into every skills folder, creating them, and replaces its own links on a rerun', () => {
    const dirs = [path.join(dir, 'home', '.claude', 'skills'), path.join(dir, 'home', '.config', 'opencode', 'skills')]
    const src = source()
    expect(installAgentSkill({ source: src, skillsDirs: dirs })).toEqual(dirs.map((d) => ({ target: path.join(d, 'grove') })))
    for (const d of dirs) expect(fs.readFileSync(path.join(d, 'grove', 'SKILL.md'), 'utf8')).toBe('# grove')
    expect(installAgentSkill({ source: src, skillsDirs: dirs }).every((r) => !r.error)).toBe(true)
  })

  it('leaves a real folder of that name alone and still installs the others', () => {
    const blocked = path.join(dir, 'a')
    const free = path.join(dir, 'b')
    fs.mkdirSync(path.join(blocked, 'grove'), { recursive: true })
    const [a, b] = installAgentSkill({ source: source(), skillsDirs: [blocked, free] })
    expect(a.error).toContain('is not a link')
    expect(fs.lstatSync(path.join(blocked, 'grove')).isDirectory()).toBe(true)
    expect(b.error).toBeUndefined()
    expect(fs.lstatSync(path.join(free, 'grove')).isSymbolicLink()).toBe(true)
  })
})
