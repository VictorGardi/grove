import fs from 'node:fs'
import path from 'node:path'
import type { AgentKind } from '../status/adapter.ts'
import type { IntegrationAgent, IntegrationInfo, IntegrationState } from '../../protocol/messages.ts'
import {
  hasAnyGroveHooks,
  hasClaudeHooks,
  hasCopilotHooks,
  installClaude,
  installCopilot,
  readSettings,
  uninstallClaude,
  uninstallCopilot,
} from './install.ts'

// The human's answer for an agent, recorded once. Enabled comes from a successful install; not-now from the prompt.
export type ConsentAnswer = 'enabled' | 'not-now'
type Consent = Partial<Record<IntegrationAgent, ConsentAnswer>>

export interface IntegrationServiceOptions {
  // The settings file each agent's hooks live in (Claude's and Copilot's own folders, resolved by the caller).
  files: Record<IntegrationAgent, string>
  // Where the answers are recorded: a small JSON file in the Grove home.
  consentFile: string
  // The Node that runs the Claude hook. Default: the Node running this process.
  node?: string
}

export function isIntegrationAgent(value: unknown): value is IntegrationAgent {
  return value === 'claude' || value === 'copilot'
}

// Nothing here writes a settings file except install(), which the daemon calls only for a request from the app's
// install button or the CLI. Status and the prompt rule only read.
export class IntegrationService {
  constructor(private readonly options: IntegrationServiceOptions) {}

  // The recorded answers. A missing or unreadable record is none: the prompt may ask again, and nothing is written.
  consent(): Consent {
    try {
      const value: unknown = JSON.parse(fs.readFileSync(this.options.consentFile, 'utf8'))
      return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Consent) : {}
    } catch {
      return {}
    }
  }

  answer(agent: IntegrationAgent, answer: ConsentAnswer): void {
    const next = { ...this.consent(), [agent]: answer }
    fs.mkdirSync(path.dirname(this.options.consentFile), { recursive: true, mode: 0o700 })
    const tmp = `${this.options.consentFile}.tmp`
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
    fs.renameSync(tmp, this.options.consentFile)
  }

  // The state of an agent's hooks in its settings file as it is now.
  status(agent: IntegrationAgent, adopted: boolean): IntegrationInfo {
    const file = this.options.files[agent]
    const backup = `${file}.grove-next.bak`
    let state: IntegrationState
    let error: string | undefined
    try {
      const settings = readSettings(file)
      const complete = agent === 'claude' ? hasClaudeHooks(settings) : hasCopilotHooks(settings)
      state = complete ? 'enabled' : hasAnyGroveHooks(settings) ? 'out-of-date' : 'not-enabled'
    } catch (failure) {
      state = 'unreadable'
      error = failure instanceof Error ? failure.message : String(failure)
    }
    const pending = adopted && state === 'not-enabled' && this.consent()[agent] === undefined
    return { agent, state, file, backup, pending, ...(error !== undefined ? { error } : {}) }
  }

  // Writes Grove's hook entries, keeping the file's own. Refuses an unreadable file before any write (the installers read
  // it first). The answer is recorded only once the install has worked.
  install(agent: IntegrationAgent, adopted: boolean): IntegrationInfo & { changed: boolean; written: string | null } {
    const file = this.options.files[agent]
    const result = agent === 'claude' ? installClaude(file, this.options.node) : installCopilot(file)
    this.answer(agent, 'enabled')
    return { ...this.status(agent, adopted), changed: result.changed, written: result.backup }
  }

  // Removes Grove's entries only. The recorded answer stays, so the app does not ask again by itself.
  uninstall(agent: IntegrationAgent, adopted: boolean): IntegrationInfo {
    const file = this.options.files[agent]
    if (agent === 'claude') uninstallClaude(file)
    else uninstallCopilot(file)
    return this.status(agent, adopted)
  }
}
