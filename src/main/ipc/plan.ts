import { ipcMain } from "electron";
import type { BrowserWindow } from "electron";
import * as path from "path";
import type { PlanManager } from "../planManager";
import type { IpcResult, PlanAgent } from "@shared/types";
import { updateTask } from "../tasks";

const VALID_AGENTS: PlanAgent[] = ["opencode", "copilot"];

export function registerPlanHandlers(
  planManager: PlanManager,
  mainWindow: BrowserWindow,
): void {
  // Wire chunk forwarding to renderer
  planManager.setOnChunk((taskId, chunk) => {
    console.log(
      `[PlanIPC] forwarding chunk type=${chunk.type} taskId=${taskId}`,
    );
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send("plan:chunk", taskId, chunk);
    }
  });

  // plan:send — first message (sessionId is null) or follow-up (sessionId set)
  ipcMain.handle(
    "plan:send",
    async (
      _event,
      input: {
        taskId: string;
        agent: PlanAgent;
        model: string | null;
        message: string;
        sessionId: string | null;
        workspacePath: string;
        taskFilePath: string;
      },
    ): Promise<IpcResult<void>> => {
      try {
        // Validate input types
        if (typeof input.taskId !== "string" || !input.taskId) {
          return { ok: false, error: "Invalid taskId" };
        }
        if (!VALID_AGENTS.includes(input.agent)) {
          return { ok: false, error: `Invalid agent: ${String(input.agent)}` };
        }
        if (typeof input.message !== "string" || !input.message) {
          return { ok: false, error: "Invalid message" };
        }
        if (input.sessionId !== null && typeof input.sessionId !== "string") {
          return { ok: false, error: "Invalid sessionId" };
        }
        if (typeof input.workspacePath !== "string" || !input.workspacePath) {
          return { ok: false, error: "Invalid workspacePath" };
        }
        if (typeof input.taskFilePath !== "string" || !input.taskFilePath) {
          return { ok: false, error: "Invalid taskFilePath" };
        }

        // Path traversal check: taskFilePath must be inside workspace .tasks/
        const resolvedTask = path.resolve(input.taskFilePath);
        const tasksDir = path.resolve(path.join(input.workspacePath, ".tasks"));
        if (!resolvedTask.startsWith(tasksDir + path.sep)) {
          return {
            ok: false,
            error: "taskFilePath must be inside workspace .tasks/ directory",
          };
        }

        planManager.run(
          input.taskId,
          input.agent,
          input.model ?? null,
          input.message,
          input.sessionId,
          input.workspacePath,
          input.taskFilePath,
        );
        return { ok: true, data: undefined };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  // plan:cancel — abort the current run for a task
  ipcMain.handle(
    "plan:cancel",
    async (_event, taskId: string): Promise<IpcResult<void>> => {
      planManager.cancel(taskId);
      return { ok: true, data: undefined };
    },
  );

  // plan:saveSession — called by renderer after receiving session_id chunk
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
      },
    ): Promise<IpcResult<void>> => {
      try {
        await updateTask(input.workspacePath, input.filePath, {
          planSessionId: input.sessionId,
          planSessionAgent: input.agent,
          planModel: input.model ?? null,
        });
        return { ok: true, data: undefined };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  // plan:listModels — return available models for the given agent
  // For opencode: runs `opencode models` and parses the output.
  // For copilot: returns a curated static list (no CLI enumeration available).
  const COPILOT_MODELS = [
    "gpt-4o",
    "gpt-4o-mini",
    "o1",
    "o1-mini",
    "o3-mini",
    "claude-3.5-sonnet",
    "claude-3.7-sonnet",
    "gemini-2.0-flash",
    "gemini-1.5-pro",
  ];

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
        const models = await planManager.listModels(input.workspacePath);
        return { ok: true, data: models };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );
}
