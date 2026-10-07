import { parseArgs } from 'node:util'
import type { SessionKind } from '@shared/types'

export type Command =
  | { cmd: 'ls'; all: boolean; json: boolean }
  | { cmd: 'new'; kind: SessionKind; cwd?: string; prompt?: string; label?: string; link?: string; json: boolean }
  | { cmd: 'send'; ref: string; text: string; submit: boolean }
  | { cmd: 'read'; ref: string; lines: number }

export class UsageError extends Error {}

export const USAGE = `usage: grove <command>
  grove ls [--all] [--json]                      list sessions
  grove new <opencode|claude|terminal> [--cwd DIR] [--prompt TEXT|-] [--label L] [--link SLUG] [--json]
                                                 start a session in the background; prints its id
  grove send <ref> <TEXT|-> [--no-enter]         type text into a session and submit it
  grove read <ref> [--lines N]                   print the last N lines (default 100) of a session's screen`

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
    if (cmd === 'send') {
      const { values, positionals } = parseArgs({ args: rest, options: { 'no-enter': { type: 'boolean' } }, allowPositionals: true })
      if (positionals.length !== 2) return new UsageError(`send takes a session and the text (or -)\n${USAGE}`)
      return { cmd: 'send', ref: positionals[0], text: positionals[1], submit: !values['no-enter'] }
    }
    if (cmd === 'read') {
      const { values, positionals } = parseArgs({ args: rest, options: { lines: { type: 'string' } }, allowPositionals: true })
      const lines = values.lines === undefined ? 100 : Number(values.lines)
      if (positionals.length !== 1 || !Number.isInteger(lines) || lines < 1) return new UsageError(`read takes a session and optionally --lines N (≥ 1)\n${USAGE}`)
      return { cmd: 'read', ref: positionals[0], lines }
    }
  } catch (e) {
    return new UsageError(`${(e as Error).message}\n${USAGE}`)
  }
  return new UsageError(cmd ? `unknown command: ${cmd}\n${USAGE}` : USAGE)
}
