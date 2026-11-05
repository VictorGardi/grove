export interface LsTab {
  id: string
  spaceId: string
  spacePath: string
  kind: string
  state: string | null
  label: string | null
  alive: boolean
}

export interface TurnResult {
  status: 'idle' | 'gone'
}

export type TurnOutcome = { ok: true; data: TurnResult } | { ok: false; error: 'timeout' | 'no-status' | 'not-found' }

// A heading per space: its path, and for the second and later spaces of one folder the path with `#n` (n counts from 2).
export function spaceHeadings(spaces: Array<{ id: string; path: string }>): Map<string, string> {
  const seen = new Map<string, number>()
  return new Map(
    spaces.map((space) => {
      const count = (seen.get(space.path) ?? 0) + 1
      seen.set(space.path, count)
      return [space.id, count === 1 ? space.path : `${space.path}#${count}`]
    }),
  )
}

// The tabs of one space, numbered in the space, one per line under the space's heading (see spaceHeadings).
export function formatTree(spaces: Array<{ id: string; path: string }>, tabs: LsTab[]): string[] {
  const lines: string[] = []
  const headings = spaceHeadings(spaces)
  for (const space of spaces) {
    lines.push(headings.get(space.id) ?? space.path)
    tabs.filter((tab) => tab.spaceId === space.id).forEach((tab, index) => {
      lines.push(`  ${index + 1}  ${tab.id}  ${tab.kind.padEnd(8)}  ${(tab.state ?? '-').padEnd(8)}  ${tab.label ?? '-'}  ${tab.alive ? 'alive' : 'exited'}`)
    })
  }
  return lines
}

export const formatLsJson = (tabs: LsTab[]): string => JSON.stringify(tabs, null, 2)

export const formatNew = (tab: { id: string; kind: string; spaceId: string; spacePath: string; label: string | null }, json: boolean): string =>
  json ? JSON.stringify(tab, null, 2) : tab.id

// The last `lines` lines of a screen's content: the empty rows below the cursor are not content.
export function formatRead(text: string, lines?: number): string {
  const body = text.replace(/\s+$/, '')
  return lines === undefined ? body : body.split('\n').slice(-lines).join('\n')
}

export const formatError = (message: string): string => `error: ${message.replace(/\s*\n\s*/g, ' ')}`

// 0 idle, 5 gone, 124 timeout, 1 any other wait error.
export function turnExit(outcome: TurnOutcome): number {
  if (outcome.ok) return outcome.data.status === 'gone' ? 5 : 0
  return outcome.error === 'timeout' ? 124 : 1
}
