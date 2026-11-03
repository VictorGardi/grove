import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const RATE = 16_000
export const MODEL_BYTES = 147_964_211 // ggml-base.en.bin

// A canonical 44-byte RIFF header in front of 16 kHz mono signed 16-bit little-endian samples.
export function pcmToWav(pcm: Uint8Array): Buffer {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + pcm.byteLength, 4)
  h.write('WAVE', 8)
  h.write('fmt ', 12)
  h.writeUInt32LE(16, 16) // fmt chunk size
  h.writeUInt16LE(1, 20) // PCM
  h.writeUInt16LE(1, 22) // mono
  h.writeUInt32LE(RATE, 24)
  h.writeUInt32LE(RATE * 2, 28) // byte rate
  h.writeUInt16LE(2, 32) // block align
  h.writeUInt16LE(16, 34) // bits per sample
  h.write('data', 36)
  h.writeUInt32LE(pcm.byteLength, 40)
  return Buffer.concat([h, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)])
}

// whisper-cli -nt prints one segment per line; join them into a single line of text.
export function parseWhisperOutput(stdout: string): string {
  return stdout
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l !== '' && !/^(?:\[[^\]]*\]|\([^)]*\))(?:\s*(?:\[[^\]]*\]|\([^)]*\)))*$/.test(l)) // drop whole-segment noise: [BLANK_AUDIO], (music)
    .join(' ')
}

// Removes wavs left behind by a crash mid-transcription. Never throws.
export function cleanStaleWavs(tmpDir: string): void {
  try {
    for (const f of fs.readdirSync(tmpDir)) {
      if (f.endsWith('.wav')) fs.rmSync(path.join(tmpDir, f), { force: true })
    }
  } catch {
    // missing dir or unreadable: nothing to clean
  }
}

export type ExecFile = (file: string, args: string[], opts: { timeout: number; maxBuffer: number }) => Promise<{ stdout: string; stderr?: string }>

export interface WhisperDeps {
  execFile: ExecFile
  whisperBin: () => string | null
  modelPath: string
  tmpDir: string
  timeoutMs?: number
}

export const MAX_PCM_BYTES = RATE * 2 * 60 // one minute

// The IPC argument comes from the renderer: accept only a non-empty, even-length ArrayBuffer or view of at most a minute.
function toPcm(input: unknown): Uint8Array {
  let pcm: Uint8Array
  if (input instanceof ArrayBuffer) pcm = new Uint8Array(input)
  else if (ArrayBuffer.isView(input)) pcm = new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  else throw new Error('invalid audio: expected an ArrayBuffer')
  if (pcm.byteLength === 0 || pcm.byteLength > MAX_PCM_BYTES || pcm.byteLength % 2 !== 0) throw new Error('invalid audio: bad length')
  return pcm
}

// Single-flight: a stuck key must not spawn many whisper-cli processes.
let inFlight = false

// Runs whisper-cli on the audio, locally. Rejects on a missing binary or model, a spawn error, a non-zero
// exit or a timeout; an empty transcription resolves to ''. The temporary wav is always deleted.
export async function transcribe(deps: WhisperDeps, input: unknown): Promise<string> {
  const pcm = toPcm(input)
  if (inFlight) throw new Error('busy: a transcription is already running')
  inFlight = true
  try {
    return await run(deps, pcm)
  } finally {
    inFlight = false
  }
}

async function run(deps: WhisperDeps, pcm: Uint8Array): Promise<string> {
  const bin = deps.whisperBin()
  if (!bin) throw new Error('no-binary: whisper-cli not found on PATH')
  if (!fs.existsSync(deps.modelPath)) throw new Error(`no-model: ${deps.modelPath}`)
  fs.mkdirSync(deps.tmpDir, { recursive: true })
  const wav = path.join(deps.tmpDir, `${randomUUID()}.wav`)
  try {
    fs.writeFileSync(wav, pcmToWav(pcm))
    const { stdout } = await deps.execFile(bin, ['-m', deps.modelPath, '-f', wav, '-l', 'en', '-t', '4', '-nt', '-np'], {
      timeout: deps.timeoutMs ?? 30_000,
      maxBuffer: 1 << 20,
    })
    return parseWhisperOutput(stdout)
  } finally {
    fs.rmSync(wav, { force: true })
  }
}
