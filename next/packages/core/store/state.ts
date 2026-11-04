import fs from 'node:fs'

export interface SpaceRecord {
  path: string
}

// Tab order within a space is the array order.
export interface TabRecord {
  id: string
  spacePath: string
}

export interface StateV1 {
  version: 1
  spaces: SpaceRecord[]
  tabs: TabRecord[]
}

export type LoadResult = { kind: 'ok'; state: StateV1 } | { kind: 'refused'; reason: string }

export function emptyState(): StateV1 {
  return { version: 1, spaces: [], tabs: [] }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSpaceRecord(value: unknown): boolean {
  return isPlainObject(value) && typeof value.path === 'string'
}

function isTabRecord(value: unknown): boolean {
  return isPlainObject(value) && typeof value.id === 'string' && typeof value.spacePath === 'string'
}

// A missing file is an empty state. A file that is not valid JSON, or not a JSON object, is set aside
// as `<file>.corrupt-<ms>`. A file whose version is not exactly 1 (or is missing) is refused and left
// untouched, whatever else it contains. Only a version-1 file with a malformed body is set aside.
export function loadState(file: string): LoadResult {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'ok', state: emptyState() }
    throw error
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = undefined
  }
  if (!isPlainObject(parsed)) {
    fs.renameSync(file, `${file}.corrupt-${Date.now()}`)
    return { kind: 'ok', state: emptyState() }
  }
  if (!('version' in parsed)) {
    return {
      kind: 'refused',
      reason: `state file ${file} has no version; this core reads version 1`,
    }
  }
  if (parsed.version !== 1) {
    return {
      kind: 'refused',
      reason: `state file ${file} has version ${JSON.stringify(parsed.version)}; this core reads version 1`,
    }
  }
  const malformed =
    !Array.isArray(parsed.spaces) ||
    !Array.isArray(parsed.tabs) ||
    !parsed.spaces.every(isSpaceRecord) ||
    !parsed.tabs.every(isTabRecord)
  if (malformed) {
    fs.renameSync(file, `${file}.corrupt-${Date.now()}`)
    return { kind: 'ok', state: emptyState() }
  }
  return { kind: 'ok', state: parsed as unknown as StateV1 }
}

// Writes a temp file next to the state file, fsyncs it, and renames it over, so a reader never sees a partial file.
export function saveState(file: string, state: StateV1): void {
  const tmp = `${file}.tmp-${process.pid}`
  try {
    const fd = fs.openSync(tmp, 'w', 0o600)
    try {
      fs.writeSync(fd, `${JSON.stringify(state, null, 2)}\n`)
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    fs.renameSync(tmp, file)
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}
