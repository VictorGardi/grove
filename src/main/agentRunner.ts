import { spawn, ChildProcess } from "child_process";
import * as readline from "readline";
import type { PlanAgent, PlanChunk, PlanMode } from "@shared/types";
import * as tasks from "./tasks";
import { TmuxSupervisor, buildTmuxSessionName } from "./tmuxSupervisor";
import { buildEnvPath } from "./env";
import { parseOpencodeLine, CopilotLineParser } from "./agentOutputParser";
import type { GroveErrorChunk } from "./agentOutputParser";
import { writeOpencodeConfig, cleanupGroveConfig } from "./opencodeConfig";

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

interface IAgentRunner {
  start(opts: RunOpts): Promise<void>;
  cancel(runKey: string): void;
  detach(): void;
}

const SIGKILL_TIMEOUT_MS = 5000;

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
    const args = ["run", "--format", "json", "--agent", "build", "--thinking"];
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
    } else {
      // Autopilot mode: copilot works autonomously without waiting for user input.
      args.push("--autopilot");
      args.push("--allow-all-tools");
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

function parseLine(
  agent: PlanAgent,
  line: string,
  copilotParser?: CopilotLineParser,
): { chunks: PlanChunk[]; error?: GroveErrorChunk } {
  const trimmed = line.trim();
  if (!trimmed) return { chunks: [] };

  try {
    const obj = JSON.parse(trimmed);
    if (agent === "opencode") {
      const result = parseOpencodeLine(obj);
      let error: GroveErrorChunk | undefined;
      const filtered: PlanChunk[] = [];
      for (const c of result) {
        if ("message" in c) {
          error = c;
        } else {
          filtered.push(c);
        }
      }
      return { chunks: filtered, error };
    } else {
      return { chunks: (copilotParser ?? new CopilotLineParser()).parse(obj) };
    }
  } catch {
    const stripped = trimmed.replace(/\x1b\[[0-9;]*[mGKHF]/g, "");
    if (!stripped) return { chunks: [] };
    return { chunks: [{ type: "text", content: stripped }] };
  }
}

class SpawnAgentRunner implements IAgentRunner {
  private activeRuns = new Map<string, ActiveRun>();
  /** Tracks opencode.json files written by Grove so we can clean them up. */
  private wroteConfigFiles = new Map<string, string>(); // runKey -> filePath

  /** Overrides problematic 'ask' permissions in the build agent so headless runs never block. */
  private writeOpencodeConfig(runKey: string, cwd: string): void {
    writeOpencodeConfig(cwd, this.wroteConfigFiles, runKey);
  }

  private cleanupGroveConfig(runKey: string): void {
    cleanupGroveConfig(this.wroteConfigFiles, runKey);
  }

  start(opts: RunOpts): Promise<void> {
    const runKey = `${opts.mode}:${opts.taskId}`;
    this.cancel(runKey);

    console.log(
      `[SpawnAgentRunner][${runKey}] start() agent=${opts.agent} model=${opts.model ?? "default"} sessionId=${opts.sessionId ?? "null"}`,
    );

    // Write a project opencode.json to suppress ask-permission prompts that
    // would block headless runs. Skipped if the project already has one.
    if (opts.agent === "opencode") {
      this.writeOpencodeConfig(runKey, opts.cwd);
    }

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
      return Promise.resolve();
    }

    console.log(
      `[SpawnAgentRunner][${runKey}] spawned pid=${proc.pid ?? "?"} agent=${opts.agent}`,
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
    let stderrBuffer = "";
    let turnHadError = false;
    const copilotParser =
      opts.agent !== "opencode" ? new CopilotLineParser() : undefined;

    rl.on("line", (line) => {
      const { chunks, error } = parseLine(opts.agent, line, copilotParser);
      if (error) {
        turnHadError = true;
        opts.onChunk(opts.taskId, opts.mode, {
          type: "error",
          content: error.message,
        });
        return;
      }
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
      const rawExitCode = proc.exitCode ?? 0;
      // When opencode emits an error event then exits cleanly (code 0), treat
      // the effective exit code as 1 so the UI shows it as a failure.
      const exitCode = turnHadError && rawExitCode === 0 ? 1 : rawExitCode;
      console.log(
        `[SpawnAgentRunner][${runKey}] readline closed, exitCode=${exitCode} (raw=${rawExitCode})`,
      );
      this.activeRuns.delete(runKey);
      this.cleanupGroveConfig(runKey);

      // Surface stderr so the user sees the actual error in the exit warning
      // section rather than the generic "exited without output" message.
      if (exitCode !== 0 && stderrBuffer.trim()) {
        opts.onChunk(opts.taskId, opts.mode, {
          type: "stderr",
          content: stderrBuffer.trim(),
        });
      }

      opts.onChunk(opts.taskId, opts.mode, {
        type: "done",
        content: String(exitCode),
      });
      opts.onComplete?.();
    });

    proc.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      stderrBuffer += text;
      console.warn(`[SpawnAgentRunner][${runKey}] stderr:`, text);
    });

    proc.on("error", (err) => {
      console.error(`[SpawnAgentRunner][${runKey}] proc error:`, err.message);
      rl.close();
      this.activeRuns.delete(runKey);
      opts.onChunk(opts.taskId, opts.mode, {
        type: "error",
        content: err.message,
      });
    });

    return Promise.resolve();
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
      this.cleanupGroveConfig(runKey);
    }
  }

  cancelAll(): void {
    for (const [runKey] of this.activeRuns) {
      this.cancel(runKey);
    }
  }

  detach(): void {
    for (const [runKey, run] of this.activeRuns) {
      run.rl?.close();
      this.cleanupGroveConfig(runKey);
    }
    this.activeRuns.clear();
  }
}

class TmuxAgentRunner implements IAgentRunner {
  private tmux: TmuxSupervisor;
  private activeKeys = new Set<string>();
  /**
   * Callbacks captured per run so cancel() can emit a synthetic done chunk
   * without needing to route through AgentRunner.onChunkCb.
   */
  private runCallbacks = new Map<
    string,
    {
      taskId: string;
      mode: PlanMode;
      onChunk: ChunkCallback;
      workspacePath: string;
    }
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
      workspacePath: opts.workspacePath,
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

  cancelAll(): void {
    for (const [runKey, cb] of this.runCallbacks) {
      cb.onChunk(cb.taskId, cb.mode, { type: "done", content: "1" });
      const [mode, taskId] = runKey.split(":");
      const tmuxSession = buildTmuxSessionName(
        cb.workspacePath,
        taskId,
        mode as PlanMode,
      );
      this.tmux.kill(tmuxSession);
    }
    this.activeKeys.clear();
    this.runCallbacks.clear();
  }

  detach(): void {
    this.tmux.detachAll();
    this.activeKeys.clear();
    this.runCallbacks.clear();
  }
}

export class AgentRunner {
  private spawnRunner: SpawnAgentRunner;
  private tmuxRunner: TmuxAgentRunner | null = null;
  private onChunkCb: ChunkCallback | null = null;
  private tmuxAvailable: boolean | null = null;
  private tmuxSupervisor: TmuxSupervisor;

  constructor() {
    this.spawnRunner = new SpawnAgentRunner();
    this.tmuxSupervisor = new TmuxSupervisor({
      updateTask: tasks.updateTask,
    });
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
      this.tmuxRunner = new TmuxAgentRunner(this.tmuxSupervisor);
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

        await tmuxRunner.start({
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
        });
      } else {
        await this.spawnRunner.start({
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
        });
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
    this.tmuxRunner?.cancelAll();
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

  async captureTmuxPane(session: string): Promise<string> {
    return this.tmuxSupervisor.capturePane(session);
  }

  async reconnectTmuxSession(
    tmuxSession: string,
    taskId: string,
    mode: PlanMode,
    agent: PlanAgent,
    onComplete?: () => void,
  ): Promise<{ reconnected: boolean; sessionAlive: boolean }> {
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
    return { reconnected: result.alive, sessionAlive: result.sessionAlive };
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
        console.warn("[AgentRunner] listModels spawn error:", err.message);
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
