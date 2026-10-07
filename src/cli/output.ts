import type { CliReply, CliSession } from '@shared/cli'

const NOT_RUNNING = 'not-running'

export function formatLs(sessions: CliSession[], caller: string | null, json: boolean): string {
  if (json) return JSON.stringify(sessions, null, 2)
  const rows = [
    ['', 'ID', 'KIND', 'STATUS', 'LABEL', 'PROJECT', 'FEATURE'],
    ...sessions.map((s) => [
      s.id === caller ? '*' : '',
      s.id.slice(0, 8),
      s.kind,
      s.status ?? s.lastStatus,
      s.label,
      s.project,
      s.feature ?? '',
    ]),
  ]
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)))
  return rows.map((r) => r.map((c, i) => c.padEnd(widths[i])).join(' ').trimEnd()).join('\n')
}

export function exitCode(reply: CliReply): number {
  if (reply.ok) return 0
  return reply.error.code === NOT_RUNNING ? 3 : 1
}

export function formatError(error: { code: string; message: string }): string {
  return error.code === NOT_RUNNING ? 'grove: the Grove app is not running' : `grove: ${error.code}: ${error.message}`
}
