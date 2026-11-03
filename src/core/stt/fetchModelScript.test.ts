import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const script = path.resolve(__dirname, '../../../scripts/stt-fetch-model.mjs')
let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-fetch-')) })
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const run = (args: string[], env: Record<string, string> = {}) =>
  spawnSync('node', [script, ...args], { env: { ...process.env, STT_TEST: '1', STT_MODEL_DIR: path.join(dir, 'models'), ...env }, encoding: 'utf8' })
const modelPath = () => path.join(dir, 'models', 'ggml-base.en.bin')

describe('stt-fetch-model.mjs --from', () => {
  it('rejects a tampered file and writes nothing at the model path', () => {
    const src = path.join(dir, 'src.bin')
    fs.writeFileSync(src, 'not the model')
    const r = run(['--from', src])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('expected a03779c8')
    expect(r.stderr).toContain('actual')
    expect(fs.existsSync(modelPath())).toBe(false)
    expect(fs.readdirSync(path.join(dir, 'models'))).toEqual([])
  })

  it('installs a file matching the hash, and is a no-op the second time', () => {
    const src = path.join(dir, 'src.bin')
    fs.writeFileSync(src, 'small model')
    const sha = crypto.createHash('sha256').update('small model').digest('hex')
    const r = run(['--from', src], { STT_MODEL_SHA256: sha })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain(sha)
    expect(fs.readFileSync(modelPath(), 'utf8')).toBe('small model')
    const again = run(['--from', src], { STT_MODEL_SHA256: sha })
    expect(again.status).toBe(0)
    expect(again.stdout).toContain('already installed')
  })

  it('ignores the test overrides without STT_TEST=1', () => {
    const src = path.join(dir, 'src.bin')
    fs.writeFileSync(src, 'small model')
    const sha = crypto.createHash('sha256').update('small model').digest('hex')
    const r = run(['--from', src], { STT_TEST: '0', STT_MODEL_SHA256: sha, HOME: dir, XDG_CONFIG_HOME: dir, APPDATA: dir })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('expected a03779c8')
    expect(fs.existsSync(modelPath())).toBe(false)
  })
})
