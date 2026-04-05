import { spawn, ChildProcess } from "child_process";
import * as readline from "readline";
import * as os from "os";
import * as path from "path";
import type { PlanAgent, PlanChunk, PlanMode } from "@shared/types";
import { TmuxSupervisor, buildTmuxSessionName } from "./tmuxSupervisor";

type ChunkCallback = (taskId: string, mode: PlanMode, chunk: PlanChunk) => void;

interface ActiveRun {
  proc: ChildProcess;
  rl: readline.Interface | null;
  taskId: string;
  mode: PlanMode;
}

interface RunOpts {
  taskId: string;
  mode: PlanMode;
  agent: PlanAgent;
  model: string | null;
  message: string;
  /** Short user-facing display text to write as first log line (for history replay) */
  displayMessage: string;
  sessionId: string | null;
  cwd: string;
  taskFilePath: string;
  workspacePath: string;
  onChunk: ChunkCallback;
  onComplete?: () => void;
}

interface PlanRunner {
  start(opts: RunOpts): void;
  cancel(runKey: string): void;
  detach(): void;
}

const SIGKILL_TIMEOUT_MS = 5000;

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

function agentBinary(agent: PlanAgent): string {
  return agent === "opencode" ? "opencode" : "copilot";
}

function buildArgs(
  agent: PlanAgent,
  mode: PlanMode,
  model: string | null,
  message: string,
  sessionId: string | null,
  taskFilePath: string,
): string[] {
  if (agent === "opencode") {
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
    const args = [
      "-p",
      message,
      "--output-format",
      "json",
      "--stream",
      "on",
      "--no-color",
    ];
    if (mode === "plan") {
      args.push("--deny-tool=shell");
      args.push(`--allow-tool=write(${taskFilePath})`);
    }
    if (model) {
      args.push(`--model=${model}`);
    }
    if (sessionId) {
      args.push(`--resume=${sessionId}`);
    }
    return args;
  }
}

function parseLine(agent: PlanAgent, line: string): PlanChunk[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  try {
    const obj = JSON.parse(trimmed);
    if (agent === "opencode") {
      return parseOpencodeLine(obj);
    } else {
      return parseCopilotLine(obj);
    }
  } catch {
    const stripped = trimmed.replace(/\x1b\[[0-9;]*[mGKHF]/g, "");
    if (!stripped) return [];
    return [{ type: "text", content: stripped }];
  }
}

function parseOpencodeLine(obj: Record<string, unknown>): PlanChunk[] {
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

function parseCopilotLine(obj: Record<string, unknown>): PlanChunk[] {
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

class SpawnPlanRunner implements PlanRunner {
  private activeRuns = new Map<string, ActiveRun>();

  start(opts: RunOpts): void {
    const runKey = `${opts.mode}:${opts.taskId}`;
    this.cancel(runKey);

    console.log(
      `[SpawnPlanRunner][${runKey}] start() agent=${opts.agent} model=${opts.model ?? "default"} sessionId=${opts.sessionId ?? "null"}`,
    );

    const args = buildArgs(
      opts.agent,
      opts.mode,
      opts.model,
      opts.message,
      opts.sessionId,
      opts.taskFilePath,
    );

    const proc = spawn(agentBinary(opts.agent), args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: buildEnvPath() },
    });

    if (!proc.stdout) {
      opts.onChunk(opts.taskId, opts.mode, {
        type: "error",
        content: "Failed to capture agent stdout",
      });
      proc.kill();
      return;
    }

    console.log(
      `[SpawnPlanRunner][${runKey}] spawned pid=${proc.pid ?? "?"} agent=${opts.agent}`,
    );

    const rl = readline.createInterface({ input: proc.stdout });
    this.activeRuns.set(runKey, {
      proc,
      rl,
      taskId: opts.taskId,
      mode: opts.mode,
    });

    let sessionIdEmitted = false;

    rl.on("line", (line) => {
      const chunks = parseLine(opts.agent, line);
      for (const chunk of chunks) {
        if (chunk.type === "session_id") {
          if (sessionIdEmitted) continue;
          sessionIdEmitted = true;
        }
        opts.onChunk(opts.taskId, opts.mode, chunk);
      }
    });

    rl.on("close", () => {
      console.log(
        `[SpawnPlanRunner][${runKey}] readline closed, exitCode=${proc.exitCode}`,
      );
      this.activeRuns.delete(runKey);
      opts.onChunk(opts.taskId, opts.mode, {
        type: "done",
        content: String(proc.exitCode ?? 0),
      });
      opts.onComplete?.();
    });

    proc.stderr?.on("data", (data: Buffer) => {
      console.warn(`[SpawnPlanRunner][${runKey}] stderr:`, data.toString());
    });

    proc.on("error", (err) => {
      console.error(`[SpawnPlanRunner][${runKey}] proc error:`, err.message);
      rl.close();
      this.activeRuns.delete(runKey);
      opts.onChunk(opts.taskId, opts.mode, {
        type: "error",
        content: err.message,
      });
    });
  }

  cancel(runKey: string): void {
    const run = this.activeRuns.get(runKey);
    if (run) {
      run.rl?.close();
      run.proc.kill("SIGTERM");
      const proc = run.proc;
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill("SIGKILL");
        }
      }, SIGKILL_TIMEOUT_MS);
      this.activeRuns.delete(runKey);
    }
  }

  cancelAll(): void {
    for (const [runKey] of this.activeRuns) {
      this.cancel(runKey);
    }
  }

  detach(): void {
    for (const [, run] of this.activeRuns) {
      run.rl?.close();
    }
    this.activeRuns.clear();
  }
}

class TmuxPlanRunner implements PlanRunner {
  private tmux: TmuxSupervisor;
  private activeKeys = new Set<string>();

  constructor(tmux: TmuxSupervisor) {
    this.tmux = tmux;
  }

  async start(opts: RunOpts): Promise<void> {
    const runKey = `${opts.mode}:${opts.taskId}`;
    this.cancel(runKey);

    const tmuxSession = buildTmuxSessionName(
      opts.workspacePath,
      opts.taskId,
      opts.mode,
    );

    const success = await this.tmux.start(
      tmuxSession,
      opts.sessionId,
      opts.cwd,
      opts.agent,
      opts.model,
      opts.message,
      opts.displayMessage,
      opts.taskId,
      opts.mode,
      opts.taskFilePath,
      opts.onChunk,
      opts.onComplete,
    );

    if (!success) {
      opts.onChunk(opts.taskId, opts.mode, {
        type: "error",
        content: "Failed to start tmux session",
      });
      return;
    }

    this.activeKeys.add(runKey);
  }

  cancel(runKey: string, workspacePath?: string): void {
    if (!this.activeKeys.has(runKey)) return;

    const [mode, taskId] = runKey.split(":");
    const tmuxSession = buildTmuxSessionName(
      workspacePath ?? "",
      taskId,
      mode as PlanMode,
    );
    this.tmux.kill(tmuxSession);
    this.activeKeys.delete(runKey);
  }

  detach(): void {
    this.tmux.detachAll();
    this.activeKeys.clear();
  }
}

export class PlanManager {
  private spawnRunner: SpawnPlanRunner;
  private tmuxRunner: TmuxPlanRunner | null = null;
  private onChunkCb: ChunkCallback | null = null;
  private tmuxAvailable: boolean | null = null;
  private tmuxSupervisor: TmuxSupervisor;

  constructor() {
    this.spawnRunner = new SpawnPlanRunner();
    this.tmuxSupervisor = new TmuxSupervisor();
  }

  async init(): Promise<void> {
    // Intentionally not calling cleanupOrphanedRuns() here.
    // That function deletes run files for any session where tmux is not alive,
    // but with no tmux server running it would delete ALL log files on startup —
    // before the reconnect effect has a chance to replay them.  The start()
    // method already removes old run files for the same session name when a new
    // run begins, so orphan cleanup is not needed at init time.
  }

  setOnChunk(cb: ChunkCallback): void {
    this.onChunkCb = cb;
  }

  async isTmuxAvailable(): Promise<boolean> {
    if (this.tmuxAvailable !== null) {
      return this.tmuxAvailable;
    }
    this.tmuxAvailable = await this.tmuxSupervisor.isTmuxAvailable();
    return this.tmuxAvailable;
  }

  async ensureTmuxRunner(): Promise<void> {
    if (!this.tmuxRunner) {
      this.tmuxRunner = new TmuxPlanRunner(this.tmuxSupervisor);
    }
  }

  run(
    taskId: string,
    mode: PlanMode,
    agent: PlanAgent,
    model: string | null,
    message: string,
    displayMessage: string,
    sessionId: string | null,
    cwd: string,
    taskFilePath: string,
    workspacePath: string,
    onComplete?: () => void,
  ): void {
    const onChunk: ChunkCallback = (tid, m, chunk) => {
      this.onChunkCb?.(tid, m, chunk);
    };

    const checkAndRun = async () => {
      const tmuxAvailable = await this.isTmuxAvailable();

      if (tmuxAvailable) {
        await this.ensureTmuxRunner();
        const tmuxRunner = this.tmuxRunner!;

        tmuxRunner.start({
          taskId,
          mode,
          agent,
          model,
          message,
          displayMessage,
          sessionId,
          cwd,
          taskFilePath,
          workspacePath,
          onChunk,
          onComplete,
        } as RunOpts);
      } else {
        this.spawnRunner.start({
          taskId,
          mode,
          agent,
          model,
          message,
          displayMessage,
          sessionId,
          cwd,
          taskFilePath,
          workspacePath,
          onChunk,
          onComplete,
        } as RunOpts);
      }
    };

    checkAndRun();
  }

  cancel(runKey: string, workspacePath?: string): void {
    this.spawnRunner.cancel(runKey);
    if (this.tmuxRunner) {
      this.tmuxRunner.cancel(runKey, workspacePath);
    }
  }

  cancelAll(): void {
    this.spawnRunner.cancelAll();
    if (this.tmuxRunner) {
      for (const key of this.tmuxRunner["activeKeys"]) {
        this.tmuxRunner.cancel(key);
      }
    }
  }

  detachAll(): void {
    this.spawnRunner.detach();
    if (this.tmuxRunner) {
      this.tmuxRunner.detach();
    }
  }

  async checkTmuxSession(tmuxSession: string): Promise<boolean> {
    return this.tmuxSupervisor.checkSession(tmuxSession);
  }

  async reconnectTmuxSession(
    tmuxSession: string,
    taskId: string,
    mode: PlanMode,
    agent: PlanAgent,
    onComplete?: () => void,
  ): Promise<boolean> {
    const onChunk: ChunkCallback = (tid, m, chunk) => {
      this.onChunkCb?.(tid, m, chunk);
    };
    const result = await this.tmuxSupervisor.reconnect(
      tmuxSession,
      taskId,
      mode,
      agent,
      onChunk,
      onComplete,
    );
    return result.alive;
  }

  listModels(workspacePath: string): Promise<string[]> {
    return new Promise((resolve) => {
      const proc = spawn("opencode", ["models"], {
        cwd: workspacePath,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PATH: buildEnvPath() },
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
        const modelRe = /\b([a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+)\b/g;
        const seen = new Set<string>();
        const models: string[] = [];
        let match: RegExpExecArray | null;
        while ((match = modelRe.exec(stdout)) !== null) {
          const token = match[1];
          if (!seen.has(token)) {
            seen.add(token);
            models.push(token);
          }
        }
        resolve(models);
      });
    });
  }
}
