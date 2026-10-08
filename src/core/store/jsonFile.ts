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
  onBad?: (msg: string) => void,
  migrations?: Record<number, (old: any) => any> // migrations[n] turns version n into n+1
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
    let parsed = JSON.parse(raw)
    for (let v = parsed?.schemaVersion; v !== schemaVersion && migrations?.[v]; v = parsed.schemaVersion) {
      parsed = { ...migrations[v](parsed), schemaVersion: v + 1 }
    }
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
