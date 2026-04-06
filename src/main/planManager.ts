import { spawn, ChildProcess } from "child_process";
import * as readline from "readline";
import * as os from "os";
import * as path from "path";
import type {
  PlanAgent,
  PlanChunk,
  PlanMode,
  ToolUseData,
} from "@shared/types";
import { TmuxSupervisor, buildTmuxSessionName } from "./tmuxSupervisor";

type ChunkCallback = (taskId: string, mode: PlanMode, chunk: PlanChunk) => void;

interface ActiveRun {
  proc: ChildProcess;
  rl: readline.Interface | null;
  taskId: string;
  mode: PlanMode;
  /** Chunk callback captured at start() time for use in cancel(). */
  onChunk: ChunkCallback;
  /**
   * Set to true by cancel() before rl.close() so the 'close' handler can
   * skip the duplicate done emission.
   */
  cancelled: boolean;
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

  if (
    obj.type === "tool_use" &&
    obj.part !== null &&
    typeof obj.part === "object"
  ) {
    const part = obj.part as Record<string, unknown>;
    const tool = typeof part.tool === "string" ? part.tool : "unknown";
    const state =
      part.state !== null && typeof part.state === "object"
        ? (part.state as Record<string, unknown>)
        : null;

    // Only emit for completed tool invocations
    if (state && state.status === "completed") {
      const title = typeof state.title === "string" ? state.title : "";
      const rawOutput = typeof state.output === "string" ? state.output : "";
      const MAX_OUTPUT = 5 * 1024;
      const truncated = rawOutput.length > MAX_OUTPUT;
      const output = truncated ? rawOutput.slice(0, MAX_OUTPUT) : rawOutput;

      const input =
        state.input !== null && typeof state.input === "object"
          ? (state.input as Record<string, unknown>)
          : {};

      const metadata =
        state.metadata !== null && typeof state.metadata === "object"
          ? (state.metadata as Record<string, unknown>)
          : {};
      const exitCode = typeof metadata.exit === "number" ? metadata.exit : null;

      const timeRaw =
        state.time !== null && typeof state.time === "object"
          ? (state.time as Record<string, unknown>)
          : null;
      const time =
        timeRaw &&
        typeof timeRaw.start === "number" &&
        typeof timeRaw.end === "number"
          ? { start: timeRaw.start, end: timeRaw.end }
          : null;

      const data: ToolUseData = {
        tool,
        input,
        output,
        truncated,
        title,
        exitCode,
        time,
      };
      chunks.push({ type: "tool_use", content: title, data });
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
    const run: ActiveRun = {
      proc,
      rl,
      taskId: opts.taskId,
      mode: opts.mode,
      onChunk: opts.onChunk,
      cancelled: false,
    };
    this.activeRuns.set(runKey, run);

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
      // If cancel() already emitted a synthetic done chunk, skip to avoid a
      // duplicate that could flip isRunning back to false a second time.
      if (run.cancelled) return;
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
      // Mark as cancelled BEFORE calling rl.close() so the 'close' event
      // handler (which may fire synchronously) knows to skip its done emission.
      run.cancelled = true;
      // Emit a synthetic done with a definitive exit code of 1 so the renderer
      // immediately transitions isRunning → false and lastExitCode → 1.
      run.onChunk(run.taskId, run.mode, { type: "done", content: "1" });
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
  /**
   * Callbacks captured per run so cancel() can emit a synthetic done chunk
   * without needing to route through PlanManager.onChunkCb.
   */
  private runCallbacks = new Map<
    string,
    { taskId: string; mode: PlanMode; onChunk: ChunkCallback }
  >();

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

    // Wrap onComplete so that when a run finishes normally (via the grove_exit
    // sentinel in the log), we clean up activeKeys and runCallbacks immediately.
    // Without this, the next call to start() for the same task would find the
    // stale runKey in activeKeys and call cancel(), which emits a synthetic
    // `done` chunk with exit code 1 — causing a false-positive "Is ${agent}
    // installed and on PATH?" warning in the renderer for every follow-up send.
    const wrappedOnComplete = async (): Promise<void> => {
      this.activeKeys.delete(runKey);
      this.runCallbacks.delete(runKey);
      await opts.onComplete?.();
    };

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
      wrappedOnComplete,
    );

    if (!success) {
      opts.onChunk(opts.taskId, opts.mode, {
        type: "error",
        content: "Failed to start tmux session",
      });
      return;
    }

    this.runCallbacks.set(runKey, {
      taskId: opts.taskId,
      mode: opts.mode,
      onChunk: opts.onChunk,
    });
    this.activeKeys.add(runKey);
  }

  cancel(runKey: string, workspacePath?: string): void {
    if (!this.activeKeys.has(runKey)) return;

    // Emit a synthetic done chunk with exit code 1 immediately so the renderer
    // transitions isRunning → false in the same render cycle as the cancel.
    // This must happen BEFORE kill() stops the tailer, since the tailer's
    // grove_exit sentinel will never be read after stopTailer() closes the fd.
    const cb = this.runCallbacks.get(runKey);
    if (cb) {
      cb.onChunk(cb.taskId, cb.mode, { type: "done", content: "1" });
      this.runCallbacks.delete(runKey);
    }

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
    this.runCallbacks.clear();
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
