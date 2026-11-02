import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'

export function atomicWrite(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  // a random name opened with `wx` (O_EXCL): a pre-planted file or symlink at the name is never followed
  const tmp = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`
  try {
    fs.writeFileSync(tmp, data, { flag: 'wx', mode: 0o600 })
    fs.renameSync(tmp, file)
  } catch (e) {
    fs.rmSync(tmp, { force: true })
    throw e
  }
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
