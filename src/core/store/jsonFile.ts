import fs from 'node:fs'
import path from 'node:path'

export function atomicWrite(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, file)
}

export function readVersioned<T extends { schemaVersion: number }>(
  file: string,
  schemaVersion: number,
  empty: T,
  onBad?: (msg: string) => void
): T {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return empty
    throw e
  }
  let problem: string
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.schemaVersion === schemaVersion) return parsed as T
    problem = `unknown schemaVersion ${JSON.stringify(parsed?.schemaVersion)}`
  } catch (e) {
    problem = `invalid JSON (${(e as Error).message})`
  }
  const moved = `${file}.bad-${Date.now()}`
  fs.renameSync(file, moved)
  onBad?.(`${file}: ${problem}; moved to ${moved}`)
  return empty
}
