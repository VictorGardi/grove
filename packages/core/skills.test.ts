import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installSkill, skillDirs, skillInfo, skillText, SKILLS, SKILL_MARKER, uninstallSkill } from './skills.ts'

describe('skillText', () => {
  it('is a skill with frontmatter, the marker, and the rule for the config folder', () => {
    const text = skillText()
    expect(text.startsWith('---\nname: grove-config\n')).toBe(true)
    expect(text).toContain(`<!-- ${SKILL_MARKER} -->`)
    expect(text).toContain('When `GROVE_CONFIG` is set, read `$GROVE_CONFIG/AGENTS.md` before changing grove.')
  })
})

describe('SKILLS', () => {
  it('carries the grove skill from this repo, marked as ours', () => {
    const grove = SKILLS.find((skill) => skill.folder === 'grove')!.text()
    expect(grove.startsWith('---\nname: grove\n')).toBe(true)
    expect(grove.split('\n').slice(0, 10).join('\n')).toContain(SKILL_MARKER)
  })
})

describe('skillDirs', () => {
  it('names the Claude, Copilot and OpenCode skill folders under home', () => {
    expect(skillDirs('/h', {})).toEqual({
      claude: '/h/.claude/skills',
      copilot: '/h/.copilot/skills',
      opencode: '/h/.config/opencode/skills',
    })
  })

  it('honours CLAUDE_CONFIG_DIR, COPILOT_HOME and XDG_CONFIG_HOME', () => {
    expect(skillDirs('/h', { CLAUDE_CONFIG_DIR: '/a', COPILOT_HOME: '/c', XDG_CONFIG_HOME: '/x' })).toEqual({
      claude: '/a/skills',
      copilot: '/c/skills',
      opencode: '/x/opencode/skills',
    })
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

  const file = (dir: string, folder = 'grove-config') => path.join(dir, folder, 'SKILL.md')

  it('writes every skill into each folder, creating the folders', () => {
    const dirs = [path.join(root, 'a'), path.join(root, 'b', 'deep')]
    const results = installSkill({ dirs })
    expect(results).toEqual(dirs.flatMap((dir) => SKILLS.map((skill) => ({ target: file(dir, skill.folder), ok: true }))))
    for (const dir of dirs) for (const skill of SKILLS) expect(fs.readFileSync(file(dir, skill.folder), 'utf8')).toBe(skill.text())
  })

  it('replaces a file that carries the marker', () => {
    const dir = path.join(root, 'a')
    fs.mkdirSync(path.dirname(file(dir)), { recursive: true })
    fs.writeFileSync(file(dir), `old\n<!-- ${SKILL_MARKER} -->\n`)

    expect(installSkill({ dirs: [dir] }).every((result) => result.ok)).toBe(true)
    expect(fs.readFileSync(file(dir), 'utf8')).toBe(skillText())
  })

  it('refuses a file it did not write and names it, leaving the file as it was', () => {
    const dir = path.join(root, 'a')
    fs.mkdirSync(path.dirname(file(dir)), { recursive: true })
    fs.writeFileSync(file(dir), 'mine\n')

    const [result, other] = installSkill({ dirs: [dir] })
    expect(result.ok).toBe(false)
    expect(result.error).toContain(file(dir))
    expect(fs.readFileSync(file(dir), 'utf8')).toBe('mine\n')
    // The other skill is not held up by it.
    expect(other.ok).toBe(true)
  })

  it('refuses a symbolic link in the skill folder', () => {
    const dir = path.join(root, 'a')
    fs.mkdirSync(dir)
    fs.mkdirSync(path.join(root, 'elsewhere'))
    fs.symlinkSync(path.join(root, 'elsewhere'), path.join(dir, 'grove'))

    const result = installSkill({ dirs: [dir] }).find((r) => r.target === file(dir, 'grove'))!
    expect(result.ok).toBe(false)
    expect(result.error).toContain('symbolic link')
    expect(fs.readdirSync(path.join(root, 'elsewhere'))).toEqual([])
  })

  it('does not stop the other folders when one fails', () => {
    // A plain file where the skills folder should be: creating under it fails.
    const blocked = path.join(root, 'blocked')
    fs.writeFileSync(blocked, 'not a folder\n')
    const good = path.join(root, 'good')

    const results = installSkill({ dirs: [blocked, good] })
    expect(results.filter((r) => r.target.startsWith(blocked)).every((r) => !r.ok && r.error)).toBe(true)
    expect(results.filter((r) => r.target.startsWith(good)).every((r) => r.ok)).toBe(true)
  })
})

describe('skillInfo and uninstallSkill', () => {
  let dir: string

  beforeEach(() => {
    dir = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gn-skill-'))), 'skills')
  })

  afterEach(() => {
    fs.rmSync(path.dirname(dir), { recursive: true, force: true })
  })

  it('reads not-installed, installed, out-of-date and blocked', () => {
    expect(skillInfo('claude', dir)).toEqual({ agent: 'claude', dir, state: 'not-installed' })

    installSkill({ dirs: [dir] })
    expect(skillInfo('claude', dir).state).toBe('installed')

    fs.appendFileSync(path.join(dir, 'grove', 'SKILL.md'), 'edited\n')
    expect(skillInfo('claude', dir).state).toBe('out-of-date')

    fs.writeFileSync(path.join(dir, 'grove', 'SKILL.md'), 'mine\n')
    const blocked = skillInfo('claude', dir)
    expect(blocked.state).toBe('blocked')
    expect(blocked.error).toContain('not written by grove')
  })

  it('removes what it wrote and the empty folders, and leaves a file that is not ours', () => {
    installSkill({ dirs: [dir] })
    expect(uninstallSkill({ dirs: [dir] }).every((r) => r.ok)).toBe(true)
    expect(fs.readdirSync(dir)).toEqual([])

    installSkill({ dirs: [dir] })
    fs.writeFileSync(path.join(dir, 'grove', 'SKILL.md'), 'mine\n')
    const results = uninstallSkill({ dirs: [dir] })
    expect(results.find((r) => r.target.includes('/grove/'))?.ok).toBe(false)
    expect(fs.readFileSync(path.join(dir, 'grove', 'SKILL.md'), 'utf8')).toBe('mine\n')
    expect(fs.existsSync(path.join(dir, 'grove-config'))).toBe(false)
  })
})
