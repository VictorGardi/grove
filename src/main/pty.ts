import * as pty from "node-pty";

interface PtyEntry {
  process: pty.IPty;
  lastOutputTime: number;
}

type DataCallback = (id: string, data: string) => void;
type ExitCallback = (id: string, exitCode: number, signal?: number) => void;

export class PtyManager {
  private ptys = new Map<string, PtyEntry>();
  private onDataCallback: DataCallback | null = null;
  private onExitCallback: ExitCallback | null = null;
  // Track IDs killed intentionally so their exit events don't trigger markDead
  private killedIds = new Set<string>();

  /**
   * Register the callback that receives PTY output data.
   * Called once during setup — the IPC layer forwards data to the renderer.
   */
  setOnData(callback: DataCallback): void {
    this.onDataCallback = callback;
  }

  /**
   * Register the callback that receives PTY exit events.
   */
  setOnExit(callback: ExitCallback): void {
    this.onExitCallback = callback;
  }

  /**
   * Resolve the user's shell.
   * Order: $SHELL → /bin/zsh (macOS) or /bin/bash (Linux) → powershell.exe (Windows)
   */
  private resolveShell(): string {
    const envShell = process.env.SHELL;
    if (envShell) return envShell;

    if (process.platform === "darwin") return "/bin/zsh";
    if (process.platform === "linux") return "/bin/bash";
    return "powershell.exe";
  }

  /**
   * Spawn a new PTY in the given directory.
   * If a PTY with the same ID already exists, it is killed first.
   */
  create(id: string, cwd: string): void {
    // Kill existing PTY with same ID if it exists
    if (this.ptys.has(id)) {
      this.kill(id);
    }

    const shell = this.resolveShell();
    console.log(
      "[PtyManager.create] id:",
      id,
      "cwd:",
      cwd,
      "shell:",
      shell,
      "PATH:",
      process.env.PATH,
    );
    const args: string[] = [];

    // Use login shell on macOS/Linux for proper env loading
    if (process.platform !== "win32") {
      args.push("-l");
    }

    const ptyProcess = pty.spawn(shell, args, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
      },
    });

    const entry: PtyEntry = {
      process: ptyProcess,
      lastOutputTime: Date.now(),
    };

    this.ptys.set(id, entry);

    // Forward data output
    ptyProcess.onData((data: string) => {
      entry.lastOutputTime = Date.now();
      this.onDataCallback?.(id, data);
    });

    // Forward exit — but only if the PTY exited naturally, not via explicit kill()
    ptyProcess.onExit(({ exitCode, signal }) => {
      console.log(
        "[PtyManager] PTY exited, id:",
        id,
        "exitCode:",
        exitCode,
        "signal:",
        signal,
      );
      this.ptys.delete(id);
      if (!this.killedIds.delete(id)) {
        this.onExitCallback?.(id, exitCode, signal);
      }
    });
  }

  /**
   * Forward keystrokes to a PTY.
   */
  write(id: string, data: string): void {
    const entry = this.ptys.get(id);
    if (entry) {
      if (process.env.DEBUG_PTY) {
        console.log("[PtyManager.write] Writing to PTY:", JSON.stringify(data));
      }
      entry.process.write(data);
    } else {
      console.warn("[PtyManager.write] No PTY found for id:", id);
    }
  }

  /**
   * Forward resize events to a PTY.
   */
  resize(id: string, cols: number, rows: number): void {
    const entry = this.ptys.get(id);
    if (entry) {
      try {
        entry.process.resize(cols, rows);
      } catch {
        // PTY may have already exited — ignore resize errors
      }
    }
  }

  /**
   * Kill a specific PTY and remove it from the pool.
   */
  kill(id: string): void {
    const entry = this.ptys.get(id);
    if (entry) {
      this.killedIds.add(id); // suppress the resulting exit event
      try {
        entry.process.kill();
      } catch {
        // Already dead — ignore
      }
      this.ptys.delete(id);
    }
  }

  /**
   * Kill all PTYs. Called on app quit.
   */
  killAll(): void {
    for (const [id] of this.ptys) {
      this.kill(id);
    }
  }

  /**
   * Returns true if no output has been received for 3+ seconds.
   */
  isIdle(id: string): boolean {
    const entry = this.ptys.get(id);
    if (!entry) return true;
    return Date.now() - entry.lastOutputTime >= 3000;
  }

  /**
   * Returns all active PTY IDs.
   */
  getIds(): string[] {
    return Array.from(this.ptys.keys());
  }

  /**
   * Check if a PTY with the given ID exists.
   */
  exists(id: string): boolean {
    return this.ptys.has(id);
  }
}
