import { randomBytes } from 'node:crypto'
import os from 'node:os'
import type { AgentAdapter } from '../../status/adapter.ts'
import { commandOnPath } from '../commandOnPath.ts'
import { findOpenCodeSession } from './discover.ts'
import { createOpenCodeHub, serviceFilePath, type OpenCodeHub } from './hub.ts'

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
  // The shared connection. Default: one hub per adapter, on the service file below.
  hub?: OpenCodeHub
  serviceFile?: string
  // Default: `opencode` on the login shell's PATH. Tests inject one.
  onPath?: () => Promise<boolean>
  shell?: string
}

export function createOpenCodeAdapter(options: OpenCodeAdapterOptions = {}): AgentAdapter {
  let hub = options.hub
  // Created on the first watch, so an adapter that is only asked about its command never opens a connection.
  const connection = (): OpenCodeHub => {
    hub ??= createOpenCodeHub({ serviceFile: serviceFile() })
    return hub
  }
  const onPath = options.onPath ?? (() => commandOnPath('opencode', options.shell ?? process.env.SHELL ?? '/bin/zsh'))
  // A positive probe is kept: the login shell's start-up costs time on every create.
  let found = false

  const serviceFile = () => options.serviceFile ?? serviceFilePath(process.env, os.homedir())

  return {
    kind: 'opencode',
    // The shared service is keyed by session, so a tab found by hand waits for its session before it can be watched.
    needsSession: true,
    discover: ({ cwd, since }) => findOpenCodeSession({ serviceFile: serviceFile(), cwd, since }),
    launch: (input) => {
      if (input.resumeId !== undefined && !SESSION_ID.test(input.resumeId)) {
        throw new Error('resume id is not an OpenCode session id')
      }
      // Start and resume are the same command: -s picks up the session's own history.
      const sessionId = input.resumeId ?? mintSessionId()
      return { command: 'opencode', args: ['-s', sessionId], env: {}, sessionId }
    },
    watch: (input) => {
      const stop = connection().watch({ sessionId: input.sessionId, clock: input.clock, onEvent: input.onEvent })
      return { close: stop }
    },
    available: async () => {
      if (!found) found = await onPath()
      return found
    },
  }
}
