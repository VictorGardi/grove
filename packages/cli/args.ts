import { parseArgs } from 'node:util'

export type TabKind = 'terminal' | 'claude' | 'opencode' | 'copilot'

export type Command =
  | { cmd: 'ls'; json: boolean }
  | { cmd: 'space-add'; path?: string }
  | { cmd: 'space-ls' }
  | { cmd: 'new'; kind?: TabKind; cwd?: string; space?: string; here: boolean; worktree?: string; base?: string; label?: string; prompt?: string; json: boolean; wait: boolean; timeoutS?: number }
  | { cmd: 'send'; ref: string; text: string; submit: boolean; wait: boolean; timeoutS?: number }
  | { cmd: 'wait'; ref: string; timeoutS?: number }
  | { cmd: 'focus'; ref: string }
  | { cmd: 'kill'; ref: string }
  | { cmd: 'read'; ref: string; lines: number }
  | { cmd: 'config-path' }
  | { cmd: 'skill' }
  | { cmd: 'integration'; action: 'install' | 'uninstall'; agent: 'claude' | 'copilot' }

export class UsageError extends Error {}

export const USAGE = `usage: grove <command>
  grove ls [--json]                         list spaces and their tabs
  grove space add [path]                    add a folder as a space (default: the caller folder)
  grove space ls                            list spaces and their tabs
  grove new [terminal|claude|opencode|copilot] [--here | --cwd DIR | --space REF] [--worktree BRANCH [--base REF]]
            [--label L] [--prompt TEXT|-] [--wait] [--timeout S] [--json]
                                                 start a tab; prints its id. Inside a tab the defaults are your own
                                                 space (--here) and your own agent kind; outside, the caller folder.
                                                 --worktree opens BRANCH as a worktree space of the target's repo
                                                 (reused if it exists; a new branch starts from --base, else the target's HEAD)
  grove send <ref> <TEXT|-> [--no-enter] [--wait] [--timeout S]
                                                 paste text into a tab and submit it
  grove wait <ref> [--timeout S]            block until the agent stops working (exit 0 idle, 5 gone, 124 timeout)
  grove focus <ref>                         show the tab in the app and raise its window
  grove kill <ref>                          end a tab and remove it
  grove read <ref> [--lines N]              print the last N lines (default 100) of a tab's screen
  grove config path                         print the config folder
  grove skill                               install the grove-config skill for Claude, OpenCode and Copilot
  grove integration install claude | uninstall <claude|copilot>
                                                 add or remove the hooks that report agents typed by hand, in the agent's own settings (backs up first; opencode needs none)`

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
        options: { cwd: { type: 'string' }, space: { type: 'string' }, here: { type: 'boolean' }, worktree: { type: 'string' }, base: { type: 'string' }, prompt: { type: 'string' }, label: { type: 'string' }, json: { type: 'boolean' }, ...TIMEOUT },
        allowPositionals: true,
      })
      const [kind, ...extra] = positionals
      if ((kind !== undefined && !KINDS.includes(kind)) || extra.length) return new UsageError(`new takes an optional kind, one of: ${KINDS.join(', ')}\n${USAGE}`)
      const timeoutS = timeout(values.timeout)
      if (timeoutS instanceof UsageError) return timeoutS
      if ([values.space, values.cwd, values.here || undefined].filter((v) => v !== undefined).length > 1) return new UsageError(`--here, --space and --cwd cannot be combined\n${USAGE}`)
      if (values.worktree !== undefined && values.cwd !== undefined) return new UsageError(`--worktree cannot be combined with --cwd, use --space or --here\n${USAGE}`)
      if (values.worktree === '') return new UsageError(`--worktree takes a branch name\n${USAGE}`)
      if (values.base !== undefined && values.worktree === undefined) return new UsageError(`--base needs --worktree\n${USAGE}`)
      if (values.base === '') return new UsageError(`--base takes a git ref\n${USAGE}`)
      if (values.space !== undefined && values.space === '') return new UsageError(`--space takes a space id or heading\n${USAGE}`)
      if (values.label !== undefined && values.label === '') return new UsageError(`--label takes a non-empty label\n${USAGE}`)
      if (values.wait && kind === 'terminal') return new UsageError(`--wait needs an agent: a shell tab has no state to wait on\n${USAGE}`)
      return {
        cmd: 'new', kind: kind as TabKind | undefined, cwd: values.cwd, space: values.space, here: !!values.here, worktree: values.worktree, base: values.base, prompt: values.prompt, label: values.label,
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
    if (cmd === 'config') {
      const [sub, ...args] = rest
      if (sub === 'path') {
        const { positionals } = parseArgs({ args, options: {}, allowPositionals: true })
        return positionals.length ? new UsageError(`config path takes no arguments\n${USAGE}`) : { cmd: 'config-path' }
      }
      return new UsageError(`config takes: path\n${USAGE}`)
    }
    if (cmd === 'integration') {
      const [action, agent, ...more] = rest
      const ok = (action === 'install' && agent === 'claude') || (action === 'uninstall' && (agent === 'claude' || agent === 'copilot'))
      if (!ok || more.length) {
        return new UsageError(`integration takes install claude, or uninstall claude or copilot (copilot only removes entries of older installs; copilot and opencode need no integration)\n${USAGE}`)
      }
      return { cmd: 'integration', action, agent }
    }
    if (cmd === 'skill') {
      const { positionals } = parseArgs({ args: rest, options: {}, allowPositionals: true })
      return positionals.length ? new UsageError(`skill takes no arguments\n${USAGE}`) : { cmd: 'skill' }
    }
  } catch (e) {
    return new UsageError(`${(e as Error).message}\n${USAGE}`)
  }
  return new UsageError(cmd ? `unknown command: ${cmd}\n${USAGE}` : USAGE)
}
