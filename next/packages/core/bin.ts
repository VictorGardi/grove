import { startCoreDaemon } from './daemon.ts'
import { ensureHolder } from './holder-client.ts'

async function main(): Promise<void> {
  await ensureHolder()
  const core = await startCoreDaemon()
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

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
