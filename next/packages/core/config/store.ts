import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ConfigSnapshot, ConfigValues } from '../../protocol/messages.ts'
import { DEFAULT_VALUES, defaultFile, FILES, SECTION, validateFile, type ConfigFile, type Validated } from './schema.ts'

// The config folder under the core's home.
export function configFolder(home: string): string {
  return path.join(home, 'config')
}

// Writes a random temp name next to the file (opened with `wx`, so a file planted at that name is never followed),
// then renames it over, so a reader never sees a partial file.
export function atomicWrite(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`
  try {
    fs.writeFileSync(tmp, data, { flag: 'wx', mode: 0o600 })
    fs.renameSync(tmp, file)
  } catch (error) {
    fs.rmSync(tmp, { force: true })
    throw error
  }
}

// The live config. A file that does not validate keeps its last good value, and a note says why until it is fixed.
export class ConfigStore {
  private values: ConfigValues = structuredClone(DEFAULT_VALUES)
  private notes: Record<string, string> = {}

  constructor(readonly dir: string) {}

  // Writes the defaults for missing files, then reads all five.
  load(): void {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    for (const file of FILES) {
      const full = path.join(this.dir, file)
      if (!fs.existsSync(full)) atomicWrite(full, `${JSON.stringify(defaultFile(file), null, 2)}\n`)
    }
    this.reload()
  }

  // Re-reads the named files (all when omitted). A valid file replaces its section and clears its note; an invalid one
  // keeps the last good section and sets its note. Returns true when a section value changed (a note alone does not count).
  reload(names: readonly ConfigFile[] = FILES): boolean {
    let changed = false
    for (const file of names) {
      const result = this.readFile(file)
      if (!result.ok) {
        this.notes[file] = result.message
        continue
      }
      delete this.notes[file]
      const key = SECTION[file]
      if (JSON.stringify(this.values[key]) === JSON.stringify(result.value)) continue
      this.values = { ...this.values, [key]: result.value } as ConfigValues
      changed = true
    }
    return changed
  }

  snapshot(): ConfigSnapshot {
    return {
      path: this.dir,
      values: structuredClone(this.values),
      notes: { ...this.notes },
    }
  }

  private readFile(file: ConfigFile): Validated<unknown> {
    const full = path.join(this.dir, file)
    let text: string
    try {
      text = fs.readFileSync(full, 'utf8')
    } catch (error) {
      // A missing file means its defaults, as at start.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        return { ok: false, message: `${file}: cannot be read (${(error as Error).message})` }
      }
      text = JSON.stringify(defaultFile(file))
    }
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch (error) {
      return { ok: false, message: `${file}: not valid JSON (${(error as Error).message})` }
    }
    return validateFile(file, json)
  }
}
