import type { AttachHandle, SessionBackend } from './types'

const notImplemented = (): never => {
  throw new Error('herdr backend: not implemented')
}

export class HerdrBackend implements SessionBackend {
  ensureConfig(): Promise<void> { return notImplemented() }
  create(): Promise<void> { return notImplemented() }
  setColors(): Promise<void> { return notImplemented() }
  list(): Promise<Set<string>> { return notImplemented() }
  cwds(): Promise<Map<string, string>> { return notImplemented() }
  kill(): Promise<void> { return notImplemented() }
  paste(): Promise<void> { return notImplemented() }
  capture(): Promise<string> { return notImplemented() }
  attach(): AttachHandle { return notImplemented() }
}
