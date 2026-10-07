import { parseArgs } from 'node:util'

export type Command = { cmd: 'ls'; all: boolean; json: boolean }

export class UsageError extends Error {}

export const USAGE = `usage: grove <command>
  grove ls [--all] [--json]    list sessions`

export function parseCommand(argv: string[]): Command | UsageError {
  const [cmd, ...rest] = argv
  try {
    if (cmd === 'ls') {
      const { values, positionals } = parseArgs({
        args: rest,
        options: { all: { type: 'boolean' }, json: { type: 'boolean' } },
        allowPositionals: true,
      })
      if (positionals.length) return new UsageError(`ls takes no arguments\n${USAGE}`)
      return { cmd: 'ls', all: !!values.all, json: !!values.json }
    }
  } catch (e) {
    return new UsageError(`${(e as Error).message}\n${USAGE}`)
  }
  return new UsageError(cmd ? `unknown command: ${cmd}\n${USAGE}` : USAGE)
}
