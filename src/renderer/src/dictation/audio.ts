// Judges captured 16 kHz mono s16le before it is worth sending to whisper.
export const SAMPLE_RATE = 16000
export const MIN_MS = 300
// main rejects audio over a minute; the cap stays safely below it so a long hold is transcribed, not lost
export const MAX_RECORDING_MS = 55_000
export const MAX_RECORDING_BYTES = (SAMPLE_RATE * MAX_RECORDING_MS) / 1000 * 2
export const MIN_BYTES = (SAMPLE_RATE * MIN_MS) / 1000 * 2 // 9600
export const FRAME_SAMPLES = 320 // 20 ms
export const RMS_GATE = 0.008

// A key click is one or two loud frames; speech keeps several frames above the gate.
export const MIN_LOUD_FRAMES = 3
export const MIN_LOUD_RATIO = 0.1

export function judgeAudio(pcm: ArrayBuffer): 'short' | 'silent' | 'ok' {
  if (pcm.byteLength < MIN_BYTES) return 'short'
  const view = new DataView(pcm)
  const samples = Math.floor(pcm.byteLength / 2)
  let frames = 0
  let loud = 0
  for (let start = 0; start + FRAME_SAMPLES <= samples; start += FRAME_SAMPLES) {
    let sum = 0
    for (let i = start; i < start + FRAME_SAMPLES; i++) {
      const f = view.getInt16(i * 2, true) / 0x8000
      sum += f * f
    }
    frames++
    if (Math.sqrt(sum / FRAME_SAMPLES) >= RMS_GATE) loud++
  }
  const need = Math.min(frames, Math.max(MIN_LOUD_FRAMES, Math.ceil(frames * MIN_LOUD_RATIO)))
  return loud >= need ? 'ok' : 'silent'
}
