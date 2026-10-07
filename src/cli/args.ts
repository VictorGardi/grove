import { parseArgs } from 'node:util'
import type { SessionKind } from '@shared/types'

export type Command =
  | { cmd: 'ls'; all: boolean; json: boolean }
  | { cmd: 'new'; kind: SessionKind; cwd?: string; prompt?: string; label?: string; link?: string; json: boolean }

export class UsageError extends Error {}

export const USAGE = `usage: grove <command>
  grove ls [--all] [--json]                      list sessions
  grove new <opencode|claude|terminal> [--cwd DIR] [--prompt TEXT|-] [--label L] [--link SLUG] [--json]
                                                 start a session in the background; prints its id`

const KINDS = ['opencode', 'claude', 'terminal']

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
    if (cmd === 'new') {
      const { values, positionals } = parseArgs({
        args: rest,
        options: {
          cwd: { type: 'string' }, prompt: { type: 'string' }, label: { type: 'string' }, link: { type: 'string' }, json: { type: 'boolean' },
        },
        allowPositionals: true,
      })
      const [kind, ...extra] = positionals
      if (!kind || !KINDS.includes(kind) || extra.length) return new UsageError(`new takes one of: ${KINDS.join(', ')}\n${USAGE}`)
      return { cmd: 'new', kind: kind as SessionKind, cwd: values.cwd, prompt: values.prompt, label: values.label, link: values.link, json: !!values.json }
    }
  } catch (e) {
    return new UsageError(`${(e as Error).message}\n${USAGE}`)
  }
  return new UsageError(cmd ? `unknown command: ${cmd}\n${USAGE}` : USAGE)
}
