import { ipcMain } from "electron";
import { spawn } from "child_process";
import type { IpcResult, PlanAgent } from "@shared/types";
import { buildEnvPath } from "../env";

const COPILOT_MODELS = [
  "claude-sonnet-4.6",
  "claude-sonnet-4.5",
  "claude-opus-4.6",
  "claude-opus-4.6-fast",
  "claude-haiku-4.5",
  "gpt-4o",
  "gpt-4o-mini",
  "o1",
  "o1-mini",
  "o3-mini",
  "gemini-2.0-flash",
];

const CLAUDE_MODELS = [
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-haiku-4-5",
];

/**
 * Spawn `opencode models` and parse the output.
 *
 * Expected output format (one model ID per line, or space-separated):
 *   anthropic/claude-3-5-sonnet-latest
 *   openai/gpt-4o
 *   google/gemini-2.0-flash
 *
 * The regex extracts `provider/model` tokens — any `word/word` pattern where
 * word characters include letters, digits, underscores, hyphens, and dots
 * (for version numbers like `claude-3-5-sonnet-20241022`).
 *
 * Resolves with `[]` after `OPENCODE_MODELS_TIMEOUT_MS` if the subprocess has
 * not closed, and kills it to prevent zombie processes.
 */
const OPENCODE_MODELS_TIMEOUT_MS = 15_000;

function spawnOpencodeModels(workspacePath: string): Promise<string[]> {
  return new Promise((resolve) => {
    let settled = false;

    const proc = spawn("opencode", ["models"], {
      cwd: workspacePath,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: buildEnvPath() },
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        proc.kill();
      } catch {
        // ignore kill errors
      }
      resolve([]);
    }, OPENCODE_MODELS_TIMEOUT_MS);

    let stdout = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve([]);
    });

    proc.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const modelRe = /\b([a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+)\b/g;
      const seen = new Set<string>();
      const models: string[] = [];
      let match;
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

export function registerPlanHandlers(): void {
  ipcMain.handle(
    "plan:listModels",
    async (
      _event,
      input: { agent: PlanAgent; workspacePath: string },
    ): Promise<IpcResult<string[]>> => {
      try {
        if (input.agent === "copilot") {
          return { ok: true, data: COPILOT_MODELS };
        }
        if (input.agent === "claude") {
          return { ok: true, data: CLAUDE_MODELS };
        }
        const models = await spawnOpencodeModels(input.workspacePath);
        return { ok: true, data: models };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    "plan:saveSession",
    async (
      _event,
      input: {
        workspacePath: string;
        filePath: string;
        sessionId: string;
        agent: PlanAgent;
        model: string | null;
        mode: string;
      },
    ): Promise<IpcResult<void>> => {
      try {
        const changes =
          input.mode === "execute"
            ? {
                execSessionId: input.sessionId,
                execSessionAgent: input.agent,
                execModel: input.model ?? null,
              }
            : {
                planSessionId: input.sessionId,
                planSessionAgent: input.agent,
                planModel: input.model ?? null,
              };
        const { updateTask } = await import("../tasks");
        await updateTask(input.workspacePath, input.filePath, changes);
        return { ok: true, data: undefined };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    "plan:tmux-capture-pane",
    async (
      _event,
      input: { session: string },
    ): Promise<IpcResult<{ content: string }>> => {
      try {
        if (!input.session) {
          return { ok: false, error: "No session name provided" };
        }
        return new Promise((resolve) => {
          const proc = spawn("tmux", [
            "capture-pane",
            "-pt",
            input.session,
            "-S",
            "-",
            "-e",
          ]);
          let stdout = "";
          proc.stdout?.on("data", (data: Buffer) => {
            stdout += data.toString("utf-8");
          });
          proc.on("close", () => {
            resolve({ ok: true, data: { content: stdout } });
          });
          proc.on("error", () => {
            resolve({ ok: false, error: "Failed to capture pane" });
          });
        });
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );
}
