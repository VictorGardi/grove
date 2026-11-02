import { describe, expect, it } from 'vitest'
import { MAX_PCM_BYTES } from '../../../core/stt/whisper'
import { judgeAudio, MAX_RECORDING_BYTES, MAX_RECORDING_MS, MIN_BYTES, SAMPLE_RATE } from './audio'

function pcm(seconds: number, sample: (i: number) => number): ArrayBuffer {
  const n = Math.round(seconds * SAMPLE_RATE)
  const v = new DataView(new ArrayBuffer(n * 2))
  for (let i = 0; i < n; i++) v.setInt16(i * 2, Math.round(sample(i) * 0x7fff), true)
  return v.buffer
}
const tone = (amp: number) => (i: number) => amp * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE)

describe('judgeAudio', () => {
  it('rejects a tap under 300 ms even when loud', () => {
    expect(MIN_BYTES).toBe(9600)
    expect(judgeAudio(pcm(0.2, tone(0.5)))).toBe('short')
    expect(judgeAudio(new ArrayBuffer(MIN_BYTES - 2))).toBe('short')
  })
  it('rejects all-zero audio', () => {
    expect(judgeAudio(pcm(1, () => 0))).toBe('silent')
  })
  it('rejects noise below the gate', () => {
    expect(judgeAudio(pcm(1, tone(0.005)))).toBe('silent')
  })
  it('accepts a loud tone', () => {
    expect(judgeAudio(pcm(1, tone(0.3)))).toBe('ok')
  })
  it('rejects a click-only sample: one loud 20 ms frame in silence', () => {
    const click = (i: number) => (i >= 8000 && i < 8320 ? 0.5 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE) : 0)
    expect(judgeAudio(pcm(1, click))).toBe('silent')
  })
  it('accepts speech-like audio: bursts of voiced frames between pauses', () => {
    const speech = (i: number) => ((Math.floor(i / 3200) % 2 === 0) ? 0.1 * Math.sin((2 * Math.PI * 200 * i) / SAMPLE_RATE) : 0.001)
    expect(judgeAudio(pcm(1, speech))).toBe('ok')
  })
})

describe('recording cap', () => {
  it('stays below what main accepts', () => {
    expect(MAX_RECORDING_MS).toBe(55_000)
    expect(MAX_RECORDING_BYTES).toBeLessThan(MAX_PCM_BYTES)
  })
})
