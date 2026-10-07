import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { request } from '../cli/client'
import type { CliSession } from '@shared/cli'
import { createTerminal, setupCore } from '../core/testing/setup'
import { startCliServer } from './cliServer'
import { writeLauncher } from './launcher'

describe('cli server', () => {
  const t = setupCore()
  const closers: (() => void)[] = []
  afterEach(() => {
    t.disposeAll()
    for (const c of closers.splice(0)) c()
  })

  async function start() {
    const core = t.make()
    await core.start()
    const socketPath = path.join(t.dir, 'grove.sock')
    const server = await startCliServer(core, { socketPath, raise: () => {} })
    closers.push(() => server.close())
    return { core, socketPath, server }
  }
  const req = (method: string, params: unknown = {}, v: number = 1) => ({ v, id: 'r', method, params }) as never

  it('lists live sessions as CliSession with the project name; all includes gone', async () => {
    const { core, socketPath } = await start()
    const live = await createTerminal(core)
    const dead = await createTerminal(core)
    await core.commands.sessionKill({ id: dead.id })
    const reply = await request(socketPath, req('sessions.list'))
    expect(reply.ok && (reply.data as CliSession[]).map((s) => [s.id, s.project, s.lastStatus])).toEqual([[live.id, 'proj', 'running']])
    const all = await request(socketPath, req('sessions.list', { all: true }))
    expect(all.ok && (all.data as CliSession[]).map((s) => s.id).sort()).toEqual([live.id, dead.id].sort())
  })

  it('rejects another protocol version and unknown methods', async () => {
    const { socketPath } = await start()
    expect(await request(socketPath, req('sessions.list', {}, 2))).toMatchObject({ ok: false, error: { code: 'bad-version' } })
    expect(await request(socketPath, req('nope'))).toMatchObject({ ok: false, error: { code: 'bad-method' } })
  })

  it('creates the socket as 0600 and removes it on close', async () => {
    const { socketPath, server } = await start()
    expect(fs.statSync(socketPath).mode & 0o777).toBe(0o600)
    server.close()
    expect(fs.existsSync(socketPath)).toBe(false)
  })
})

describe('writeLauncher', () => {
  const setup = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-'))
    const fakeExec = path.join(dir, 'E x') // a space, as in "Application Support"
    fs.writeFileSync(fakeExec, '#!/bin/sh\necho "$GROVE_SOCKET|$ELECTRON_RUN_AS_NODE|$*"\n', { mode: 0o755 })
    const file = writeLauncher({ binDir: path.join(dir, 'bin'), execPath: fakeExec, cliPath: '/app/out/main/cli.js', socketPath: '/s p/grove.sock' })
    return file
  }

  it('is executable and runs the cli on Electron as Node, with the socket defaulted unquoted', () => {
    const file = setup()
    expect(fs.statSync(file).mode & 0o777).toBe(0o755)
    const out = execFileSync(file, ['ls', '--all'], { env: { PATH: '/usr/bin:/bin' } }).toString().trim()
    expect(out).toBe('/s p/grove.sock|1|/app/out/main/cli.js ls --all')
  })

  it('keeps a GROVE_SOCKET that is already set', () => {
    const out = execFileSync(setup(), [], { env: { PATH: '/usr/bin:/bin', GROVE_SOCKET: '/other.sock' } }).toString().trim()
    expect(out.startsWith('/other.sock|')).toBe(true)
  })
})
