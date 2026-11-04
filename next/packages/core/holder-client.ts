import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectRpc } from '../protocol/client.ts'
import { holderSocketPath } from '../protocol/paths.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const RETRY_MS = 100
const TIMEOUT_MS = 5000

export interface EnsureHolderOptions {
  socketPath?: string
  nodePath?: string
  holderBin?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}

// Resolves when a holder answers on the socket. Returns the child only when this call started it.
export async function ensureHolder(options: EnsureHolderOptions = {}): Promise<ChildProcess | undefined> {
  const socketPath = options.socketPath ?? holderSocketPath()
  if (await canConnect(socketPath)) return undefined

  const holderBin = options.holderBin ?? path.join(here, '..', 'holder', 'bin.ts')
  const child = spawn(options.nodePath ?? process.execPath, ['--import', import.meta.resolve('tsx'), holderBin], {
    detached: true,
    stdio: 'ignore',
    env: options.env ?? process.env,
  })
  child.unref()
  let gone: string | undefined
  child.once('error', (error) => (gone = `failed to start: ${error.message}`))
  child.once('exit', (code, signal) => (gone = `exited (code ${code}, signal ${signal})`))

  const deadline = Date.now() + (options.timeoutMs ?? TIMEOUT_MS)
  for (;;) {
    if (await canConnect(socketPath)) return child
    if (gone) throw new Error(`holder ${gone} before listening on ${socketPath}`)
    if (Date.now() > deadline) {
      child.kill()
      throw new Error(`holder did not listen on ${socketPath} within ${options.timeoutMs ?? TIMEOUT_MS} ms`)
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS))
  }
}

function canConnect(socketPath: string): Promise<boolean> {
  return connectRpc(socketPath).then(
    (client) => {
      client.close()
      return true
    },
    () => false,
  )
}
