import fs from 'node:fs'
import path from 'node:path'
import { atomicWrite } from '../core/config/store.ts'

// Every skill file this writes carries the marker. A file with it is ours and is replaced; any other file is left alone.
export const SKILL_MARKER = 'grove-next:skill'

const SKILL_FOLDER = 'grove-next-config'

// The skill: it applies only when GROVE_NEXT_CONFIG is set (a tab started by grove-next), and sends the agent to the config
// folder's own AGENTS.md before it changes anything.
export function skillText(): string {
  return [
    '---',
    'name: grove-next-config',
    'description: Change grove-next settings: sidebar width, shortcuts, launchers, theme and layout. Use when the human asks to change how grove-next looks or behaves. Applies only when GROVE_NEXT_CONFIG is set.',
    '---',
    '',
    `<!-- ${SKILL_MARKER} -->`,
    '',
    '# grove-next config',
    '',
    'When `GROVE_NEXT_CONFIG` is set, read `$GROVE_NEXT_CONFIG/AGENTS.md` before changing grove-next.',
    '',
    '- Sidebar width and other settings: edit `$GROVE_NEXT_CONFIG/settings.json`.',
    '- Keyboard shortcuts: edit `$GROVE_NEXT_CONFIG/keys.json`.',
    '- Launcher buttons: edit `$GROVE_NEXT_CONFIG/launchers.json`.',
    '- Colours and sizes: edit `$GROVE_NEXT_CONFIG/theme.json`.',
    '- Sidebar order: edit `$GROVE_NEXT_CONFIG/layout.json`.',
    '',
    'Keep `"version": 1` in each file. The app applies a saved change while it runs; no restart is needed.',
    '',
  ].join('\n')
}

// The folders the skill goes into: Claude, OpenCode and Copilot user skill folders.
export function agentSkillsDirs(home: string, env: Record<string, string | undefined>): string[] {
  return [
    path.join(home, '.claude', 'skills'),
    path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'opencode', 'skills'),
    path.join(env.COPILOT_HOME || path.join(home, '.copilot'), 'skills'),
  ]
}

export interface SkillResult {
  target: string
  ok: boolean
  error?: string
}

// Writes the skill into each folder. A file is written fresh; an existing file with the marker is replaced; any other
// existing file is refused and named. Every folder is tried: one failing does not stop the others.
export function installSkill(o: { dirs: string[] }): SkillResult[] {
  return o.dirs.map((dir) => {
    const target = path.join(dir, SKILL_FOLDER, 'SKILL.md')
    try {
      for (const p of [path.join(dir, SKILL_FOLDER), target]) {
        if (fs.lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink()) {
          return { target, ok: false, error: `${p} is a symbolic link; remove it first` }
        }
      }
      const existing = readText(target)
      // The marker sits in the header of a file we wrote; a file that only quotes it further down is not ours.
      if (existing !== undefined && !existing.split('\n').slice(0, 10).join('\n').includes(SKILL_MARKER)) {
        return { target, ok: false, error: `${target} exists and was not written by grove-next; remove it first` }
      }
      atomicWrite(target, skillText())
      return { target, ok: true }
    } catch (e) {
      return { target, ok: false, error: (e as Error).message }
    }
  })
}

function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw e
  }
}
