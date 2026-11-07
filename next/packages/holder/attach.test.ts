import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { connectRpc, type RpcClient } from '../protocol/client.ts'
import { b64ToBytes } from '../protocol/framing.ts'
import { holderSocketPath } from '../protocol/paths.ts'
import { METHODS } from '../protocol/messages.ts'
import { PtyTable } from './pty-table.ts'
import { startHolderServer, type HolderServer } from './server.ts'

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 8000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (done(value) || Date.now() > deadline) return value
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

function countLine(text: string, n: number): number {
  return text.match(new RegExp(`line${n}\\r`, 'g'))?.length ?? 0
}

interface Observed {
  output: string
  exits: Array<{ id: string; exitCode: number | null }>
  statuses: Array<{ id: string; state: string; kind?: string }>
}

function observe(client: RpcClient): Observed {
  const observed: Observed = { output: '', exits: [], statuses: [] }
  client.onNotification(METHODS.tabsOutput, (params) => {
    observed.output += b64ToBytes(params.dataB64).toString('utf8')
  })
  client.onNotification(METHODS.tabsExit, (params) => {
    observed.exits.push(params)
  })
  client.onNotification(METHODS.tabsStatus, (params) => {
    observed.statuses.push(params)
  })
  return observed
}

describe('holder attach', () => {
  let home: string
  let server: HolderServer | undefined
  const clients: RpcClient[] = []
  const savedHome = process.env.GROVE_NEXT_HOME

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-'))
    process.env.GROVE_NEXT_HOME = home
  })

  afterEach(async () => {
    for (const client of clients.splice(0)) client.close()
    if (server) {
      server.table.killAll()
      await server.close()
    }
    server = undefined
    if (savedHome === undefined) delete process.env.GROVE_NEXT_HOME
    else process.env.GROVE_NEXT_HOME = savedHome
    fs.rmSync(home, { recursive: true, force: true })
  })

  async function startTab(): Promise<{ id: string; socketPath: string }> {
    const socketPath = holderSocketPath()
    server = await startHolderServer({ socketPath, table: new PtyTable() })
    const client = await connectRpc(socketPath)
    clients.push(client)
    const { id } = await client.request(METHODS.tabsCreate, {
      id: `tab-${randomUUID().slice(0, 8)}`,
      command: '/bin/sh',
      args: [
        '-c',
        'i=0; while [ $i -lt 40 ]; do echo line$i; i=$((i+1)); sleep 0.02; done; exit 7',
      ],
      cwd: home,
      cols: 80,
      rows: 24,
    })
    return { id, socketPath }
  }

  async function expectNoDuplicates(observed: Observed) {
    await waitFor(
      async () => observed.exits.length,
      (count) => count >= 1,
    )
    // Give any duplicate notification queued behind the reply time to arrive.
    await new Promise((resolve) => setTimeout(resolve, 200))
    for (let n = 0; n < 40; n++) {
      expect(countLine(observed.output, n), `line${n} count`).toBeLessThanOrEqual(1)
    }
    expect(countLine(observed.output, 39), 'line39 count').toBe(1)
    expect(observed.exits).toEqual([{ id: expect.any(String), exitCode: 7 }])
  }

  it('does not duplicate output when one connection re-attaches a tab many times at once', async () => {
    const { id } = await startTab()
    const client = clients[0]
    const observed = observe(client)
    await Promise.all(Array.from({ length: 10 }, () => client.request(METHODS.tabsAttach, { id })))
    await expectNoDuplicates(observed)
  })

  it('does not duplicate output when two connections each re-attach a tab at once', async () => {
    const { id, socketPath } = await startTab()
    const first = clients[0]
    const second = await connectRpc(socketPath)
    clients.push(second)
    const observedFirst = observe(first)
    const observedSecond = observe(second)
    await Promise.all([
      ...Array.from({ length: 5 }, () => first.request(METHODS.tabsAttach, { id })),
      ...Array.from({ length: 5 }, () => second.request(METHODS.tabsAttach, { id })),
    ])
    await expectNoDuplicates(observedFirst)
    await expectNoDuplicates(observedSecond)
  })

  it('answers OSC 7501 queries and broadcasts root status reports without an attachment', async () => {
    const socketPath = holderSocketPath()
    server = await startHolderServer({ socketPath, table: new PtyTable() })
    const client = await connectRpc(socketPath)
    clients.push(client)
    const observed = observe(client)
    const { id } = await client.request(METHODS.tabsCreate, {
      command: '/bin/sh',
      args: [
        '-c',
        "stty -echo -icanon; printf '\\033]7501;?\\033\\\\'; dd bs=1 count=10 2>/dev/null | od -An -tx1; printf '\\033]7501;id=ses_child;state=working\\033\\\\'; printf '\\033]7501;state=working\\033\\\\'; sleep 0.1; printf '\\033]7501;state=idle\\033\\\\'; sleep 5",
      ],
      cwd: home,
      cols: 80,
      rows: 24,
    })

    await waitFor(async () => observed.statuses.length, (count) => count === 2)
    const screen = await waitFor(
      async () => (await client.request(METHODS.tabsScreen, { id })).text,
      (text) => /1b\s+5d\s+37\s+35\s+30\s+31\s+3b\s+3f\s+1b\s+5c/.test(text),
    )
    expect(observed.statuses).toEqual([
      { id, state: 'working' },
      { id, state: 'idle' },
    ])
    expect(screen).toMatch(/1b\s+5d\s+37\s+35\s+30\s+31\s+3b\s+3f\s+1b\s+5c/)
  })
})
