import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, type ChildProcess } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { connectRpc, type RpcClient } from '../protocol/client.ts'
import { holderSocketPath } from '../protocol/paths.ts'
import { METHODS } from '../protocol/messages.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const holderBin = path.join(here, 'bin.ts')
const fakeCore = path.join(here, 'testdata', 'fake-core.mjs')

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 8000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (done(value) || Date.now() > deadline) return value
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

describe('holder', () => {
  let home: string
  let holder: ChildProcess | undefined
  let client: RpcClient | undefined
  const savedHome = process.env.GROVE_NEXT_HOME

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-'))
    process.env.GROVE_NEXT_HOME = home
  })

  afterEach(async () => {
    client?.close()
    client = undefined
    if (holder && holder.exitCode === null) {
      holder.kill('SIGTERM')
      await new Promise((resolve) => holder!.once('exit', resolve))
    }
    holder = undefined
    if (savedHome === undefined) delete process.env.GROVE_NEXT_HOME
    else process.env.GROVE_NEXT_HOME = savedHome
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('keeps its PTYs and accepts clients while the core restarts', async () => {
    holder = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), holderBin], {
      env: { ...process.env, GROVE_NEXT_HOME: home, GROVE_NEXT_CORE_CMD: `${process.execPath} ${fakeCore}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const socketPath = holderSocketPath()
    await waitFor(
      async () => fs.existsSync(socketPath),
      (exists) => exists,
    )

    client = await connectRpc(socketPath)
    const { id } = await client.request(METHODS.tabsCreate, {
      id: 'survivor',
      command: '/bin/sh',
      args: ['-c', 'sleep 30'],
      cwd: home,
      cols: 80,
      rows: 24,
    })

    const starts = path.join(home, 'starts')
    await waitFor(
      async () => (fs.existsSync(starts) ? fs.readFileSync(starts, 'utf8').trim().split('\n').length : 0),
      (count) => count >= 2,
    )

    const tabs = await client.request(METHODS.tabsList, {})
    expect(tabs).toContainEqual(expect.objectContaining({ id, alive: true }))

    const { protocolVersion } = await client.request(METHODS.corePing, {})
    expect(protocolVersion).toBe(1)
    expect(holder.exitCode).toBeNull()

    await client.request(METHODS.tabsKill, { id })
  })
})
