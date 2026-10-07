import type { AttachHandle, SessionBackend } from '../backend/types'

export interface FakeHandle extends AttachHandle {
  emitExit(): void
}

export class FakeBackend implements SessionBackend {
  live = new Set<string>()
  paths = new Map<string, string>() // what cwds() returns; create sets the start directory
  calls: { method: string; args: unknown[] }[] = []
  handles: FakeHandle[] = []
  pastes: { name: string; text: string; submit: boolean }[] = []
  captured = new Map<string, string>() // what capture() returns per session name

  private record(method: string, args: unknown[]) {
    this.calls.push({ method, args })
  }

  async ensureConfig(): Promise<void> {
    this.record('ensureConfig', [])
  }

  async create(o: { name: string; cwd: string; cols: number; rows: number; argv?: string[]; env?: Record<string, string> }): Promise<void> {
    this.record('create', [o])
    this.live.add(o.name)
    this.paths.set(o.name, o.cwd)
  }

  async setColors(name: string, fg: string, bg: string): Promise<void> {
    this.record('setColors', [name, fg, bg])
  }

  async list(): Promise<Set<string>> {
    this.record('list', [])
    return new Set(this.live)
  }

  async cwds(): Promise<Map<string, string>> {
    return new Map(this.paths)
  }

  async kill(name: string): Promise<void> {
    this.record('kill', [name])
    this.live.delete(name)
  }

  async paste(name: string, text: string, submit: boolean): Promise<void> {
    this.record('paste', [name, text, submit])
    this.pastes.push({ name, text, submit })
  }

  async capture(name: string): Promise<string> {
    return this.captured.get(name) ?? ''
  }

  attach(name: string, cols: number, rows: number): FakeHandle {
    this.record('attach', [name, cols, rows])
    const exits: (() => void)[] = []
    const h: FakeHandle = {
      onData: () => {},
      onExit: (cb) => { exits.push(cb) },
      write: () => {},
      resize: () => {},
      kill: () => {},
      emitExit: () => { for (const cb of exits) cb() },
    }
    this.handles.push(h)
    return h
  }
}
