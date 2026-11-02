// Microphone capture to 16 kHz mono s16le, the format whisper-cli reads.
import workletUrl from './pcm-worklet.js?url&no-inline' // same-origin file: the CSP forbids data: and blob: scripts

const RATE = 16000

export interface Recorder {
  stop(): Promise<ArrayBuffer>
  cancel(): void
}

export function toS16le(chunks: Float32Array[]): ArrayBuffer {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new DataView(new ArrayBuffer(total * 2))
  let i = 0
  for (const c of chunks) {
    for (const f of c) {
      out.setInt16(i, Math.round(Math.max(-1, Math.min(1, f)) * 0x7fff), true)
      i += 2
    }
  }
  return out.buffer
}

export async function start(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  })
  let ctx: AudioContext | undefined
  const chunks: Float32Array[] = []
  let closed = false
  // Stopping the tracks and closing the context is what turns the macOS microphone indicator off.
  const release = () => {
    if (closed) return
    closed = true
    stream.getTracks().forEach((t) => t.stop())
    void ctx?.close().catch(() => {})
  }
  try {
    ctx = new AudioContext({ sampleRate: RATE })
    await ctx.audioWorklet.addModule(workletUrl)
    const tap = new AudioWorkletNode(ctx, 'pcm-tap', { numberOfInputs: 1, numberOfOutputs: 0 })
    tap.port.onmessage = (e: MessageEvent<Float32Array>) => { if (!closed) chunks.push(e.data) }
    ctx.createMediaStreamSource(stream).connect(tap)
  } catch (e) {
    release()
    throw e
  }
  return {
    // no further chunks are kept after release, so the buffer is final when this returns
    stop: async () => {
      release()
      return toS16le(chunks)
    },
    cancel: release,
  }
}
