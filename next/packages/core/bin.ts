import path from 'node:path'
import { connectRpc } from '../protocol/client.ts'
import { groveNextHome, holderSocketPath } from '../protocol/paths.ts'
import { startCoreDaemon } from './daemon.ts'
import { ensureHolder } from './holder-client.ts'
import { SpacesService } from './spaces.ts'

async function main(): Promise<void> {
  await ensureHolder()
  const spaces = new SpacesService(path.join(groveNextHome(), 'state.json'))
  await restoreTabs(spaces)
  const core = await startCoreDaemon({ spaces })
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
    const restored = await spaces.restore(holder)
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
