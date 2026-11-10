import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentSkillsDirs, installSkill, skillText, SKILL_MARKER } from './skill.ts'

describe('skillText', () => {
  it('is a skill with frontmatter, the marker, and the rule for the config folder', () => {
    const text = skillText()
    expect(text.startsWith('---\nname: grove-next-config\n')).toBe(true)
    expect(text).toContain(`<!-- ${SKILL_MARKER} -->`)
    expect(text).toContain('When `GROVE_NEXT_CONFIG` is set, read `$GROVE_NEXT_CONFIG/AGENTS.md` before changing grove-next.')
  })
})

describe('agentSkillsDirs', () => {
  it('lists the Claude, OpenCode and Copilot skill folders under home', () => {
    expect(agentSkillsDirs('/h', {})).toEqual(['/h/.claude/skills', '/h/.config/opencode/skills', '/h/.copilot/skills'])
  })

  it('honours XDG_CONFIG_HOME and COPILOT_HOME', () => {
    expect(agentSkillsDirs('/h', { XDG_CONFIG_HOME: '/x', COPILOT_HOME: '/c' })).toEqual([
      '/h/.claude/skills',
      '/x/opencode/skills',
      '/c/skills',
    ])
  })
})

describe('installSkill', () => {
  let root: string

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gn-skill-')))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  const file = (dir: string) => path.join(dir, 'grove-next-config', 'SKILL.md')

  it('writes the skill into each folder, creating the folders', () => {
    const dirs = [path.join(root, 'a'), path.join(root, 'b', 'deep')]
    const results = installSkill({ dirs })
    expect(results).toEqual(dirs.map((dir) => ({ target: file(dir), ok: true })))
    for (const dir of dirs) expect(fs.readFileSync(file(dir), 'utf8')).toBe(skillText())
  })

  it('replaces a file that carries the marker', () => {
    const dir = path.join(root, 'a')
    fs.mkdirSync(path.dirname(file(dir)), { recursive: true })
    fs.writeFileSync(file(dir), `old\n<!-- ${SKILL_MARKER} -->\n`)

    expect(installSkill({ dirs: [dir] })).toEqual([{ target: file(dir), ok: true }])
    expect(fs.readFileSync(file(dir), 'utf8')).toBe(skillText())
  })

  it('refuses a file it did not write and names it, leaving the file as it was', () => {
    const dir = path.join(root, 'a')
    fs.mkdirSync(path.dirname(file(dir)), { recursive: true })
    fs.writeFileSync(file(dir), 'mine\n')

    const [result] = installSkill({ dirs: [dir] })
    expect(result.ok).toBe(false)
    expect(result.error).toContain(file(dir))
    expect(fs.readFileSync(file(dir), 'utf8')).toBe('mine\n')
  })

  it('does not stop the other folders when one fails', () => {
    // A plain file where the skills folder should be: creating under it fails.
    const blocked = path.join(root, 'blocked')
    fs.writeFileSync(blocked, 'not a folder\n')
    const good = path.join(root, 'good')

    const results = installSkill({ dirs: [blocked, good] })
    expect(results[0]).toMatchObject({ target: file(blocked), ok: false })
    expect(results[0].error).toBeTruthy()
    expect(results[1]).toEqual({ target: file(good), ok: true })
    expect(fs.readFileSync(file(good), 'utf8')).toBe(skillText())
  })
})
