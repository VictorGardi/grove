import { parseArgs } from 'node:util'
import type { SessionKind } from '@shared/types'

export type Command =
  | { cmd: 'ls'; all: boolean; json: boolean }
  | { cmd: 'new'; kind: SessionKind; cwd?: string; prompt?: string; label?: string; link?: string; json: boolean; wait: boolean; timeoutS?: number }
  | { cmd: 'send'; ref: string; text: string; submit: boolean; wait: boolean; timeoutS?: number }
  | { cmd: 'wait'; ref: string; timeoutS?: number }
  | { cmd: 'read'; ref: string; lines: number }

export class UsageError extends Error {}

export const USAGE = `usage: grove <command>
  grove ls [--all] [--json]                      list sessions
  grove new <opencode|claude|terminal> [--cwd DIR] [--prompt TEXT|-] [--label L] [--link SLUG] [--wait] [--timeout S] [--json]
                                                 start a session in the background; prints its id
  grove send <ref> <TEXT|-> [--no-enter] [--wait] [--timeout S]
                                                 type text into a session and submit it
  grove wait <ref> [--timeout S]                 block until the session stops working (exit 0 done, 4 needs you, 5 gone, 124 timeout)
  grove read <ref> [--lines N]                   print the last N lines (default 100) of a session's screen`

const KINDS = ['opencode', 'claude', 'terminal']

const TIMEOUT = { timeout: { type: 'string' }, wait: { type: 'boolean' } } as const

function timeout(v: string | undefined): number | undefined | UsageError {
  if (v === undefined) return undefined
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : new UsageError(`--timeout takes a number of seconds > 0\n${USAGE}`)
}

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
          cwd: { type: 'string' }, prompt: { type: 'string' }, label: { type: 'string' }, link: { type: 'string' }, json: { type: 'boolean' }, ...TIMEOUT,
        },
        allowPositionals: true,
      })
      const [kind, ...extra] = positionals
      if (!kind || !KINDS.includes(kind) || extra.length) return new UsageError(`new takes one of: ${KINDS.join(', ')}\n${USAGE}`)
      const timeoutS = timeout(values.timeout)
      if (timeoutS instanceof UsageError) return timeoutS
      return {
        cmd: 'new', kind: kind as SessionKind, cwd: values.cwd, prompt: values.prompt, label: values.label, link: values.link,
        json: !!values.json, wait: !!values.wait, timeoutS,
      }
    }
    if (cmd === 'send') {
      const { values, positionals } = parseArgs({ args: rest, options: { 'no-enter': { type: 'boolean' }, ...TIMEOUT }, allowPositionals: true })
      if (positionals.length !== 2) return new UsageError(`send takes a session and the text (or -)\n${USAGE}`)
      const timeoutS = timeout(values.timeout)
      if (timeoutS instanceof UsageError) return timeoutS
      return { cmd: 'send', ref: positionals[0], text: positionals[1], submit: !values['no-enter'], wait: !!values.wait, timeoutS }
    }
    if (cmd === 'wait') {
      const { values, positionals } = parseArgs({ args: rest, options: { timeout: TIMEOUT.timeout }, allowPositionals: true })
      const timeoutS = timeout(values.timeout)
      if (timeoutS instanceof UsageError) return timeoutS
      if (positionals.length !== 1) return new UsageError(`wait takes a session\n${USAGE}`)
      return { cmd: 'wait', ref: positionals[0], timeoutS }
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
