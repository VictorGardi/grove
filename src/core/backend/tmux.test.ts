import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, describe, expect, it } from 'vitest'
import { findTmux, minimalEnv } from '../env'
import { TmuxBackend } from './tmux'

const run = promisify(execFile)
const tmuxPath = findTmux(process.env)
const socket = `gt${process.pid}`
const env = minimalEnv(process.env)
const tmux = (...args: string[]) => run(tmuxPath!, ['-L', socket, ...args], { env })

describe.skipIf(!tmuxPath)('TmuxBackend', () => {
  const backend = new TmuxBackend({
    tmuxPath: tmuxPath!,
    socket,
    confPath: path.resolve('resources/tmux.conf'),
    env,
  })
  const create = (name: string) => backend.create({ name, cwd: os.tmpdir(), cols: 100, rows: 30 })

  afterAll(async () => {
    await tmux('kill-server').catch(() => {})
  })

  it('lists nothing when no server runs', async () => {
    expect(await backend.list()).toEqual(new Set())
    expect(await backend.cwds()).toEqual(new Map())
  })

  it('creates a session with the config file', async () => {
    await create('grove-a')
    expect((await backend.list()).has('grove-a')).toBe(true)
    const { stdout } = await tmux('show-options', '-g', 'history-limit')
    expect(stdout).toContain('50000')
  })

  it('re-sources the config when the server is up', async () => {
    await expect(backend.ensureConfig()).resolves.toBeUndefined()
  })

  it('kills sessions and ignores missing ones', async () => {
    await backend.kill('grove-a')
    expect((await backend.list()).has('grove-a')).toBe(false)
    await expect(backend.kill('grove-missing')).resolves.toBeUndefined()
  })

  it('attaches, gets output, and detaching leaves the session', async () => {
    await create('grove-b')
    const h = backend.attach('grove-b', 80, 24)
    const got = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), 3000)
      h.onData(() => { clearTimeout(t); resolve(true) })
    })
    expect(got).toBe(true)
    h.kill()
    h.kill()
    expect((await backend.list()).has('grove-b')).toBe(true)
  })

  it('targets sessions by exact name', async () => {
    await backend.kill('grove-b')
    await create('grove-abc')
    await backend.kill('grove-ab')
    expect((await backend.list()).has('grove-abc')).toBe(true)
  })

  it('reports each session\'s current directory', async () => {
    const cwds = await backend.cwds()
    expect(fs.realpathSync(cwds.get('grove-abc')!)).toBe(fs.realpathSync(os.tmpdir()))
  })

  it('sets pane colours for OSC 10/11', async () => {
    await create('grove-c')
    await backend.setColors('grove-c', '#d4d4d4', '#1e1e1e')
    const pane = await tmux('show-options', '-p', '-t', '=grove-c:', 'window-style').catch(() => ({ stdout: '' }))
    const win = await tmux('show-options', '-w', '-t', '=grove-c:', 'window-style').catch(() => ({ stdout: '' }))
    const out = (pane.stdout + win.stdout).toLowerCase()
    expect(out).toContain('#d4d4d4')
    expect(out).toContain('#1e1e1e')
  })
})
