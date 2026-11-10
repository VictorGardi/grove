import path from 'node:path'
import { atomicWrite } from './store.ts'
import { FILES, SCHEMAS } from './schema.ts'

// The AGENTS.md written into the config folder: what each file holds, from the schemas themselves.
export function renderAgentsMd(): string {
  const lines = [
    '# grove config',
    '',
    'This folder holds the settings of grove. The app reads these files and applies a change while it runs, with no restart.',
    '',
    'Rules for every file:',
    '',
    '- Each file is JSON with `"version": 1`. Edit it with any editor.',
    '- A missing file means its defaults. The app writes the defaults for missing files when it starts.',
    '- A file that does not validate (unknown key, wrong type, value out of range) keeps its last good values. The app shows a note with the file name and the problem until the file is fixed.',
    '- Every tab the app starts has GROVE_CONFIG set to this folder.',
    '',
  ]
  for (const file of FILES) {
    const schema = SCHEMAS[file]
    lines.push(`## ${file}`, '', schema.description, '')
    for (const field of schema.fields) {
      lines.push(`- \`${field.name}\` (${field.type}; default ${JSON.stringify(field.default)}): ${field.description}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

export function writeAgentsMd(dir: string): void {
  atomicWrite(path.join(dir, 'AGENTS.md'), renderAgentsMd())
}
