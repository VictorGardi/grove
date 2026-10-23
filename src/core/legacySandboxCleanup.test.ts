import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runLegacySandboxCleanup, type Run } from './legacySandboxCleanup'

let dir: string
let markerPath: string
let configFile: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-cleanup-'))
  markerPath = path.join(dir, 'data', 'sandbox-cleanup.done')
  configFile = path.join(dir, 'service.json')
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const nets = (gw: string) => JSON.stringify([{ configuration: { name: 'default' }, status: { ipv4Gateway: gw } }])

function fake(out: Record<string, { ok: boolean; stdout?: string }> = {}) {
  const calls: string[] = []
  const markerAtCall: boolean[] = []
  const run: Run = async (cmd, args) => {
    const key = args.join(' ')
    calls.push(`${cmd} ${key}`)
    markerAtCall.push(fs.existsSync(markerPath))
    const r = out[key]
    return r ? { ok: r.ok, stdout: r.stdout ?? '' } : { ok: false, stdout: '' }
  }
  return { run, calls, markerAtCall }
}

describe('runLegacySandboxCleanup', () => {
  it('removes only grove- containers and grove-sandbox: images', async () => {
    const f = fake({
      'list --all --quiet': { ok: true, stdout: 'grove-a\nother\ngrove-b\n' },
      'image ls --quiet': { ok: true, stdout: 'grove-sandbox:latest\nalpine:3\ngrove-sandbox:v2\n' },
    })
    await runLegacySandboxCleanup({ markerPath, configFile, run: f.run })
    const rm = f.calls.filter((c) => / rm /.test(c))
    expect(rm).toEqual(['container rm -f grove-a', 'container rm -f grove-b', 'container image rm grove-sandbox:latest', 'container image rm grove-sandbox:v2'])
  })

  it('finishes and writes the marker when container is missing', async () => {
    const f = fake()
    await expect(runLegacySandboxCleanup({ markerPath, configFile, run: f.run })).resolves.toBeUndefined()
    expect(fs.existsSync(markerPath)).toBe(true)
  })

  it('writes the marker when a call fails or times out', async () => {
    const f = fake({ 'list --all --quiet': { ok: false }, 'image ls --quiet': { ok: true, stdout: 'grove-sandbox:x' } })
    await runLegacySandboxCleanup({ markerPath, configFile, run: f.run })
    expect(fs.existsSync(markerPath)).toBe(true)
  })

  it('removes a hostname equal to the gateway and keeps other keys', async () => {
    fs.writeFileSync(configFile, JSON.stringify({ hostname: '192.168.64.1', password: 'pw', port: 4096 }))
    const f = fake({ 'network ls --format json': { ok: true, stdout: nets('192.168.64.1') } })
    await runLegacySandboxCleanup({ markerPath, configFile, run: f.run })
    const raw = fs.readFileSync(configFile, 'utf8')
    expect(JSON.parse(raw)).toEqual({ password: 'pw', port: 4096 })
    expect(raw.endsWith('\n')).toBe(true)
  })

  it('leaves a different hostname alone', async () => {
    const text = JSON.stringify({ hostname: '10.0.0.5', password: 'pw' })
    fs.writeFileSync(configFile, text)
    const f = fake({ 'network ls --format json': { ok: true, stdout: nets('192.168.64.1') } })
    await runLegacySandboxCleanup({ markerPath, configFile, run: f.run })
    expect(fs.readFileSync(configFile, 'utf8')).toBe(text)
  })

  it('makes zero calls when the marker exists, and on a second invocation', async () => {
    const f = fake()
    await runLegacySandboxCleanup({ markerPath, configFile, run: f.run })
    const n = f.calls.length
    expect(n).toBeGreaterThan(0)
    await runLegacySandboxCleanup({ markerPath, configFile, run: f.run })
    expect(f.calls.length).toBe(n)
    const g = fake()
    fs.writeFileSync(markerPath, 'x')
    await runLegacySandboxCleanup({ markerPath, configFile, run: g.run })
    expect(g.calls).toEqual([])
  })

  it('writes the marker after every attempt', async () => {
    const f = fake({
      'list --all --quiet': { ok: true, stdout: 'grove-a' },
      'image ls --quiet': { ok: true, stdout: 'grove-sandbox:l' },
      'network ls --format json': { ok: true, stdout: nets('1.2.3.4') },
    })
    await runLegacySandboxCleanup({ markerPath, configFile, run: f.run })
    expect(f.calls.length).toBe(5)
    expect(f.markerAtCall.every((m) => !m)).toBe(true)
    expect(fs.existsSync(markerPath)).toBe(true)
  })

  it('finishes with the real runner when the binary does not exist', async () => {
    await runLegacySandboxCleanup({ markerPath, configFile, container: path.join(dir, 'nope') })
    expect(fs.existsSync(markerPath)).toBe(true)
  })
})
