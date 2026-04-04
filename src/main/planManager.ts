import { spawn, ChildProcess } from "child_process";
import * as readline from "readline";
import * as os from "os";
import * as path from "path";
import type { PlanAgent, PlanChunk } from "@shared/types";

type ChunkCallback = (taskId: string, chunk: PlanChunk) => void;

interface ActiveRun {
  proc: ChildProcess;
  rl: readline.Interface | null;
  taskId: string;
}

const SIGKILL_TIMEOUT_MS = 5000;

export class PlanManager {
  private activeRuns = new Map<string, ActiveRun>(); // taskId → run
  private onChunkCb: ChunkCallback | null = null;

  setOnChunk(cb: ChunkCallback): void {
    this.onChunkCb = cb;
  }

  /**
   * Start or continue a plan session.
   * @param taskId         Task ID (e.g. "T-001") — used as the stream routing key
   * @param agent          "opencode" | "copilot"
   * @param model          Model string (e.g. "anthropic/claude-opus-4-5"), or null for agent default
   * @param message        The assembled prompt (first message) or plain user reply
   * @param sessionId      Existing session ID to continue, or null for new session
   * @param workspacePath  Absolute path to the workspace root
   * @param taskFilePath   Absolute path to the task markdown file (for copilot allow-tool)
   */
  run(
    taskId: string,
    agent: PlanAgent,
    model: string | null,
    message: string,
    sessionId: string | null,
    workspacePath: string,
    taskFilePath: string,
  ): void {
    // Cancel any in-flight run for this task
    this.cancel(taskId);

    console.log(
      `[PlanManager][${taskId}] run() called agent=${agent} model=${model ?? "default"} sessionId=${sessionId ?? "null"}`,
    );
    const args = this.buildArgs(agent, model, message, sessionId, taskFilePath);
    const proc = spawn(this.agentBinary(agent), args, {
      cwd: workspacePath,
      // stdin must be 'ignore' — the default 'pipe' creates a writable stream
      // that CLI tools (opencode, copilot) detect as piped input. If stdin is
      // never written-to or closed the child process hangs waiting for EOF,
      // which prevents any stdout from being produced.
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: this.buildEnvPath() },
    });

    // Guard against null stdout (spawn failure, misconfigured stdio)
    if (!proc.stdout) {
      this.onChunkCb?.(taskId, {
        type: "error",
        content: "Failed to capture agent stdout",
      });
      proc.kill();
      return;
    }

    console.log(
      `[PlanManager][${taskId}] spawned pid=${proc.pid ?? "?"} agent=${agent}`,
    );

    const rl = readline.createInterface({ input: proc.stdout });
    this.activeRuns.set(taskId, { proc, rl, taskId });

    rl.on("line", (line) => {
      console.log(`[PlanManager][${taskId}] stdout line:`, line.slice(0, 120));
      const chunks = this.parseLine(agent, line);
      console.log(
        `[PlanManager][${taskId}] parsed chunks:`,
        chunks.map((c) => c.type),
      );
      for (const chunk of chunks) {
        this.onChunkCb?.(taskId, chunk);
      }
    });

    // Emit "done" when readline finishes (after all buffered lines are
    // processed), NOT on proc.close — this prevents the done chunk from
    // arriving before the last text chunks.
    rl.on("close", () => {
      console.log(
        `[PlanManager][${taskId}] readline closed, exitCode=${proc.exitCode}`,
      );
      this.activeRuns.delete(taskId);
      this.onChunkCb?.(taskId, {
        type: "done",
        content: String(proc.exitCode ?? 0),
      });
    });

    proc.stderr?.on("data", (data: Buffer) => {
      console.warn(`[PlanManager][${taskId}] stderr:`, data.toString());
    });

    proc.on("error", (err) => {
      console.error(`[PlanManager][${taskId}] proc error:`, err.message);
      rl.close();
      this.activeRuns.delete(taskId);
      this.onChunkCb?.(taskId, {
        type: "error",
        content: err.message,
      });
    });
  }

  cancel(taskId: string): void {
    const run = this.activeRuns.get(taskId);
    if (run) {
      // Close readline to stop line processing
      run.rl?.close();
      // Send SIGTERM first
      run.proc.kill("SIGTERM");
      // SIGKILL fallback if process doesn't exit within timeout
      const proc = run.proc;
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill("SIGKILL");
        }
      }, SIGKILL_TIMEOUT_MS);
      this.activeRuns.delete(taskId);
    }
  }

  cancelAll(): void {
    for (const [taskId] of this.activeRuns) {
      this.cancel(taskId);
    }
  }

  /**
   * List available models by running `opencode models`.
   * Parses each output line for tokens in `provider/model` format.
   * Returns an empty array on error (caller should fall back to defaults).
   */
  listModels(workspacePath: string): Promise<string[]> {
    return new Promise((resolve) => {
      const proc = spawn("opencode", ["models"], {
        cwd: workspacePath,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PATH: this.buildEnvPath() },
      });

      let stdout = "";
      proc.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.on("error", (err) => {
        console.warn("[PlanManager] listModels spawn error:", err.message);
        resolve([]);
      });

      proc.on("close", () => {
        // Extract provider/model tokens from the output. The `opencode models`
        // table contains entries in "provider/model" format. We also filter out
        // anything that looks like a filesystem path.
        const modelRe = /\b([a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+)\b/g;
        const seen = new Set<string>();
        const models: string[] = [];
        let match: RegExpExecArray | null;
        while ((match = modelRe.exec(stdout)) !== null) {
          const token = match[1];
          // Skip filesystem-looking paths and duplicates
          if (!seen.has(token)) {
            seen.add(token);
            models.push(token);
          }
        }
        resolve(models);
      });
    });
  }

  /**
   * Build a PATH string that includes common developer tool install locations
   * which are normally available in a user's shell but not in an Electron
   * process launched from the Dock or Finder on macOS.
   */
  private buildEnvPath(): string {
    const home = os.homedir();
    const extras = [
      path.join(home, ".opencode", "bin"), // opencode default install
      path.join(home, ".local", "bin"), // pip --user, cargo, etc.
      path.join(home, ".npm-global", "bin"), // npm global
      path.join(home, "go", "bin"), // Go binaries
      "/opt/homebrew/bin", // Homebrew (Apple Silicon)
      "/opt/homebrew/sbin",
      "/usr/local/bin", // Homebrew (Intel) + misc tools
      "/usr/local/sbin",
    ];
    const current = process.env.PATH ?? "";
    const parts = current.split(path.delimiter).filter(Boolean);
    // Prepend extras that aren't already present
    for (const extra of extras.reverse()) {
      if (!parts.includes(extra)) parts.unshift(extra);
    }
    return parts.join(path.delimiter);
  }

  private agentBinary(agent: PlanAgent): string {
    return agent === "opencode" ? "opencode" : "copilot";
  }

  private buildArgs(
    agent: PlanAgent,
    model: string | null,
    message: string,
    sessionId: string | null,
    taskFilePath: string,
  ): string[] {
    if (agent === "opencode") {
      // Use "--" to signal end-of-flags and prevent flag injection from message content.
      // Note: --format json emits raw JSON events including thinking blocks when the
      // model supports extended thinking — no separate --thinking flag is needed.
      const args = ["run", "--format", "json"];
      if (model) {
        args.push("--model", model);
      }
      if (sessionId) {
        args.push("--session", sessionId);
      }
      args.push("--", message);
      return args;
    } else {
      // copilot — message follows -p flag so flag injection is less of a
      // concern, but we still place it immediately after -p as the flag value.
      const args = [
        "-p",
        message,
        "--output-format",
        "json",
        "--stream",
        "on",
        "--no-color",
        "--deny-tool=shell",
        `--allow-tool=write(${taskFilePath})`,
      ];
      if (model) {
        args.push(`--model=${model}`);
      }
      if (sessionId) {
        args.push(`--resume=${sessionId}`);
      }
      return args;
    }
  }

  private parseLine(agent: PlanAgent, line: string): PlanChunk[] {
    const trimmed = line.trim();
    if (!trimmed) return [];

    try {
      const obj = JSON.parse(trimmed);
      if (agent === "opencode") {
        return this.parseOpencodeLine(obj);
      } else {
        return this.parseCopilotLine(obj);
      }
    } catch {
      // Not JSON — strip ANSI and emit as raw text
      const stripped = trimmed.replace(/\x1b\[[0-9;]*[mGKHF]/g, "");
      if (!stripped) return [];
      return [{ type: "text", content: stripped }];
    }
  }

  private parseOpencodeLine(obj: Record<string, unknown>): PlanChunk[] {
    const chunks: PlanChunk[] = [];

    // Session ID — present on every event as `sessionID`
    // Emit it on the first event that carries it (step_start fires first)
    if (obj.type === "step_start" && typeof obj.sessionID === "string") {
      chunks.push({ type: "session_id", content: obj.sessionID });
    }

    // Text / thinking content — emitted as individual streaming events
    // { type: "text", part: { type: "text", text: "..." } }
    // { type: "text", part: { type: "thinking", thinking: "..." } }  (with --thinking flag)
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

    // Streaming delta format (copilot may emit partial tokens)
    if (obj.type === "delta" && typeof obj.content === "string") {
      chunks.push({ type: "text", content: obj.content });
    }

    return chunks;
  }
}
