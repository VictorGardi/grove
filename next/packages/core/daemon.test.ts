import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RpcClient } from '../protocol/client.ts'
import { b64ToBytes, bytesToB64 } from '../protocol/framing.ts'
import { coreSocketPath } from '../protocol/paths.ts'
import { METHODS } from '../protocol/messages.ts'
import { connectWhenReady, killCore, startStack, stopHolder, waitFor } from './test-helpers.ts'

const screenText = async (client: RpcClient, id: string): Promise<string> => {
  const { screenB64 } = await client.request(METHODS.tabsAttach, { id })
  return b64ToBytes(screenB64).toString('utf8')
}

describe('core daemon', () => {
  let home: string
  let holder: ChildProcess | undefined
  let clients: RpcClient[] = []
  const savedHome = process.env.GROVE_NEXT_HOME

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-'))
    process.env.GROVE_NEXT_HOME = home
  })

  afterEach(async () => {
    for (const client of clients) client.close()
    clients = []
    await stopHolder(holder)
    holder = undefined
    if (savedHome === undefined) delete process.env.GROVE_NEXT_HOME
    else process.env.GROVE_NEXT_HOME = savedHome
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('keeps a tab alive when only the core is killed', async () => {
    const stack = await startStack()
    holder = stack.holder
    const first = stack.core
    clients.push(first)

    const { id } = await first.request(METHODS.tabsCreate, {
      command: '/bin/sh',
      cwd: home,
      cols: 80,
      rows: 24,
    })
    await first.request(METHODS.tabsWrite, { id, dataB64: bytesToB64(Buffer.from('echo mark-$((20+1))\n')) })
    await waitFor(
      () => screenText(first, id),
      (screen) => screen.includes('mark-21'),
    )

    first.close()
    clients = []
    await killCore(holder!)

    const next = await connectWhenReady(coreSocketPath())
    clients.push(next)
    const tabs = await next.request(METHODS.tabsList, {})
    expect(tabs).toContainEqual(expect.objectContaining({ id, alive: true }))
    expect(await screenText(next, id)).toContain('mark-21')
  })

  it('relays tab output and exit to an attached client', async () => {
    const stack = await startStack()
    holder = stack.holder
    const core = stack.core
    clients.push(core)

    const outputs: string[] = []
    const exits: Array<{ id: string; exitCode: number | null }> = []
    core.onNotification(METHODS.tabsOutput, (params) => outputs.push(b64ToBytes(params.dataB64).toString('utf8')))
    core.onNotification(METHODS.tabsExit, (params) => exits.push(params))

    const { id } = await core.request(METHODS.tabsCreate, { command: '/bin/sh', cwd: home, cols: 80, rows: 24 })
    await core.request(METHODS.tabsAttach, { id })
    await core.request(METHODS.tabsWrite, { id, dataB64: bytesToB64(Buffer.from('echo relay-$((6*7))\n')) })
    await waitFor(
      async () => outputs.join(''),
      (text) => text.includes('relay-42'),
    )

    await core.request(METHODS.tabsWrite, { id, dataB64: bytesToB64(Buffer.from('exit 3\n')) })
    await waitFor(
      async () => exits.length,
      (count) => count > 0,
    )
    expect(exits).toEqual([{ id, exitCode: 3 }])
  })
})
