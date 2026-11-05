import { parseArgs } from 'node:util'

export type TabKind = 'terminal' | 'claude' | 'opencode' | 'copilot'

export type Command =
  | { cmd: 'ls'; json: boolean }
  | { cmd: 'space-add'; path?: string }
  | { cmd: 'space-ls' }
  | { cmd: 'new'; kind: TabKind; cwd?: string; label?: string; prompt?: string; json: boolean; wait: boolean; timeoutS?: number }
  | { cmd: 'send'; ref: string; text: string; submit: boolean; wait: boolean; timeoutS?: number }
  | { cmd: 'wait'; ref: string; timeoutS?: number }
  | { cmd: 'focus'; ref: string }
  | { cmd: 'kill'; ref: string }
  | { cmd: 'read'; ref: string; lines: number }

export class UsageError extends Error {}

export const USAGE = `usage: grove-next <command>
  grove-next ls [--json]                         list spaces and their tabs
  grove-next space add [path]                    add a folder as a space (default: the caller folder)
  grove-next space ls                            list spaces and their tabs
  grove-next new <terminal|claude|opencode|copilot> [--cwd DIR] [--label L] [--prompt TEXT|-] [--wait] [--timeout S] [--json]
                                                 start a tab in a space (default: the caller folder); prints its id
  grove-next send <ref> <TEXT|-> [--no-enter] [--wait] [--timeout S]
                                                 paste text into a tab and submit it
  grove-next wait <ref> [--timeout S]            block until the agent stops working (exit 0 idle, 5 gone, 124 timeout)
  grove-next focus <ref>                         show the tab in the app and raise its window
  grove-next kill <ref>                          end a tab and remove it
  grove-next read <ref> [--lines N]              print the last N lines (default 100) of a tab's screen`

const KINDS = ['terminal', 'claude', 'opencode', 'copilot']

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
      const { values, positionals } = parseArgs({ args: rest, options: { json: { type: 'boolean' } }, allowPositionals: true })
      if (positionals.length) return new UsageError(`ls takes no arguments\n${USAGE}`)
      return { cmd: 'ls', json: !!values.json }
    }
    if (cmd === 'space') {
      const [sub, ...args] = rest
      if (sub === 'ls') {
        const { positionals } = parseArgs({ args, options: {}, allowPositionals: true })
        return positionals.length ? new UsageError(`space ls takes no arguments\n${USAGE}`) : { cmd: 'space-ls' }
      }
      if (sub === 'add') {
        const { positionals } = parseArgs({ args, options: {}, allowPositionals: true })
        return positionals.length > 1 ? new UsageError(`space add takes an optional path\n${USAGE}`) : { cmd: 'space-add', path: positionals[0] }
      }
      return new UsageError(`space takes: add, ls\n${USAGE}`)
    }
    if (cmd === 'new') {
      const { values, positionals } = parseArgs({
        args: rest,
        options: { cwd: { type: 'string' }, prompt: { type: 'string' }, label: { type: 'string' }, json: { type: 'boolean' }, ...TIMEOUT },
        allowPositionals: true,
      })
      const [kind, ...extra] = positionals
      if (!kind || !KINDS.includes(kind) || extra.length) return new UsageError(`new takes one of: ${KINDS.join(', ')}\n${USAGE}`)
      const timeoutS = timeout(values.timeout)
      if (timeoutS instanceof UsageError) return timeoutS
      if (values.label !== undefined && values.label === '') return new UsageError(`--label takes a non-empty label\n${USAGE}`)
      if (values.wait && kind === 'terminal') return new UsageError(`--wait needs an agent: a shell tab has no state to wait on\n${USAGE}`)
      return {
        cmd: 'new', kind: kind as TabKind, cwd: values.cwd, prompt: values.prompt, label: values.label,
        json: !!values.json, wait: !!values.wait, timeoutS,
      }
    }
    if (cmd === 'send') {
      const { values, positionals } = parseArgs({ args: rest, options: { 'no-enter': { type: 'boolean' }, ...TIMEOUT }, allowPositionals: true })
      if (positionals.length !== 2) return new UsageError(`send takes a tab and the text (or -)\n${USAGE}`)
      const timeoutS = timeout(values.timeout)
      if (timeoutS instanceof UsageError) return timeoutS
      return { cmd: 'send', ref: positionals[0], text: positionals[1], submit: !values['no-enter'], wait: !!values.wait, timeoutS }
    }
    if (cmd === 'wait') {
      const { values, positionals } = parseArgs({ args: rest, options: { timeout: TIMEOUT.timeout }, allowPositionals: true })
      const timeoutS = timeout(values.timeout)
      if (timeoutS instanceof UsageError) return timeoutS
      if (positionals.length !== 1) return new UsageError(`wait takes a tab\n${USAGE}`)
      return { cmd: 'wait', ref: positionals[0], timeoutS }
    }
    if (cmd === 'focus' || cmd === 'kill') {
      const { positionals } = parseArgs({ args: rest, options: {}, allowPositionals: true })
      if (positionals.length !== 1) return new UsageError(`${cmd} takes a tab\n${USAGE}`)
      return { cmd, ref: positionals[0] }
    }
    if (cmd === 'read') {
      const { values, positionals } = parseArgs({ args: rest, options: { lines: { type: 'string' } }, allowPositionals: true })
      const lines = values.lines === undefined ? 100 : Number(values.lines)
      if (positionals.length !== 1 || !Number.isInteger(lines) || lines < 1) return new UsageError(`read takes a tab and optionally --lines N (≥ 1)\n${USAGE}`)
      return { cmd: 'read', ref: positionals[0], lines }
    }
  } catch (e) {
    return new UsageError(`${(e as Error).message}\n${USAGE}`)
  }
  return new UsageError(cmd ? `unknown command: ${cmd}\n${USAGE}` : USAGE)
}
