import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import type { PlanAgent, PlanMode, PlanChunk } from "@shared/types";

/**
 * TmuxSupervisor — manages agent processes inside tmux sessions so they
 * survive Electron app restarts.
 *
 * Architecture:
 *   1. Agent command is written to a shell script (~/.grove/runs/<session>.sh)
 *   2. The prompt/message is written to a separate file (~/.grove/runs/<session>.msg)
 *      so shell quoting never corrupts it.
 *   3. tmux launches the script: `tmux new-session -d -s <name> 'bash <script>'`
 *   4. Agent stdout goes to a regular log file (~/.grove/runs/<session>.log)
 *   5. Node tails the log file using fs.watch + fs.readSync + poll backstop.
 *   6. On reconnect, the log file is replayed from offset 0.
 */

const RUNS_DIR = path.join(os.homedir(), ".grove", "runs");

type ChunkCallback = (taskId: string, mode: PlanMode, chunk: PlanChunk) => void;

interface LogTailer {
  watcher: fs.FSWatcher | null;
  pollTimer: NodeJS.Timeout | null;
  fd: number;
  offset: number;
  lineBuffer: string;
  stopped: boolean;
}

// ── Public helpers ──────────────────────────────────────────────

export function buildTmuxSessionName(
  workspacePath: string,
  taskId: string,
  mode: PlanMode,
): string {
  const hash = crypto
    .createHash("sha256")
    .update(workspacePath)
    .digest("hex")
    .slice(0, 6);
  const prefix = mode === "plan" ? "grove-plan" : "grove-exec";
  return `${prefix}-${hash}-${taskId}`;
}

export function buildLogPath(tmuxSession: string): string {
  return path.join(RUNS_DIR, `${tmuxSession}.log`);
}

function buildScriptPath(tmuxSession: string): string {
  return path.join(RUNS_DIR, `${tmuxSession}.sh`);
}

function buildMsgPath(tmuxSession: string): string {
  return path.join(RUNS_DIR, `${tmuxSession}.msg`);
}

function buildErrPath(tmuxSession: string): string {
  return path.join(RUNS_DIR, `${tmuxSession}.err`);
}

// ── PATH builder (same as planManager) ──────────────────────────

function buildEnvPath(): string {
  const home = os.homedir();
  const extras = [
    path.join(home, ".opencode", "bin"),
    path.join(home, ".local", "bin"),
    path.join(home, ".npm-global", "bin"),
    path.join(home, "go", "bin"),
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
  ];
  const current = process.env.PATH ?? "";
  const parts = current.split(path.delimiter).filter(Boolean);
  for (const extra of extras.reverse()) {
    if (!parts.includes(extra)) parts.unshift(extra);
  }
  return parts.join(path.delimiter);
}

// ── TmuxSupervisor ──────────────────────────────────────────────

export class TmuxSupervisor {
  private tailers = new Map<string, LogTailer>();
  private tmuxAvailable: boolean | null = null;

  // ── tmux availability ──────────────────────────────────────

  async isTmuxAvailable(): Promise<boolean> {
    if (this.tmuxAvailable !== null) {
      return this.tmuxAvailable;
    }
    return new Promise((resolve) => {
      const proc = spawn("tmux", ["-V"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      proc.on("close", (code) => {
        this.tmuxAvailable = code === 0;
        resolve(this.tmuxAvailable);
      });
      proc.on("error", () => {
        this.tmuxAvailable = false;
        resolve(false);
      });
    });
  }

  // ── Ensure runs directory ──────────────────────────────────

  private async ensureRunsDir(): Promise<boolean> {
    try {
      await fs.promises.mkdir(RUNS_DIR, { recursive: true });
      return true;
    } catch (err) {
      console.error("[TmuxSupervisor] Failed to create runs directory:", err);
      return false;
    }
  }

  // ── Start agent in tmux ────────────────────────────────────

  async start(
    tmuxSession: string,
    agentSessionId: string | null,
    cwd: string,
    agent: PlanAgent,
    model: string | null,
    message: string,
    displayMessage: string,
    taskId: string,
    mode: PlanMode,
    taskFilePath: string,
    onChunk: ChunkCallback,
    onComplete?: () => void,
  ): Promise<boolean> {
    if (!(await this.ensureRunsDir())) {
      return false;
    }

    const logPath = buildLogPath(tmuxSession);
    const scriptPath = buildScriptPath(tmuxSession);
    const msgPath = buildMsgPath(tmuxSession);
    const errPath = buildErrPath(tmuxSession);

    // Clean up previous run files
    for (const f of [logPath, scriptPath, msgPath, errPath]) {
      try {
        fs.unlinkSync(f);
      } catch {
        // doesn't exist, fine
      }
    }

    // Write message to a separate file (avoids all shell quoting issues)
    fs.writeFileSync(msgPath, message, "utf-8");

    // Create log file with the user's display message as the first line.
    // This allows the log to be replayed on restart with the user message
    // visible above the agent's response, even though it is not in the
    // agent's output stream.
    const userMsgLine = JSON.stringify({
      type: "grove_user_message",
      content: displayMessage,
    });
    fs.writeFileSync(logPath, userMsgLine + "\n", "utf-8");

    // Build the shell script
    const script = this.buildScript(
      agent,
      mode,
      model,
      agentSessionId,
      taskFilePath,
      msgPath,
      logPath,
      errPath,
    );
    fs.writeFileSync(scriptPath, script, { mode: 0o755 });

    // Kill any existing tmux session with this name
    try {
      await this.exec(["kill-session", "-t", tmuxSession]);
    } catch {
      // doesn't exist, fine
    }

    // Start the tailer BEFORE launching tmux so we don't miss early output
    this.startTailer(
      tmuxSession,
      logPath,
      agent,
      taskId,
      mode,
      onChunk,
      onComplete,
    );

    // Launch tmux with the script as its command.
    // The session dies automatically when the script exits.
    try {
      const envPath = buildEnvPath();
      await this.exec([
        "new-session",
        "-d",
        "-s",
        tmuxSession,
        "-c",
        cwd,
        "-E", // don't read tmux.conf's default-command
        `env PATH='${envPath}' bash '${scriptPath}'`,
      ]);
    } catch (err) {
      console.error("[TmuxSupervisor] Failed to create tmux session:", err);
      this.stopTailer(tmuxSession);
      return false;
    }

    console.log(
      `[TmuxSupervisor] Started session ${tmuxSession} for ${agent} (${mode})`,
    );
    return true;
  }

  // ── Build shell script content ─────────────────────────────

  private buildScript(
    agent: PlanAgent,
    mode: PlanMode,
    model: string | null,
    sessionId: string | null,
    taskFilePath: string,
    msgPath: string,
    logPath: string,
    errPath: string,
  ): string {
    const bin = agent === "opencode" ? "opencode" : "copilot";

    // Build argument list — the message is read from the .msg file at runtime
    // via "$(cat "$MSG_FILE")" inside double quotes (safe for any content).
    let argsStr: string;

    if (agent === "opencode") {
      const parts = ["run", "--format", "json"];
      if (model) parts.push("--model", this.shellQuote(model));
      if (sessionId) parts.push("--session", this.shellQuote(sessionId));
      parts.push("--", '"$(cat "$MSG_FILE")"');
      argsStr = parts.join(" ");
    } else {
      const parts = [
        "-p",
        '"$(cat "$MSG_FILE")"',
        "--output-format",
        "json",
        "--stream",
        "on",
        "--no-color",
      ];
      if (mode === "plan") {
        parts.push("--deny-tool=shell");
        parts.push(`--allow-tool='write(${taskFilePath})'`);
      }
      if (model) parts.push(`--model=${this.shellQuote(model)}`);
      if (sessionId) parts.push(`--resume=${this.shellQuote(sessionId)}`);
      argsStr = parts.join(" ");
    }

    // The script:
    // 1. Reads the message from .msg file via $MSG_FILE variable
    // 2. Pipes agent stdout through `tee` to the log file so the agent sees a
    //    pipe (same as SpawnPlanRunner) and does not buffer — this gives us
    //    real-time streaming while still capturing output to the log file.
    // 3. Captures the agent exit code via PIPESTATUS[0] (bash-specific).
    // 4. Appends a sentinel JSON line with the exit code.
    return `#!/bin/bash
set -u
MSG_FILE=${this.shellQuote(msgPath)}
LOG_FILE=${this.shellQuote(logPath)}
ERR_FILE=${this.shellQuote(errPath)}

${bin} ${argsStr} 2>"$ERR_FILE" | tee "$LOG_FILE"
EXIT_CODE=\${PIPESTATUS[0]}

echo '{"type":"grove_exit","code":'"$EXIT_CODE"'}' >> "$LOG_FILE"
exit $EXIT_CODE
`;
  }

  private shellQuote(s: string): string {
    // POSIX $'...' quoting: escape single quotes and backslashes
    return "'" + s.replace(/'/g, "'\\''") + "'";
  }

  // ── Log file tailer (tail -f style) ────────────────────────

  private startTailer(
    tmuxSession: string,
    logPath: string,
    agent: PlanAgent,
    taskId: string,
    mode: PlanMode,
    onChunk: ChunkCallback,
    onComplete?: () => void,
  ): void {
    // Stop any existing tailer for this session
    this.stopTailer(tmuxSession);

    const fd = fs.openSync(logPath, "r");

    const tailer: LogTailer = {
      watcher: null,
      pollTimer: null,
      fd,
      offset: 0,
      lineBuffer: "",
      stopped: false,
    };
    this.tailers.set(tmuxSession, tailer);

    let sessionIdEmitted = false;

    const processLine = (line: string): void => {
      const results = this.parseLine(agent, line);
      for (const result of results) {
        // Detect the internal sentinel written by our script
        if (result.type === "__grove_exit") {
          console.log(
            `[TmuxSupervisor] Agent exited in ${tmuxSession} code=${result.code}`,
          );
          this.stopTailer(tmuxSession);
          onChunk(taskId, mode, {
            type: "done",
            content: String(result.code),
          });
          onComplete?.();
          return;
        }
        if (result.type === "session_id") {
          if (sessionIdEmitted) continue;
          sessionIdEmitted = true;
        }
        onChunk(taskId, mode, result);
      }
    };

    const drain = (): void => {
      if (tailer.stopped) return;

      const buf = Buffer.alloc(65536);
      let bytesRead: number;
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          bytesRead = fs.readSync(tailer.fd, buf, 0, buf.length, tailer.offset);
          if (bytesRead === 0) break;
          tailer.offset += bytesRead;
          tailer.lineBuffer += buf.toString("utf8", 0, bytesRead);

          // Process complete lines
          const lines = tailer.lineBuffer.split("\n");
          tailer.lineBuffer = lines.pop()!; // keep incomplete last fragment
          for (const line of lines) {
            if (tailer.stopped) return;
            processLine(line);
          }
        }
      } catch (err) {
        if (!tailer.stopped) {
          console.error(
            `[TmuxSupervisor] Log read error for ${tmuxSession}:`,
            err,
          );
        }
      }
    };

    // Primary: fs.watch for low-latency notification
    try {
      tailer.watcher = fs.watch(logPath, () => drain());
    } catch (err) {
      console.warn(
        `[TmuxSupervisor] fs.watch failed for ${logPath}, using poll only:`,
        err,
      );
    }

    // Backstop: poll every 50ms in case fs.watch misses events (macOS kqueue)
    tailer.pollTimer = setInterval(() => drain(), 50);
  }

  // ── Reconnect to a running tmux session ────────────────────

  async reconnect(
    tmuxSession: string,
    taskId: string,
    mode: PlanMode,
    agent: PlanAgent,
    onChunk: ChunkCallback,
    onComplete?: () => void,
  ): Promise<{ alive: boolean }> {
    const logPath = buildLogPath(tmuxSession);
    if (!fs.existsSync(logPath)) {
      console.warn(
        `[TmuxSupervisor] Log file not found for reconnect: ${logPath}`,
      );
      return { alive: false };
    }

    const sessionAlive = await this.tmuxSessionExists(tmuxSession);

    if (!sessionAlive) {
      // Agent finished while the app was closed. Replay the entire log
      // synchronously so the renderer gets all output including the
      // grove_exit sentinel (which fires a "done" chunk).
      console.log(
        `[TmuxSupervisor] Session ${tmuxSession} is gone — replaying log file for history`,
      );
    }

    // Replay entire log from offset 0 — the log file retains all output.
    // For a live session the tailer will keep following new writes.
    // For a dead session it will drain the full file, hit the sentinel,
    // fire "done", and stop itself.
    this.startTailer(
      tmuxSession,
      logPath,
      agent,
      taskId,
      mode,
      onChunk,
      onComplete,
    );

    return { alive: true };
  }

  // ── Stop a log tailer ──────────────────────────────────────

  private stopTailer(tmuxSession: string): void {
    const tailer = this.tailers.get(tmuxSession);
    if (!tailer) return;

    tailer.stopped = true;

    if (tailer.watcher) {
      tailer.watcher.close();
      tailer.watcher = null;
    }
    if (tailer.pollTimer) {
      clearInterval(tailer.pollTimer);
      tailer.pollTimer = null;
    }
    try {
      fs.closeSync(tailer.fd);
    } catch {
      // ignore
    }
    this.tailers.delete(tmuxSession);
  }

  // ── Kill a tmux session and clean up ───────────────────────

  async kill(tmuxSession: string): Promise<void> {
    this.stopTailer(tmuxSession);
    try {
      await this.exec(["kill-session", "-t", tmuxSession]);
    } catch {
      // Session may already be dead
    }
    this.cleanupRunFiles(tmuxSession);
  }

  // ── Detach all tailers (on app quit, keep tmux alive) ──────

  detachAll(): void {
    for (const [session] of this.tailers) {
      console.log(`[TmuxSupervisor] Detaching tailer for ${session}`);
      this.stopTailer(session);
    }
  }

  // ── Clean up orphaned run files on startup ─────────────────

  async cleanupOrphanedRuns(): Promise<void> {
    try {
      await fs.promises.mkdir(RUNS_DIR, { recursive: true });
    } catch {
      return;
    }

    let entries: string[];
    try {
      entries = await fs.promises.readdir(RUNS_DIR);
    } catch {
      return;
    }

    // Find unique session names from file extensions
    const sessions = new Set<string>();
    for (const entry of entries) {
      const match = entry.match(/^(.+)\.(log|sh|msg|err)$/);
      if (match) sessions.add(match[1]);
    }

    for (const session of sessions) {
      const alive = await this.tmuxSessionExists(session);
      if (!alive) {
        this.cleanupRunFiles(session);
      }
    }
  }

  // ── Check if a tmux session exists ─────────────────────────

  async checkSession(tmuxSession: string): Promise<boolean> {
    return this.tmuxSessionExists(tmuxSession);
  }

  // ── Private helpers ────────────────────────────────────────

  private async tmuxSessionExists(tmuxSession: string): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn("tmux", ["has-session", "-t", tmuxSession], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      proc.on("close", (code) => {
        resolve(code === 0);
      });
      proc.on("error", () => {
        resolve(false);
      });
    });
  }

  private async exec(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn("tmux", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      proc.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });
      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(`tmux ${args[0]} exited with code ${code}: ${stderr}`),
          );
        }
      });
      proc.on("error", (err) => {
        reject(err);
      });
    });
  }

  private cleanupRunFiles(tmuxSession: string): void {
    for (const ext of ["log", "sh", "msg", "err"]) {
      const p = path.join(RUNS_DIR, `${tmuxSession}.${ext}`);
      try {
        fs.unlinkSync(p);
        console.log(`[TmuxSupervisor] Cleaned up: ${p}`);
      } catch {
        // ignore
      }
    }
  }

  // ── Sentinel type (internal only, not a PlanChunk) ──────────

  // ── Line parsing (shared between start and reconnect) ──────

  /** Parse result can be a regular PlanChunk or an internal sentinel. */
  private parseLine(
    agent: PlanAgent,
    line: string,
  ): Array<PlanChunk | { type: "__grove_exit"; code: number }> {
    const trimmed = line.trim();
    if (!trimmed) return [];

    try {
      const obj = JSON.parse(trimmed);

      // Detect our sentinel line
      if (obj.type === "grove_exit" && typeof obj.code === "number") {
        return [{ type: "__grove_exit", code: obj.code }];
      }

      // Detect the user message line we write at the start of each log
      if (
        obj.type === "grove_user_message" &&
        typeof obj.content === "string"
      ) {
        return [{ type: "user_message", content: obj.content }];
      }

      if (agent === "opencode") {
        return this.parseOpencodeLine(obj);
      } else {
        return this.parseCopilotLine(obj);
      }
    } catch {
      const stripped = trimmed.replace(/\x1b\[[0-9;]*[mGKHF]/g, "");
      if (!stripped) return [];
      return [{ type: "text", content: stripped }];
    }
  }

  private parseOpencodeLine(obj: Record<string, unknown>): PlanChunk[] {
    const chunks: PlanChunk[] = [];

    if (obj.type === "step_start" && typeof obj.sessionID === "string") {
      chunks.push({ type: "session_id", content: obj.sessionID });
    }

    if (
      obj.type === "step_finish" &&
      obj.part !== null &&
      typeof obj.part === "object"
    ) {
      const part = obj.part as Record<string, unknown>;
      if (part.tokens !== null && typeof part.tokens === "object") {
        const t = part.tokens as Record<string, unknown>;
        const cache =
          t.cache !== null && typeof t.cache === "object"
            ? (t.cache as Record<string, unknown>)
            : {};
        chunks.push({
          type: "tokens",
          content: "",
          data: {
            total: typeof t.total === "number" ? t.total : 0,
            input: typeof t.input === "number" ? t.input : 0,
            output: typeof t.output === "number" ? t.output : 0,
            reasoning: typeof t.reasoning === "number" ? t.reasoning : 0,
            cache: {
              write: typeof cache.write === "number" ? cache.write : 0,
              read: typeof cache.read === "number" ? cache.read : 0,
            },
          },
        });
      }
    }

    if (
      obj.type === "text" &&
      obj.part !== null &&
      typeof obj.part === "object"
    ) {
      const part = obj.part as Record<string, unknown>;
      if (part.type === "text" && typeof part.text === "string") {
        chunks.push({ type: "text", content: part.text });
      }
      if (part.type === "thinking" && typeof part.thinking === "string") {
        chunks.push({ type: "thinking", content: part.thinking });
      }
    }

    return chunks;
  }

  private parseCopilotLine(obj: Record<string, unknown>): PlanChunk[] {
    const chunks: PlanChunk[] = [];

    if (obj.type === "session_id" && typeof obj.id === "string") {
      chunks.push({ type: "session_id", content: obj.id });
    }

    if (
      obj.type === "message" &&
      obj.role === "assistant" &&
      typeof obj.content === "string"
    ) {
      chunks.push({ type: "text", content: obj.content });
    }

    if (obj.type === "delta" && typeof obj.content === "string") {
      chunks.push({ type: "text", content: obj.content });
    }

    return chunks;
  }
}
