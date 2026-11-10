import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startHolderServer } from './server.ts'

const MIN_RESTART_MS = 250
const MAX_RESTART_MS = 8000
const STABLE_MS = 10000

function coreCommand(): { command: string; args: string[] } {
  const configured = process.env.GROVE_CORE_CMD?.trim()
  if (configured) {
    const [command, ...args] = configured.split(/\s+/)
    return { command: command!, args }
  }
  const coreBin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'core', 'bin.ts')
  return { command: process.execPath, args: ['--import', import.meta.resolve('tsx'), coreBin] }
}

function superviseCore(): () => void {
  const { command, args } = coreCommand()
  let child: ChildProcess | undefined
  let restartMs = MIN_RESTART_MS
  let stopping = false

  const start = () => {
    const current = spawn(command, args, { stdio: 'inherit', env: process.env })
    child = current
    const stable = setTimeout(() => {
      restartMs = MIN_RESTART_MS
    }, STABLE_MS)
    let gone = false
    const onGone = (detail: string) => {
      if (gone) return
      gone = true
      clearTimeout(stable)
      if (stopping) return
      console.error(`holder: core ${detail}, restarting in ${restartMs} ms`)
      setTimeout(start, restartMs)
      restartMs = Math.min(restartMs * 2, MAX_RESTART_MS)
    }
    current.on('exit', (code, signal) => onGone(`exited (code ${code}, signal ${signal})`))
    current.on('error', (error) => onGone(`failed to start: ${error.message}`))
  }

  start()
  return () => {
    stopping = true
    child?.kill()
  }
}

async function main(): Promise<void> {
  const server = await startHolderServer()
  const stopCore = superviseCore()
  console.log(`holder: listening on ${server.socketPath}`)

  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    stopCore()
    server.table.killAll()
    await server.close()
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
