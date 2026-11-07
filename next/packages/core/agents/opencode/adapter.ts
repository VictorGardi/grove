import { randomBytes } from 'node:crypto'
import os from 'node:os'
import type { AgentAdapter } from '../../status/adapter.ts'
import { commandOnPath } from '../commandOnPath.ts'
import { findOpenCodeSession, serviceFilePath } from './discover.ts'

// Port of src/core/opencodeId.ts: OpenCode's descending id format, where newer ids sort first
// (OC:packages/schema/src/identifier.ts).
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
export const SESSION_ID = /^ses_[0-9A-Za-z]+$/

export function mintSessionId(now = Date.now()): string {
  const value = ~(BigInt(now) * 0x1000n + 1n)
  const time = Array.from({ length: 6 }, (_, i) =>
    Number((value >> BigInt(40 - 8 * i)) & 0xffn).toString(16).padStart(2, '0')
  ).join('')
  const rand = Array.from(randomBytes(14), (b) => CHARS[b % 62]).join('')
  return 'ses_' + time + rand
}

export interface OpenCodeAdapterOptions {
  serviceFile?: string
  // Default: `opencode` on the login shell's PATH. Tests inject one.
  onPath?: () => Promise<boolean>
  shell?: string
}

// Grove draws its own tabs, so OpenCode's session tabs stay off (its default, auto, turns them on outside Herdr), and its theme
// follows the terminal's palette, which the window sets from its tokens. Merged over the user's cli.json, so the rest still applies.
export const OPENCODE_CHROME = JSON.stringify({ tabs: { mode: 'off' }, theme: { name: 'system', mode: 'dark' } })

export function createOpenCodeAdapter(options: OpenCodeAdapterOptions = {}): AgentAdapter {
  const onPath = options.onPath ?? (() => commandOnPath('opencode', options.shell ?? process.env.SHELL ?? '/bin/zsh'))
  // A positive probe is kept: the login shell's start-up costs time on every create.
  let found = false

  const serviceFile = () => options.serviceFile ?? serviceFilePath(process.env, os.homedir())

  return {
    kind: 'opencode',
    // A tab found by hand waits for discover() to name its session.
    needsSession: true,
    discover: ({ cwd, since, exclude }) => findOpenCodeSession({ serviceFile: serviceFile(), cwd, since, exclude }),
    launch: (input) => {
      if (input.resumeId !== undefined && !SESSION_ID.test(input.resumeId)) {
        throw new Error('resume id is not an OpenCode session id')
      }
      // Start and resume are the same command: -s picks up the session's own history.
      const sessionId = input.resumeId ?? mintSessionId()
      return { command: 'opencode', args: ['-s', sessionId], env: { OPENCODE_CLI_CONFIG_CONTENT: OPENCODE_CHROME }, sessionId }
    },
    // Status comes from OSC 7501 through the holder; nothing here reports it.
    watch: () => ({ close: () => {} }),
    available: async () => {
      if (!found) found = await onPath()
      return found
    },
  }
}
