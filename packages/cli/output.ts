// A tab's context as `ls --json` gives it; `level` is the same reading judged (see contextLevel).
export interface LsContext {
  tokens: number | null
  window: number | null
  percent: number | null
  at: number
}

export interface LsTab {
  id: string
  spaceId: string
  spacePath: string
  kind: string
  state: string | null
  context: LsContext | null
  level: string | null
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

const compact = (n: number): string => (n < 1000 ? String(n) : n < 1_000_000 ? `${Number((n / 1000).toFixed(1))}k` : `${Number((n / 1_000_000).toFixed(1))}M`)

// A tab's context for the listing: its share of the window and level (`42% ok`), the token count when it has no window
// (`120k warn`), `-` when there is no reading to judge.
export function formatContext(tab: Pick<LsTab, 'context' | 'level'>): string {
  const { context, level } = tab
  if (context === null || context.tokens === null || level === null) return '-'
  const share = context.percent ?? (context.window !== null && context.window > 0 ? (context.tokens / context.window) * 100 : null)
  return `${share === null ? compact(context.tokens) : `${Math.round(share)}%`} ${level}`
}

// The tabs of one space, numbered in the space, one per line under the space's heading (see spaceHeadings).
export function formatTree(spaces: Array<{ id: string; path: string }>, tabs: LsTab[]): string[] {
  const lines: string[] = []
  const headings = spaceHeadings(spaces)
  for (const space of spaces) {
    lines.push(headings.get(space.id) ?? space.path)
    tabs.filter((tab) => tab.spaceId === space.id).forEach((tab, index) => {
      lines.push(`  ${index + 1}  ${tab.id}  ${tab.kind.padEnd(8)}  ${(tab.state ?? '-').padEnd(8)}  ${formatContext(tab).padEnd(12)}  ${tab.label ?? '-'}  ${tab.alive ? 'alive' : 'exited'}`)
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
