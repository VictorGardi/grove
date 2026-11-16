import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SkillAgent, SkillAgentInfo, SkillState } from '../protocol/messages.ts'
import { atomicWrite } from './config/store.ts'

// Every skill file this writes carries the marker. A file with it is ours and is replaced; any other file is left alone.
export const SKILL_MARKER = 'grove:skill'

// The `grove` skill is a file of this repo, so it is read where it is; `grove-config` is generated.
const GROVE_SKILL_FILE = fileURLToPath(new URL('../../skills/grove/SKILL.md', import.meta.url))

// The skill: it applies only when GROVE_CONFIG is set (a tab started by grove), and sends the agent to the config
// folder's own AGENTS.md before it changes anything.
export function skillText(): string {
  return [
    '---',
    'name: grove-config',
    'description: Change grove settings: sidebar width, shortcuts, launchers, theme and layout. Use when the human asks to change how grove looks or behaves. Applies only when GROVE_CONFIG is set.',
    '---',
    '',
    `<!-- ${SKILL_MARKER} -->`,
    '',
    '# grove config',
    '',
    'When `GROVE_CONFIG` is set, read `$GROVE_CONFIG/AGENTS.md` before changing grove.',
    '',
    '- Sidebar width and other settings: edit `$GROVE_CONFIG/settings.json`.',
    '- Keyboard shortcuts: edit `$GROVE_CONFIG/keys.json`.',
    '- Launcher buttons: edit `$GROVE_CONFIG/launchers.json`.',
    '- Colours and sizes: edit `$GROVE_CONFIG/theme.json`.',
    '- Sidebar order: edit `$GROVE_CONFIG/layout.json`.',
    '',
    'Keep `"version": 1` in each file. The app applies a saved change while it runs; no restart is needed.',
    '',
  ].join('\n')
}

export const SKILL_AGENTS: SkillAgent[] = ['claude', 'copilot', 'opencode']

export interface Skill {
  folder: string
  text: () => string
}

// What goes into every agent's skill folder, one folder per skill.
export const SKILLS: Skill[] = [
  { folder: 'grove-config', text: skillText },
  { folder: 'grove', text: () => fs.readFileSync(GROVE_SKILL_FILE, 'utf8') },
]

// The user skill folder of each agent: Claude's, Copilot's and OpenCode's.
export function skillDirs(home: string, env: Record<string, string | undefined>): Record<SkillAgent, string> {
  return {
    claude: path.join(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'skills'),
    copilot: path.join(env.COPILOT_HOME || path.join(home, '.copilot'), 'skills'),
    opencode: path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'opencode', 'skills'),
  }
}

export interface SkillResult {
  target: string
  ok: boolean
  error?: string
}

const skillFile = (dir: string, skill: Skill): string => path.join(dir, skill.folder, 'SKILL.md')

// The marker sits in the header of a file we wrote; a file that only quotes it further down is not ours.
const isOurs = (text: string): boolean => text.split('\n').slice(0, 10).join('\n').includes(SKILL_MARKER)

// Why this skill cannot be written or removed in `dir`, or undefined when it can: a link, or a file grove did not write.
function refusal(dir: string, skill: Skill): string | undefined {
  const target = skillFile(dir, skill)
  for (const p of [path.join(dir, skill.folder), target]) {
    if (fs.lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink()) return `${p} is a symbolic link; remove it first`
  }
  const existing = readText(target)
  if (existing !== undefined && !isOurs(existing)) return `${target} exists and was not written by grove; remove it first`
  return undefined
}

// Writes every skill into each folder. A file is written fresh; an existing file with the marker is replaced; any other
// existing file is refused and named. Every target is tried: one failing does not stop the others.
export function installSkill(o: { dirs: string[] }): SkillResult[] {
  return o.dirs.flatMap((dir) =>
    SKILLS.map((skill): SkillResult => {
      const target = skillFile(dir, skill)
      try {
        const error = refusal(dir, skill)
        if (error) return { target, ok: false, error }
        atomicWrite(target, skill.text())
        return { target, ok: true }
      } catch (e) {
        return { target, ok: false, error: (e as Error).message }
      }
    }),
  )
}

// Removes the skills grove wrote from each folder, and their folders when left empty. A skill that is not there is done.
export function uninstallSkill(o: { dirs: string[] }): SkillResult[] {
  return o.dirs.flatMap((dir) =>
    SKILLS.map((skill): SkillResult => {
      const target = skillFile(dir, skill)
      try {
        const error = refusal(dir, skill)
        if (error) return { target, ok: false, error }
        fs.rmSync(target, { force: true })
        try {
          fs.rmdirSync(path.dirname(target))
        } catch {
          // Not empty or already gone: leave it.
        }
        return { target, ok: true }
      } catch (e) {
        return { target, ok: false, error: (e as Error).message }
      }
    }),
  )
}

// installed: every skill is there and current. not-installed: none is there. out-of-date: some are missing or differ.
// blocked: a file or link that grove did not write is in the way; install and remove would refuse it.
export function skillState(dir: string): { state: SkillState; error?: string } {
  let present = 0
  let current = 0
  for (const skill of SKILLS) {
    const error = refusal(dir, skill)
    if (error) return { state: 'blocked', error }
    const text = readText(skillFile(dir, skill))
    if (text === undefined) continue
    present++
    if (text === skill.text()) current++
  }
  if (present === 0) return { state: 'not-installed' }
  return { state: current === SKILLS.length ? 'installed' : 'out-of-date' }
}

export function skillInfo(agent: SkillAgent, dir: string): SkillAgentInfo {
  try {
    return { agent, dir, ...skillState(dir) }
  } catch (e) {
    return { agent, dir, state: 'blocked', error: (e as Error).message }
  }
}

function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw e
  }
}
