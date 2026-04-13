import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import type { PlanAgent, PlanMode, PlanChunk } from "@shared/types";
import { buildEnvPath } from "./env";
import { parseOpencodeLine, CopilotLineParser } from "./agentOutputParser";
import { writeOpencodeConfig, cleanupGroveConfig } from "./opencodeConfig";

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
  /** File offset of the first byte in lineBuffer (used for per-line offset tracking). */
  lineBufferOffset: number;
  stopped: boolean;
  /** Captured task file path for persisting exit code */
  taskFilePath?: string;
  /** Stateful Copilot stream parser (undefined for opencode runs) */
  copilotParser?: CopilotLineParser;
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

// ── TmuxSupervisor ──────────────────────────────────────────────

export class TmuxSupervisor {
  private tailers = new Map<string, LogTailer>();
  private tmuxAvailable: boolean | null = null;
  /** Tracks opencode.json files written by Grove so we can clean them up. */
  private wroteConfigFiles = new Map<string, string>(); // tmuxSession -> filePath
  private updateTask?: (
    workspacePath: string,
    taskFilePath: string,
    updates: Record<string, unknown>,
  ) => Promise<unknown>;

  constructor(options?: {
    updateTask?: (
      workspacePath: string,
      taskFilePath: string,
      updates: Record<string, unknown>,
    ) => Promise<unknown>;
  }) {
    this.updateTask = options?.updateTask;
  }

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

    // Clean up previous run files.
    // The log is only reset for new sessions (agentSessionId === null).
    // Follow-up sends append to the same log so the full conversation history
    // survives app restarts.
    const filesToClean = agentSessionId
      ? [scriptPath, msgPath, errPath] // keep log for follow-ups
      : [logPath, scriptPath, msgPath, errPath]; // fresh log for new sessions
    for (const f of filesToClean) {
      try {
        fs.unlinkSync(f);
      } catch {
        // doesn't exist, fine
      }
    }

    // Write message to a separate file (avoids all shell quoting issues)
    fs.writeFileSync(msgPath, message, "utf-8");

    // Write (new session) or append (follow-up) the user's display message as
    // a JSON line at the current end of the log.  The shell script uses
    // `tee -a` so subsequent agent output is appended after this marker line,
    // preserving the entire conversation log across multiple turns.
    const userMsgLine = JSON.stringify({
      type: "grove_user_message",
      content: displayMessage,
    });
    if (agentSessionId) {
      // Follow-up: append user message to existing log
      fs.appendFileSync(logPath, userMsgLine + "\n", "utf-8");
    } else {
      // New session: create fresh log with user message as first line
      fs.writeFileSync(logPath, userMsgLine + "\n", "utf-8");
    }

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

    // Write a project opencode.json to suppress ask-permission prompts that
    // would block headless runs. Skipped if the project already has one.
    if (agent === "opencode") {
      this.writeOpencodeConfig(tmuxSession, cwd);
    }

    // Start the tailer BEFORE launching tmux so we don't miss early output.
    // Use the current file size as the start offset so we only read content
    // written by the new agent run — not old turns already in the log.
    const tailerStartOffset = fs.statSync(logPath).size;
    this.startTailer(
      tmuxSession,
      logPath,
      agent,
      taskId,
      mode,
      onChunk,
      onComplete,
      tailerStartOffset,
      taskFilePath,
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
      this.cleanupGroveConfig(tmuxSession);
      return false;
    }

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
      const parts = [
        "run",
        "--format",
        "json",
        "--agent",
        "build",
        "--thinking",
      ];
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
        "--add-dir=$HOME/.grove",
      ];
      if (mode === "plan") {
        parts.push("--deny-tool=shell");
        parts.push(`--allow-tool='write(${taskFilePath})'`);
      } else {
        // Execute mode: allow all tools for unattended headless runs.
        parts.push("--allow-all-tools");
      }
      if (model) parts.push(`--model=${this.shellQuote(model)}`);
      if (sessionId) parts.push(`--resume=${this.shellQuote(sessionId)}`);
      argsStr = parts.join(" ");
    }

    // The script:
    // 1. Reads the message from .msg file via $MSG_FILE variable
    // 2. Pipes agent stdout through `tee -a` to the log file so the agent sees
    //    a pipe (same as SpawnPlanRunner) and does not buffer — this gives us
    //    real-time streaming while still capturing output to the log file.
    //    Using `-a` (append) is critical: the log already has the
    //    grove_user_message header line written by Node before the script runs;
    //    truncating the file would lose that line.
    // 3. Captures the agent exit code via PIPESTATUS[0] (bash-specific).
    // 4. Appends a sentinel JSON line with the exit code.
    return `#!/bin/bash
set -u
MSG_FILE=${this.shellQuote(msgPath)}
LOG_FILE=${this.shellQuote(logPath)}
ERR_FILE=${this.shellQuote(errPath)}

${bin} ${argsStr} 2>"$ERR_FILE" | tee -a "$LOG_FILE"
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
    startOffset: number = 0,
    taskFilePath?: string,
  ): void {
    // Stop any existing tailer for this session
    this.stopTailer(tmuxSession);

    const fd = fs.openSync(logPath, "r");

    const tailer: LogTailer = {
      watcher: null,
      pollTimer: null,
      fd,
      offset: startOffset,
      lineBuffer: "",
      lineBufferOffset: startOffset,
      stopped: false,
      taskFilePath,
      copilotParser: agent !== "opencode" ? new CopilotLineParser() : undefined,
    };
    this.tailers.set(tmuxSession, tailer);

    let sessionIdEmitted = false;
    // Track opencode errors within a turn so we can surface them and correct
    // the exit code when opencode exits cleanly (code 0) after an error.
    let turnHadError = false;

    const processLine = (line: string, afterLineOffset: number): void => {
      const results = this.parseLine(agent, line, tailer.copilotParser);
      for (const result of results) {
        // Detect the internal sentinel written by our script
        if (result.type === "__grove_exit") {
          // Peek one byte immediately after this sentinel line to determine
          // whether more content has been written to the log (intermediate
          // sentinel in a multi-turn session) or we are truly at EOF (final).
          //
          // IMPORTANT: use `afterLineOffset` — the file position of the byte
          // just after this line's newline — NOT tailer.offset, which has
          // already been advanced to the end of the current read buffer.
          // If the sentinel and the next turn's data were in the same buffer,
          // tailer.offset would overshoot past the next turn's content, causing
          // an incorrect EOF result and a false-positive "last sentinel" read.
          const peek = Buffer.alloc(1);
          const peeked = fs.readSync(tailer.fd, peek, 0, 1, afterLineOffset);
          const isLastSentinel = peeked === 0;

          // When opencode emits an error event then exits with code 0, treat
          // the effective exit code as 1 so the UI shows it as a failure.
          const effectiveCode =
            turnHadError && result.code === 0 ? 1 : result.code;

          if (isLastSentinel) {
            // Final sentinel — stop tailing and signal completion.
            this.stopTailer(tmuxSession);
            this.cleanupGroveConfig(tmuxSession);

            // Surface stderr so the user sees the actual error in the exit
            // warning section rather than the generic "exited without output".
            if (effectiveCode !== 0) {
              try {
                const errPath = buildErrPath(tmuxSession);
                const stderr = fs.existsSync(errPath)
                  ? fs.readFileSync(errPath, "utf-8").trim()
                  : "";
                if (stderr) {
                  onChunk(taskId, mode, { type: "stderr", content: stderr });
                }
              } catch {
                // best-effort — ignore read errors
              }
            }

            onChunk(taskId, mode, {
              type: "done",
              content: String(effectiveCode),
            });

            // Persist the exit code to task frontmatter so indicators survive app restart
            // The taskFilePath is captured in the tailer.
            if (tailer.taskFilePath && this.updateTask) {
              // derive workspace root from taskFilePath (.tasks/status/T-XXX.md)
              const wsRoot = path.dirname(
                path.dirname(path.dirname(tailer.taskFilePath)),
              );
              this.updateTask(
                wsRoot,
                tailer.taskFilePath,
                mode === "execute"
                  ? { execLastExitCode: effectiveCode }
                  : { planLastExitCode: effectiveCode },
              ).catch((err: unknown) => {
                console.warn(
                  `[TmuxSupervisor] Failed to persist exit code for ${taskId}:`,
                  err,
                );
              });
            }

            // Signal that log replay / run is fully complete (resets isReplaying in renderer)
            onChunk(taskId, mode, { type: "replay_done", content: "" });
            onComplete?.();
          } else {
            // Intermediate sentinel (multi-turn log) — close this turn's agent
            // bubble and continue tailing for the next turn.
            onChunk(taskId, mode, {
              type: "done",
              content: String(effectiveCode),
            });
            // Reset error tracking for the next turn
            turnHadError = false;
          }
          return;
        }
        // Intercept __grove_error: emit the error message to the user and flag
        // this turn as failed so the exit code is corrected above.
        if (result.type === "__grove_error") {
          turnHadError = true;
          onChunk(taskId, mode, { type: "error", content: result.message });
          continue;
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
        while (true) {
          bytesRead = fs.readSync(tailer.fd, buf, 0, buf.length, tailer.offset);
          if (bytesRead === 0) break;
          tailer.offset += bytesRead;
          tailer.lineBuffer += buf.toString("utf8", 0, bytesRead);

          // Process complete lines.  Track the file offset of the start of
          // each line so that processLine can peek at the correct position
          // (the byte immediately after the line's trailing newline), rather
          // than at tailer.offset which has been advanced to the end of the
          // entire read buffer.
          const lines = tailer.lineBuffer.split("\n");
          tailer.lineBuffer = lines.pop()!; // keep incomplete last fragment
          let lineStart = tailer.lineBufferOffset;
          for (const line of lines) {
            if (tailer.stopped) return;
            // afterLineOffset = position of byte after this line's '\n'
            const afterLineOffset =
              lineStart + Buffer.byteLength(line, "utf8") + 1;
            processLine(line, afterLineOffset);
            lineStart = afterLineOffset;
          }
          // lineBufferOffset now points to the start of the incomplete fragment
          tailer.lineBufferOffset = lineStart;
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
  ): Promise<{ alive: boolean; sessionAlive: boolean }> {
    const logPath = buildLogPath(tmuxSession);
    if (!fs.existsSync(logPath)) {
      return { alive: false, sessionAlive: false };
    }

    const sessionAlive = await this.tmuxSessionExists(tmuxSession);

    if (!sessionAlive) {
      // Agent finished while the app was closed. Replay the entire log
      // so the renderer gets all output including the grove_exit sentinel
      // (which fires a "done" chunk and resets isRunning).
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
      0, // Start from beginning for reconnect replay
      undefined, // taskFilePath unknown on reconnect (not persisted in tmux)
    );

    return { alive: true, sessionAlive };
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
    this.cleanupGroveConfig(tmuxSession);
    try {
      await this.exec(["kill-session", "-t", tmuxSession]);
    } catch {
      // Session may already be dead
    }
    // Preserve the .log file so history can be replayed after cancel + reload.
    // Only clean up the ephemeral run files (script, message, stderr).
    this.cleanupRunFiles(tmuxSession, { preserveLog: true });
  }

  // ── Detach all tailers (on app quit, keep tmux alive) ──────

  detachAll(): void {
    for (const [session] of this.tailers) {
      this.stopTailer(session);
    }
    // Clean up any Grove-written opencode.json files — the agent already
    // started and read the config, so it no longer needs the file.
    for (const [session, configPath] of this.wroteConfigFiles) {
      try {
        fs.unlinkSync(configPath);
      } catch {
        // ignore
      }
      this.wroteConfigFiles.delete(session);
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

  /** Capture the visible contents of a tmux pane, joining wrapped lines. */
  async capturePane(session: string): Promise<string> {
    return new Promise((resolve) => {
      const proc = spawn("tmux", ["capture-pane", "-pt", session, "-J"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      proc.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
      proc.on("close", () => {
        resolve(stdout);
      });
      proc.on("error", () => {
        resolve("");
      });
    });
  }

  // ── Private helpers ────────────────────────────────────────

  /** Writes a minimal opencode.json to suppress ask-permission prompts. */
  private writeOpencodeConfig(tmuxSession: string, cwd: string): void {
    writeOpencodeConfig(cwd, this.wroteConfigFiles, tmuxSession);
  }

  private cleanupGroveConfig(tmuxSession: string): void {
    cleanupGroveConfig(this.wroteConfigFiles, tmuxSession);
  }

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

  private cleanupRunFiles(
    tmuxSession: string,
    opts: { preserveLog?: boolean } = {},
  ): void {
    const extensions = opts.preserveLog
      ? ["sh", "msg", "err"]
      : ["log", "sh", "msg", "err"];
    for (const ext of extensions) {
      const p = path.join(RUNS_DIR, `${tmuxSession}.${ext}`);
      try {
        fs.unlinkSync(p);
      } catch {
        // ignore
      }
    }
  }

  // ── Line parsing (shared between start and reconnect) ──────

  /** Parse result can be a regular PlanChunk or an internal sentinel. */
  private parseLine(
    agent: PlanAgent,
    line: string,
    copilotParser?: CopilotLineParser,
  ): Array<
    | PlanChunk
    | { type: "__grove_exit"; code: number }
    | { type: "__grove_error"; message: string }
  > {
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
        return parseOpencodeLine(obj);
      } else {
        return (copilotParser ?? new CopilotLineParser()).parse(obj);
      }
    } catch {
      const stripped = trimmed.replace(/\x1b\[[0-9;]*[mGKHF]/g, "");
      if (!stripped) return [];
      return [{ type: "text", content: stripped }];
    }
  }
}
