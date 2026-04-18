import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import type { PlanAgent, PlanMode, PlanChunk } from "@shared/types";

const RUNS_DIR = path.join(os.homedir(), ".grove", "runs");

type ChunkCallback = (taskId: string, mode: PlanMode, chunk: PlanChunk) => void;

interface LogTailer {
  watcher: fs.FSWatcher | null;
  pollTimer: NodeJS.Timeout | null;
  fd: number;
  offset: number;
  lineBuffer: string;
  lineBufferOffset: number;
  stopped: boolean;
  taskFilePath?: string;
}

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

export class TmuxSupervisor {
  private tailers = new Map<string, LogTailer>();
  private tmuxAvailable: boolean | null = null;
  private wroteConfigFiles = new Map<string, string>();
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

  private async ensureRunsDir(): Promise<boolean> {
    try {
      await fs.promises.mkdir(RUNS_DIR, { recursive: true });
      return true;
    } catch (err) {
      console.error("[TmuxSupervisor] Failed to create runs directory:", err);
      return false;
    }
  }

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

    const filesToClean = agentSessionId
      ? [scriptPath, msgPath, errPath]
      : [logPath, scriptPath, msgPath, errPath];
    for (const f of filesToClean) {
      try {
        fs.unlinkSync(f);
      } catch {
        // doesn't exist, fine
      }
    }

    fs.writeFileSync(msgPath, message, "utf-8");

    const userMsgLine = JSON.stringify({
      type: "grove_user_message",
      content: displayMessage,
    });
    if (agentSessionId) {
      fs.appendFileSync(logPath, userMsgLine + "\n", "utf-8");
    } else {
      fs.writeFileSync(logPath, userMsgLine + "\n", "utf-8");
    }

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

    try {
      await this.exec(["kill-session", "-t", tmuxSession]);
    } catch {
      // doesn't exist, fine
    }

    if (agent === "opencode") {
      this.writeOpencodeConfig(tmuxSession, cwd);
    }

    const tailerStartOffset = fs.statSync(logPath).size;
    this.startTailer(
      tmuxSession,
      logPath,
      taskId,
      mode,
      onChunk,
      onComplete,
      tailerStartOffset,
      taskFilePath,
    );

    try {
      await this.exec([
        "new-session",
        "-d",
        "-s",
        tmuxSession,
        "-c",
        cwd,
        "-E",
        `env PATH='${process.env.PATH}' bash '${scriptPath}'`,
      ]);
    } catch (err) {
      console.error("[TmuxSupervisor] Failed to create tmux session:", err);
      this.stopTailer(tmuxSession);
      this.cleanupGroveConfig(tmuxSession);
      return false;
    }

    return true;
  }

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
        parts.push("--allow-all-tools");
      }
      if (model) parts.push(`--model=${this.shellQuote(model)}`);
      if (sessionId) parts.push(`--resume=${this.shellQuote(sessionId)}`);
      argsStr = parts.join(" ");
    }

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
    return "'" + s.replace(/'/g, "'\\''") + "'";
  }

  private startTailer(
    tmuxSession: string,
    logPath: string,
    taskId: string,
    mode: PlanMode,
    onChunk: ChunkCallback,
    onComplete?: () => void,
    startOffset: number = 0,
    taskFilePath?: string,
  ): void {
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
    };
    this.tailers.set(tmuxSession, tailer);

    const processLine = (line: string, afterLineOffset: number): void => {
      const results = this.parseLine(line);
      for (const result of results) {
        if (result.type === "__grove_exit") {
          const peek = Buffer.alloc(1);
          const peeked = fs.readSync(tailer.fd, peek, 0, 1, afterLineOffset);
          const isLastSentinel = peeked === 0;

          if (isLastSentinel) {
            this.stopTailer(tmuxSession);
            this.cleanupGroveConfig(tmuxSession);

            if (result.code !== 0) {
              try {
                const errPath = buildErrPath(tmuxSession);
                const stderr = fs.existsSync(errPath)
                  ? fs.readFileSync(errPath, "utf-8").trim()
                  : "";
                if (stderr) {
                  onChunk(taskId, mode, { type: "stderr", content: stderr });
                }
              } catch {
                // best-effort
              }
            }

            onChunk(taskId, mode, {
              type: "done",
              content: String(result.code),
            });

            if (tailer.taskFilePath && this.updateTask) {
              const wsRoot = path.dirname(
                path.dirname(path.dirname(tailer.taskFilePath)),
              );
              this.updateTask(
                wsRoot,
                tailer.taskFilePath,
                mode === "execute"
                  ? { execLastExitCode: result.code }
                  : { planLastExitCode: result.code },
              ).catch((err: unknown) => {
                console.warn(
                  `[TmuxSupervisor] Failed to persist exit code for ${taskId}:`,
                  err,
                );
              });
            }

            onChunk(taskId, mode, { type: "replay_done", content: "" });
            onComplete?.();
          } else {
            onChunk(taskId, mode, {
              type: "done",
              content: String(result.code),
            });
          }
          return;
        }
        if (result.type === "user_message") {
          onChunk(taskId, mode, result);
        }
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

          const lines = tailer.lineBuffer.split("\n");
          tailer.lineBuffer = lines.pop()!;
          let lineStart = tailer.lineBufferOffset;
          for (const line of lines) {
            if (tailer.stopped) return;
            const afterLineOffset =
              lineStart + Buffer.byteLength(line, "utf8") + 1;
            processLine(line, afterLineOffset);
            lineStart = afterLineOffset;
          }
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

    try {
      tailer.watcher = fs.watch(logPath, () => drain());
    } catch (err) {
      console.warn(
        `[TmuxSupervisor] fs.watch failed for ${logPath}, using poll only:`,
        err,
      );
    }

    tailer.pollTimer = setInterval(() => drain(), 50);
  }

  async reconnect(
    tmuxSession: string,
    taskId: string,
    mode: PlanMode,
    onChunk: ChunkCallback,
    onComplete?: () => void,
  ): Promise<{ alive: boolean; sessionAlive: boolean }> {
    const logPath = buildLogPath(tmuxSession);
    if (!fs.existsSync(logPath)) {
      return { alive: false, sessionAlive: false };
    }

    const sessionAlive = await this.tmuxSessionExists(tmuxSession);

    this.startTailer(
      tmuxSession,
      logPath,
      taskId,
      mode,
      onChunk,
      onComplete,
      0,
      undefined,
    );

    return { alive: true, sessionAlive };
  }

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

  async kill(tmuxSession: string): Promise<void> {
    this.stopTailer(tmuxSession);
    this.cleanupGroveConfig(tmuxSession);
    try {
      await this.exec(["kill-session", "-t", tmuxSession]);
    } catch {
      // Session may already be dead
    }
    this.cleanupRunFiles(tmuxSession, { preserveLog: true });
  }

  detachAll(): void {
    for (const [session] of this.tailers) {
      this.stopTailer(session);
    }
    for (const [session, configPath] of this.wroteConfigFiles) {
      try {
        fs.unlinkSync(configPath);
      } catch {
        // ignore
      }
      this.wroteConfigFiles.delete(session);
    }
  }

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

  async checkSession(tmuxSession: string): Promise<boolean> {
    return this.tmuxSessionExists(tmuxSession);
  }

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

  private writeOpencodeConfig(tmuxSession: string, cwd: string): void {
    const configPath = path.join(cwd, "opencode.json");
    if (fs.existsSync(configPath)) {
      return;
    }
    const content = JSON.stringify(
      { permissions: { autoAccept: "always" } },
      null,
      2,
    );
    fs.writeFileSync(configPath, content, "utf-8");
    this.wroteConfigFiles.set(tmuxSession, configPath);
  }

  private cleanupGroveConfig(tmuxSession: string): void {
    const configPath = this.wroteConfigFiles.get(tmuxSession);
    if (configPath) {
      try {
        fs.unlinkSync(configPath);
      } catch {
        // ignore
      }
      this.wroteConfigFiles.delete(tmuxSession);
    }
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

  private parseLine(
    line: string,
  ): Array<PlanChunk | { type: "__grove_exit"; code: number }> {
    const trimmed = line.trim();
    if (!trimmed) return [];

    try {
      const obj = JSON.parse(trimmed);

      if (obj.type === "grove_exit" && typeof obj.code === "number") {
        return [{ type: "__grove_exit", code: obj.code }];
      }

      if (
        obj.type === "grove_user_message" &&
        typeof obj.content === "string"
      ) {
        return [{ type: "user_message", content: obj.content }];
      }
    } catch {
      // Not JSON, ignore
    }

    return [];
  }
}
