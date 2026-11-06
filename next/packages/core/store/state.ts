import fs from 'node:fs'
import type { DiffComment, DiffPrefs } from '../../protocol/messages.ts'
import type { AgentKind } from '../status/adapter.ts'

// `id` is optional: a file written before spaces had ids has none, and loadState fills them in.
// `name` is a display name the human gave; without it the space shows its folder's name.
export interface SpaceRecord {
  id?: string
  path: string
  name?: string
}

// Tab order within a space is the array order. `spaceId`, `agent`, `agentSessionId`, `label` and `found` are optional
// and were added without a version bump: a version-1 file written before them loads unchanged, with them filled in or unset.
// `found` marks an agent typed by hand into a shell tab (not launched by the app), so a restarted core knows to release it.
export interface TabRecord {
  id: string
  spaceId?: string
  spacePath: string
  agent?: AgentKind
  agentSessionId?: string
  label?: string
  found?: boolean
}

// loadState fills every id in, so these fallbacks only satisfy the optional fields' types. They are the same
// values loadState would fill in.
export const recordSpaceId = (space: SpaceRecord): string => space.id ?? space.path
export const tabSpaceId = (tab: TabRecord): string => tab.spaceId ?? tab.spacePath

export interface StateV1 {
  version: 1
  spaces: SpaceRecord[]
  tabs: TabRecord[]
  // The diff panel's view per folder (its real path). Added without a version bump: a file without it loads unchanged.
  diffPrefs?: Record<string, DiffPrefs>
  // The diff review comments per folder (its real path), same rules as diffPrefs.
  diffComments?: Record<string, DiffComment[]>
}

export type LoadResult = { kind: 'ok'; state: StateV1 } | { kind: 'refused'; reason: string }

export function emptyState(): StateV1 {
  return { version: 1, spaces: [], tabs: [] }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSpaceRecord(value: unknown): boolean {
  return isPlainObject(value) && typeof value.path === 'string' && (value.id === undefined || typeof value.id === 'string') && (value.name === undefined || typeof value.name === 'string')
}

function isTabRecord(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    typeof value.id === 'string' &&
    typeof value.spacePath === 'string' &&
    (value.spaceId === undefined || typeof value.spaceId === 'string')
  )
}

// Gives each space without an id one: the first space of a path gets the path, a later one `${path}#n` for the
// smallest n >= 2 not already used. A tab without a spaceId gets the id of the first space with its spacePath.
// A tab whose path matches no space keeps its path as its spaceId, which no space has, so it shows under no space.
function fillIds(state: StateV1): StateV1 {
  const ids = new Set(state.spaces.flatMap((space) => (space.id === undefined ? [] : [space.id])))
  const spaces = state.spaces.map((space) => {
    if (space.id !== undefined) return space
    let id = space.path
    for (let n = 2; ids.has(id); n++) id = `${space.path}#${n}`
    ids.add(id)
    return { ...space, id }
  })
  const tabs = state.tabs.map((tab) => {
    if (tab.spaceId !== undefined) return tab
    const first = spaces.find((space) => space.path === tab.spacePath)
    return { ...tab, spaceId: first?.id ?? tab.spacePath }
  })
  return { ...state, spaces, tabs }
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
    !parsed.tabs.every(isTabRecord) ||
    (parsed.diffPrefs !== undefined && !isPlainObject(parsed.diffPrefs)) ||
    (parsed.diffComments !== undefined && !isPlainObject(parsed.diffComments))
  if (malformed) {
    fs.renameSync(file, `${file}.corrupt-${Date.now()}`)
    return { kind: 'ok', state: emptyState() }
  }
  return { kind: 'ok', state: fillIds(parsed as unknown as StateV1) }
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
