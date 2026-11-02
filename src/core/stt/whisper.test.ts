import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanStaleWavs, parseWhisperOutput, pcmToWav, transcribe, type ExecFile } from './whisper'

describe('pcmToWav', () => {
  it('writes a 44-byte 16 kHz mono 16-bit header before the samples', () => {
    const wav = pcmToWav(new Uint8Array([1, 2, 3, 4]))
    expect(wav.length).toBe(48)
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.readUInt32LE(4)).toBe(40)
    expect(wav.toString('ascii', 8, 16)).toBe('WAVEfmt ')
    expect(wav.readUInt16LE(20)).toBe(1)
    expect(wav.readUInt16LE(22)).toBe(1)
    expect(wav.readUInt32LE(24)).toBe(16000)
    expect(wav.readUInt32LE(28)).toBe(32000)
    expect(wav.readUInt16LE(34)).toBe(16)
    expect(wav.toString('ascii', 36, 40)).toBe('data')
    expect(wav.readUInt32LE(40)).toBe(4)
    expect([...wav.subarray(44)]).toEqual([1, 2, 3, 4])
  })

  it('respects a view into a larger buffer', () => {
    const big = new Uint8Array([9, 9, 5, 6, 9])
    expect([...pcmToWav(big.subarray(2, 4)).subarray(44)]).toEqual([5, 6])
  })
})

describe('parseWhisperOutput', () => {
  it('trims and joins lines', () => {
    expect(parseWhisperOutput('\n  hello there \n\n world\n')).toBe('hello there world')
  })
  it('is empty for blank output', () => {
    expect(parseWhisperOutput(' \n')).toBe('')
  })
  it('drops noise tokens', () => {
    expect(parseWhisperOutput(' [BLANK_AUDIO]\n')).toBe('')
    expect(parseWhisperOutput('(keyboard clicking)')).toBe('')
    expect(parseWhisperOutput('[ Silence ]\n(music)')).toBe('')
    expect(parseWhisperOutput('hello [BLANK_AUDIO] world')).toBe('hello world')
  })
})

describe('transcribe', () => {
  let dir: string
  let model: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-test-'))
    model = path.join(dir, 'model.bin')
    fs.writeFileSync(model, 'x')
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  const tmpDir = () => path.join(dir, 'tmp')
  const deps = (execFile: ExecFile) => ({ execFile, whisperBin: () => '/bin/whisper-cli', modelPath: model, tmpDir: tmpDir() })

  it('runs whisper-cli with english, no timestamps, returns trimmed text and deletes the wav', async () => {
    let seen: { file: string; args: string[]; timeout: number } | undefined
    let wavExisted = false
    const exec: ExecFile = async (file, args, opts) => {
      seen = { file, args, timeout: opts.timeout }
      wavExisted = fs.existsSync(args[3])
      return { stdout: ' hello world \n' }
    }
    expect(await transcribe(deps(exec), new Uint8Array(4))).toBe('hello world')
    expect(seen!.file).toBe('/bin/whisper-cli')
    expect(seen!.args).toEqual(['-m', model, '-f', seen!.args[3], '-l', 'en', '-t', '4', '-nt', '-np'])
    expect(seen!.args[3]).toMatch(/\.wav$/)
    expect(seen!.timeout).toBe(30000)
    expect(wavExisted).toBe(true)
    expect(fs.readdirSync(tmpDir())).toEqual([])
  })

  it('returns an empty text for empty output', async () => {
    expect(await transcribe(deps(async () => ({ stdout: '\n' })), new Uint8Array(2))).toBe('')
  })

  it('returns an empty text for blank-audio output', async () => {
    expect(await transcribe(deps(async () => ({ stdout: ' [BLANK_AUDIO]\n' })), new Uint8Array(2))).toBe('')
  })

  it('rejects on failure and still deletes the wav', async () => {
    await expect(transcribe(deps(async () => { throw new Error('exit 1') }), new Uint8Array(2))).rejects.toThrow('exit 1')
    expect(fs.readdirSync(tmpDir())).toEqual([])
  })

  it('rejects when the binary or model is missing', async () => {
    const exec: ExecFile = async () => ({ stdout: 'x' })
    await expect(transcribe({ ...deps(exec), whisperBin: () => null }, new Uint8Array(2))).rejects.toThrow(/^no-binary: whisper-cli not found on PATH/)
    await expect(transcribe({ ...deps(exec), modelPath: path.join(dir, 'nope') }, new Uint8Array(2))).rejects.toThrow(`no-model: ${path.join(dir, 'nope')}`)
  })
})

describe('cleanStaleWavs', () => {
  it('removes wavs, keeps other files, and ignores a missing dir', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-clean-'))
    try {
      fs.writeFileSync(path.join(dir, 'a.wav'), 'x')
      fs.writeFileSync(path.join(dir, 'b.wav'), 'x')
      fs.writeFileSync(path.join(dir, 'keep.txt'), 'x')
      cleanStaleWavs(dir)
      expect(fs.readdirSync(dir)).toEqual(['keep.txt'])
      expect(() => cleanStaleWavs(path.join(dir, 'nope'))).not.toThrow()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
