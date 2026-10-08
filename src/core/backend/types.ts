export interface AttachHandle {
  onData(cb: (d: string) => void): void
  onExit(cb: () => void): void
  write(d: string): void
  resize(c: number, r: number): void
  kill(): void
}

export interface SessionBackend {
  ensureConfig(): Promise<void>
  create(o: { name: string; cwd: string; cols: number; rows: number; argv?: string[]; env?: Record<string, string> }): Promise<void>
  setColors(name: string, fg: string, bg: string): Promise<void>
  list(): Promise<Set<string>> // live: the session exists and its pane is not dead; empty when no server
  cwds(): Promise<Map<string, string>> // session name → current directory of its active pane
  kill(name: string): Promise<void>
  paste(name: string, text: string, submit: boolean): Promise<void> // bracketed paste, then Enter when `submit` (ADR 0023)
  capture(name: string, lines: number): Promise<string> // the pane's last `lines` lines; '' when missing
  attach(name: string, cols: number, rows: number): AttachHandle
}
