import { randomBytes } from 'node:crypto'
import os from 'node:os'
import type { AgentAdapter } from '../../status/adapter.ts'
import { commandOnPath } from '../commandOnPath.ts'
import { findOpenCodeSession, openCodeAuth, readOpenCodeService, serviceFilePath } from './discover.ts'
import { createOpencodeUsageSource } from './usage.ts'

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
  // The authenticated GET the usage source polls. Default: the read paths of the registered shared service.
  // Tests inject one.
  usageFetch?: (path: string) => Promise<unknown>
  // The usage poll period. Default POLL_MS, about a second. Tests inject a small one.
  usageIntervalMs?: number
}

// Grove draws its own tabs, so OpenCode's session tabs stay off (its default, auto, turns them on outside Herdr), and its theme
// follows the terminal's palette, which the window sets from its tokens. Merged over the user's cli.json, so the rest still applies.
export const OPENCODE_CHROME = JSON.stringify({ tabs: { mode: 'off' }, theme: { name: 'system', mode: 'dark' } })

export function createOpenCodeAdapter(options: OpenCodeAdapterOptions = {}): AgentAdapter {
  const onPath = options.onPath ?? (() => commandOnPath('opencode', options.shell ?? process.env.SHELL ?? '/bin/zsh'))
  // A positive probe is kept: the login shell's start-up costs time on every create.
  let found = false

  const serviceFile = () => options.serviceFile ?? serviceFilePath(process.env, os.homedir())

  // The usage source's API reads: re-registered each call, so a service that restarts on another port or password
  // is picked up on the next poll. A non-answer throws, which the source treats as the outage it is.
  const defaultUsageFetch = async (apiPath: string): Promise<unknown> => {
    const service = readOpenCodeService({ serviceFile: serviceFile() })
    if (service === undefined) throw new Error('the OpenCode service is not registered')
    const res = await fetch(new URL(apiPath, service.url), {
      headers: openCodeAuth(service),
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) throw new Error(`the OpenCode service answered ${res.status}`)
    return await res.json()
  }

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
    // Status comes from OSC 7501 through the holder; the context reading comes from the session's own API. The id
    // is the exact one the tab runs — launched with `-s`, resumed from the saved record — never a folder guess:
    // discovery only names an id for a hand-started tab that has none yet.
    watch(input) {
      const onContext = input.onContext
      if (input.sessionId === '' || onContext === undefined) return { close: () => {} }
      const usage = createOpencodeUsageSource({
        sessionId: input.sessionId,
        fetchJson: options.usageFetch ?? defaultUsageFetch,
        intervalMs: options.usageIntervalMs,
        // A refused reading clears the tab's figure rather than leaving stale numbers: the source delivers null.
        onContext: (context) => onContext(context ?? { tokens: null, window: null, percent: null, model: null, at: input.clock() }),
      })
      return { close: () => usage.close() }
    },
    available: async () => {
      if (!found) found = await onPath()
      return found
    },
  }
}
