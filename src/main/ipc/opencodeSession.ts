import { ipcMain } from "electron";
import type { Message, Part, TextPartInput } from "@opencode-ai/sdk/v2";
import { getClient } from "../opencode/client";
import { ensureServer } from "../opencodeServerManager";
import { resolveTaskPath, updateTask } from "../../runtime/taskService";

interface SessionEntry {
  sessionId: string;
  worktreePath: string;
  serverUrl: string;
}

const sessions = new Map<string, SessionEntry>();

export function getSessionEntry(taskId: string): SessionEntry | undefined {
  return sessions.get(taskId);
}

export function registerOpencodeSessionHandlers(): void {
  ipcMain.handle(
    "opencodeSession:create",
    async (
      _event,
      params: { taskId: string; workspacePath: string; worktreePath: string },
    ): Promise<{ sessionId: string } | { error: string }> => {
      try {
        const serverResult = await ensureServer();
        if ("error" in serverResult) {
          return { error: serverResult.error };
        }
        const serverUrl = serverResult.url;

        const client = getClient(serverUrl);
        const result = await client.session.create({
          directory: params.worktreePath,
        });

        if (result.error) {
          return {
            error: String(result.error.data ?? "Session creation failed"),
          };
        }

        const session = result.data;
        sessions.set(params.taskId, {
          sessionId: session.id,
          worktreePath: params.worktreePath,
          serverUrl,
        });

        const taskFilePath = await resolveTaskPath(
          params.workspacePath,
          params.taskId,
        );
        if (taskFilePath) {
          await updateTask(params.workspacePath, taskFilePath, {
            execSessionId: session.id,
          });
        }

        return { sessionId: session.id };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    "opencodeSession:prompt",
    async (
      _event,
      params: { taskId: string; promptText: string },
    ): Promise<{ ok: boolean } | { error: string }> => {
      try {
        const entry = sessions.get(params.taskId);
        if (!entry) {
          return { error: `No session found for task ${params.taskId}` };
        }

        const client = getClient(entry.serverUrl);
        const result = await client.session.prompt({
          sessionID: entry.sessionId,
          parts: [{ type: "text", text: params.promptText } as TextPartInput],
        });

        if (result.error) {
          return { error: String(result.error.data ?? "Prompt failed") };
        }

        return { ok: true };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    "opencodeSession:stop",
    async (
      _event,
      params: { taskId: string },
    ): Promise<{ ok: boolean } | { error: string }> => {
      try {
        const entry = sessions.get(params.taskId);
        if (!entry) {
          return { error: `No session found for task ${params.taskId}` };
        }

        const client = getClient(entry.serverUrl);
        const result = await client.session.abort({
          sessionID: entry.sessionId,
        });

        if (result.error) {
          return { error: String(result.error.data ?? "Stop failed") };
        }

        return { ok: true };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    "opencodeSession:get",
    async (
      _event,
      params: { taskId: string },
    ): Promise<{ sessionId: string; status: string } | null> => {
      const entry = sessions.get(params.taskId);
      if (!entry) {
        return null;
      }

      try {
        const client = getClient(entry.serverUrl);
        const result = await client.session.get({
          sessionID: entry.sessionId,
        });

        if (result.error) {
          return null;
        }

        return {
          sessionId: entry.sessionId,
          status: result.data.time?.archived ? "completed" : "active",
        };
      } catch {
        return null;
      }
    },
  );

  ipcMain.handle(
    "opencodeSession:messages",
    async (
      _event,
      params: { taskId: string },
    ): Promise<Array<{ info: Message; parts: Part[] }> | { error: string }> => {
      try {
        const entry = sessions.get(params.taskId);
        if (!entry) {
          return { error: `No session found for task ${params.taskId}` };
        }

        const client = getClient(entry.serverUrl);
        const result = await client.session.messages({
          sessionID: entry.sessionId,
        });

        if (result.error) {
          return {
            error: String(result.error.data ?? "Failed to get messages"),
          };
        }

        return result.data as Array<{ info: Message; parts: Part[] }>;
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );
}
