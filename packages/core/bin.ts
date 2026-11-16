import path from 'node:path'
import { connectRpc } from '../protocol/client.ts'
import { groveHome, holderSocketPath } from '../protocol/paths.ts'
import { startCoreDaemon } from './daemon.ts'
import { claudeProjectsDir } from './agents/claude/launch.ts'
import { copilotHomeDir } from './agents/copilot/adapter.ts'
import { configFolder } from './config/store.ts'
import { ensureHolder } from './holder-client.ts'
import { SpacesService } from './spaces.ts'
import { createClaudeReader } from './usage/claude.ts'
import { createCopilotReader } from './usage/copilot.ts'
import { UsageService } from './usage/service.ts'

async function main(): Promise<void> {
  await ensureHolder()
  const spaces = new SpacesService(path.join(groveHome(), 'state.json'))
  await restoreTabs(spaces)
  const usage = new UsageService({
    home: groveHome(),
    spaces: () => spaces.ids().flatMap((id) => spaces.spaceById(id)?.path ?? []),
    readers: [createClaudeReader({ projectsDir: claudeProjectsDir() }), createCopilotReader({ copilotHome: copilotHomeDir() })],
  })
  const core = await startCoreDaemon({ spaces, usage })
  console.log(`core: listening on ${core.socketPath}`)

  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    await core.close()
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())
}

// A failed restore is logged and the core starts anyway.
async function restoreTabs(spaces: SpacesService): Promise<void> {
  let holder: Awaited<ReturnType<typeof connectRpc>> | undefined
  try {
    holder = await connectRpc(holderSocketPath())
    const restored = await spaces.restore(holder, { GROVE_CONFIG: configFolder(groveHome()) })
    if (restored > 0) console.log(`core: restored ${restored} tab(s)`)
  } catch (error) {
    console.error(`core: restore failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    holder?.close()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
