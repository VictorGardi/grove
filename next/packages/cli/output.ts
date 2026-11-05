export interface LsTab {
  id: string
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

// The tabs of one space, numbered in the space, one per line under the space's path.
export function formatTree(spaces: string[], tabs: LsTab[]): string[] {
  const lines: string[] = []
  for (const space of spaces) {
    lines.push(space)
    tabs.filter((tab) => tab.spacePath === space).forEach((tab, index) => {
      lines.push(`  ${index + 1}  ${tab.id}  ${tab.kind.padEnd(8)}  ${(tab.state ?? '-').padEnd(8)}  ${tab.label ?? '-'}  ${tab.alive ? 'alive' : 'exited'}`)
    })
  }
  return lines
}

export const formatLsJson = (tabs: LsTab[]): string => JSON.stringify(tabs, null, 2)

export const formatNew = (tab: { id: string; kind: string; spacePath: string; label: string | null }, json: boolean): string =>
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
