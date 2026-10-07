import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { request } from './client'

const req = { v: 1 as const, id: 'r1', method: 'sessions.list' as const, params: {} }

describe('request', () => {
  const servers: net.Server[] = []
  afterEach(() => { for (const s of servers.splice(0)) s.close() })
  const sock = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-')), 'g.sock')

  it('round-trips one JSON line', async () => {
    const p = sock()
    const server = net.createServer((c) => c.on('data', (d) => {
      const r = JSON.parse(d.toString())
      c.end(JSON.stringify({ id: r.id, ok: true, data: [1] }) + '\n')
    }))
    servers.push(server)
    await new Promise<void>((r) => server.listen(p, r))
    expect(await request(p, req)).toEqual({ id: 'r1', ok: true, data: [1] })
  })

  it('ENOENT → not-running (exit 3)', async () => {
    const reply = await request(sock(), req)
    expect(reply).toMatchObject({ ok: false, error: { code: 'not-running' } })
  })

  it('a stale socket file (ECONNREFUSED) → not-running', async () => {
    const p = sock()
    const server = net.createServer()
    await new Promise<void>((r) => server.listen(p, r))
    // closing the server unlinks the file; recreate a dead file the way a crash leaves it
    const raw = net.createServer()
    await new Promise<void>((r) => raw.listen(p + '2', r))
    ;(raw as unknown as { _handle: { close(): void } })._handle.close()
    server.close()
    expect(await request(p + '2', req)).toMatchObject({ ok: false, error: { code: 'not-running' } })
  })
})
