// Runs on the audio thread: hands each block of mono samples to the main thread.
class PcmTap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0]
    if (ch) this.port.postMessage(ch.slice())
    return true
  }
}
registerProcessor('pcm-tap', PcmTap)
