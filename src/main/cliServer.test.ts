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
  it('writes an executable script that runs the cli on Electron as Node', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-'))
    const file = writeLauncher({ binDir: path.join(dir, 'bin'), execPath: '/E x/electron', cliPath: '/app/out/main/cli.js', socketPath: '/s/grove.sock' })
    expect(fs.statSync(file).mode & 0o777).toBe(0o755)
    const text = fs.readFileSync(file, 'utf8')
    expect(text).toContain(`ELECTRON_RUN_AS_NODE=1 exec '/E x/electron' '/app/out/main/cli.js' "$@"`)
    expect(text).toContain(`GROVE_SOCKET:='/s/grove.sock'`)
  })
})
