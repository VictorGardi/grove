export interface AttachHandle {
  onData(cb: (d: string) => void): void
  onExit(cb: () => void): void
  write(d: string): void
  resize(c: number, r: number): void
  kill(): void
}

export interface SessionBackend {
  ensureConfig(): Promise<void>
  create(o: { name: string; cwd: string; cols: number; rows: number; argv?: string[] }): Promise<void>
  setColors(name: string, fg: string, bg: string): Promise<void>
  list(): Promise<Set<string>> // empty when no server
  cwds(): Promise<Map<string, string>> // session name → current directory of its active pane
  kill(name: string): Promise<void>
  attach(name: string, cols: number, rows: number): AttachHandle
}
