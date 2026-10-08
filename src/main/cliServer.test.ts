import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { request } from '../cli/client'
import type { CliSession } from '@shared/cli'
import { createOpenCode, createTerminal, LATER, setupCore } from '../core/testing/setup'
import { startCliServer } from './cliServer'
import { installCommandLineTool, writeLauncher } from './launcher'

describe('cli server', () => {
  let t: ReturnType<typeof setupCore>
  beforeEach(() => { t = setupCore() })
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

  it('creates a session in a subfolder and refuses an unknown feature', async () => {
    const { core, socketPath } = await start()
    fs.mkdirSync(path.join(t.dir, 'sub'))
    const ok = await request(socketPath, req('sessions.create', { kind: 'terminal', cwd: path.join(t.dir, 'sub'), label: 'helper' }))
    expect(ok.ok && ok.data).toMatchObject({ kind: 'terminal', label: 'helper', project: 'proj', cwd: fs.realpathSync(path.join(t.dir, 'sub')) })
    expect(core.getSlices().sessions).toHaveLength(1)
    const bad = await request(socketPath, req('sessions.create', { kind: 'terminal', cwd: t.dir, feature: 'nope' }))
    expect(bad).toMatchObject({ ok: false, error: { code: 'no-feature' } })
    expect(core.getSlices().sessions).toHaveLength(1)
    expect(await request(socketPath, req('sessions.create', { kind: 'vim', cwd: t.dir }))).toMatchObject({ ok: false, error: { code: 'bad-params' } })
  })

  it('sends text to a session by id prefix and reads its pane', async () => {
    const { core, socketPath } = await start()
    const s = await createTerminal(core)
    expect(await request(socketPath, req('sessions.send', { ref: s.id.slice(0, 6), text: 'hi', submit: false }))).toMatchObject({ ok: true })
    expect(t.fake.pastes).toEqual([{ name: s.tmuxName, text: 'hi', submit: false }])
    await request(socketPath, req('sessions.send', { ref: s.id, text: 'yo', submit: true }))
    expect(t.fake.pastes[1]).toMatchObject({ text: 'yo', submit: true })
    expect(await request(socketPath, req('sessions.send', { ref: 'nope', text: 'x', submit: true }))).toMatchObject({ ok: false, error: { code: 'not-found' } })
    expect(await request(socketPath, req('sessions.send', { ref: s.id }))).toMatchObject({ ok: false, error: { code: 'bad-params' } })
    t.fake.captured.set(s.tmuxName, 'line1\nline2\n')
    expect(await request(socketPath, req('sessions.read', { ref: s.id, lines: 40 }))).toMatchObject({ ok: true, data: { text: 'line1\nline2\n' } })
    expect(await request(socketPath, req('sessions.read', { ref: s.id }))).toMatchObject({ ok: false, error: { code: 'bad-params' } })
  })

  it('waits: idle agent returns at once, terminal has no status, send --wait follows the turn, timeout is an error', async () => {
    const core = t.make()
    await core.start()
    t.oc.emit({ type: 'connected', version: '2.0.20' })
    const socketPath = path.join(t.dir, 'grove.sock')
    closers.push((await startCliServer(core, { socketPath, raise: () => {} })).close)
    const o = await createOpenCode(core)
    const term = await createTerminal(core)
    expect(await request(socketPath, req('sessions.wait', { ref: o.id }))).toMatchObject({ ok: true, data: { id: o.id, status: 'idle' } })
    expect(await request(socketPath, req('sessions.wait', { ref: term.id }))).toMatchObject({ ok: false, error: { code: 'no-status' } })
    const sent = request(socketPath, req('sessions.send', { ref: o.id, text: 'go', submit: true, wait: true, timeoutS: 5 }))
    await vi.waitFor(() => expect(t.fake.pastes).toHaveLength(1))
    t.oc.emit({ type: 'exec-started', sessionId: o.agentSessionId! })
    t.oc.emit({ type: 'exec-ended', sessionId: o.agentSessionId!, at: LATER.toISOString() })
    expect(await sent).toMatchObject({ ok: true, data: { id: o.id, turn: { status: 'idle' } } })
    t.oc.emit({ type: 'exec-started', sessionId: o.agentSessionId! })
    const slow = await request(socketPath, req('sessions.wait', { ref: o.id, timeoutS: 0.05 }))
    expect(slow).toMatchObject({ ok: false, error: { code: 'timeout' } })
  })

  it('focus raises the window and shows the session; kill ends it', async () => {
    const core = t.make()
    await core.start()
    let raised = 0
    const socketPath = path.join(t.dir, 'grove.sock')
    closers.push((await startCliServer(core, { socketPath, raise: () => void raised++ })).close)
    const s = await createTerminal(core)
    expect(await request(socketPath, req('sessions.focus', { ref: s.id.slice(0, 5) }))).toMatchObject({ ok: true, data: { id: s.id } })
    expect(raised).toBe(1)
    expect(core.getSlices().ui.focusedSessionId).toBe(s.id)
    expect(await request(socketPath, req('sessions.kill', { ref: s.id }))).toMatchObject({ ok: true, data: { id: s.id } })
    expect(core.getSlices().sessions.find((x) => x.id === s.id)?.lastStatus).toBe('gone')
    expect(t.fake.live.has(s.tmuxName)).toBe(false)
    for (const m of ['sessions.focus', 'sessions.kill']) {
      expect(await request(socketPath, req(m, { ref: 'nope' }))).toMatchObject({ ok: false, error: { code: 'not-found' } })
    }
    expect(raised).toBe(1)
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

describe('installCommandLineTool', () => {
  const setup = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-'))
    const launcher = path.join(dir, 'bin', 'grove')
    fs.mkdirSync(path.dirname(launcher))
    fs.writeFileSync(launcher, '#!/bin/sh\n', { mode: 0o755 })
    return { dir, launcher, targetDir: path.join(dir, 'local', 'bin') }
  }

  it('links the launcher, creating the directory, and reports whether it is on PATH', () => {
    const { launcher, targetDir } = setup()
    const res = installCommandLineTool({ launcher, targetDir, pathVar: `/usr/bin:${targetDir}` })
    expect(res).toEqual({ ok: true, target: path.join(targetDir, 'grove'), onPath: true })
    expect(fs.readlinkSync(path.join(targetDir, 'grove'))).toBe(launcher)
    expect(installCommandLineTool({ launcher, targetDir, pathVar: '/usr/bin' })).toMatchObject({ ok: true, onPath: false })
  })

  it('replaces a stale symlink but refuses a regular file', () => {
    const { dir, launcher, targetDir } = setup()
    fs.mkdirSync(targetDir, { recursive: true })
    fs.symlinkSync(path.join(dir, 'gone'), path.join(targetDir, 'grove'))
    expect(installCommandLineTool({ launcher, targetDir, pathVar: '' })).toMatchObject({ ok: true })
    expect(fs.readlinkSync(path.join(targetDir, 'grove'))).toBe(launcher)
    fs.rmSync(path.join(targetDir, 'grove'))
    fs.writeFileSync(path.join(targetDir, 'grove'), 'mine')
    expect(installCommandLineTool({ launcher, targetDir, pathVar: '' })).toMatchObject({ ok: false })
    expect(fs.readFileSync(path.join(targetDir, 'grove'), 'utf8')).toBe('mine')
  })
})
