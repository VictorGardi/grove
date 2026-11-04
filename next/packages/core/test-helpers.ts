import { execFileSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { connectRpc, type RpcClient } from '../protocol/client.ts'
import { coreSocketPath } from '../protocol/paths.ts'
import { ensureHolder } from './holder-client.ts'

export async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 8000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (done(value) || Date.now() > deadline) return value
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

export async function connectWhenReady(socketPath: string, timeoutMs = 8000): Promise<RpcClient> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      return await connectRpc(socketPath)
    } catch (error) {
      if (Date.now() > deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
}

// Starts a holder (which supervises the core) and waits until the core answers.
export async function startStack(): Promise<{ holder: ChildProcess | undefined; core: RpcClient }> {
  const holder = await ensureHolder()
  const core = await connectWhenReady(coreSocketPath())
  return { holder, core }
}

export async function stopHolder(holder: ChildProcess | undefined): Promise<void> {
  if (!holder || holder.exitCode !== null || holder.signalCode !== null) return
  holder.kill('SIGTERM')
  await new Promise((resolve) => holder.once('exit', resolve))
}

// The holder's child whose command line is the core bin (its PTY shells are other children).
export function corePidOf(holder: ChildProcess): number {
  return Number(execFileSync('pgrep', ['-P', String(holder.pid), '-f', 'core/bin.ts']).toString().trim())
}

// SIGKILL is asynchronous: wait until the holder has reaped the core, or a connect can land on the dying listener.
export async function killCore(holder: ChildProcess): Promise<void> {
  const pid = corePidOf(holder)
  process.kill(pid, 'SIGKILL')
  await waitFor(
    async () => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    },
    (alive) => !alive,
  )
}
