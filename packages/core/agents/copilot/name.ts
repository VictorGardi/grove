import fs from 'node:fs'
import path from 'node:path'
import { cleanName, nameReporter, NAME_POLL_MS, poll } from '../nameSource.ts'

export interface CopilotNameSource {
  drain: () => void
  close: () => void
}

// The `name:` line of Copilot's workspace.yaml, as Copilot or the human last set it. Undefined while the file or the line
// is missing, which is until Copilot has named the session.
export function readCopilotName(workspaceFile: string): string | undefined {
  let text: string
  try {
    text = fs.readFileSync(workspaceFile, 'utf8')
  } catch {
    return undefined
  }
  const match = /^name:[ \t]*(.+)$/m.exec(text)
  return cleanName(match?.[1].trim().replace(/^(['"])(.*)\1$/, '$2'))
}

export function createCopilotNameSource(options: { copilotHome: string; sessionId: string; onName: (name: string) => void; intervalMs?: number }): CopilotNameSource {
  const report = nameReporter('Copilot', options.onName)
  const file = path.join(options.copilotHome, 'session-state', options.sessionId, 'workspace.yaml')
  const drain = (): void => report(readCopilotName(file))
  const timer = poll(drain, { immediate: true, intervalMs: options.intervalMs ?? NAME_POLL_MS })
  return { drain, close: timer.stop }
}
