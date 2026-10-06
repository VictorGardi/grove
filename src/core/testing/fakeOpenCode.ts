import type { OcEvent, OpenCodeSource } from '../opencode/types'

export class FakeOpenCode implements OpenCodeSource {
  started = false
  stopped = false
  private cb: ((e: OcEvent) => void) | null = null

  start(onEvent: (e: OcEvent) => void): void {
    this.started = true
    this.cb = onEvent
  }

  emit(e: OcEvent): void {
    if (!this.cb) throw new Error('FakeOpenCode: emit before start')
    this.cb(e)
  }

  stop(): void {
    this.stopped = true
  }
}
