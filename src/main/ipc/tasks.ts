import { ipcMain } from "electron";
import type {
  IpcResult,
  WorkspaceData,
  TaskInfo,
  TaskStatus,
  TaskFrontmatter,
} from "@shared/types";
import {
  scanTasks,
  createTask,
  updateTask,
  moveTask,
  archiveTask,
  readTaskBody,
  readTaskRaw,
  writeTaskRaw,
} from "../tasks";

export function registerTaskHandlers(): void {
  // Atomic data fetch — returns tasks in one response
  ipcMain.handle(
    "workspace:data",
    async (
      _event,
      workspacePath: string,
    ): Promise<IpcResult<WorkspaceData>> => {
      try {
        const tasks = await scanTasks(workspacePath);
        return { ok: true, data: { tasks } };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // ── Task CRUD ──────────────────────────────────────────────────

  ipcMain.handle(
    "task:create",
    async (
      _event,
      workspacePath: string,
      title: string,
    ): Promise<IpcResult<TaskInfo>> => {
      try {
        if (!title || !title.trim()) {
          return { ok: false, error: "Title is required" };
        }
        const task = await createTask(workspacePath, title.trim());
        return { ok: true, data: task };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    "task:update",
    async (
      _event,
      workspacePath: string,
      filePath: string,
      changes: Partial<TaskFrontmatter>,
      body?: string,
    ): Promise<IpcResult<TaskInfo>> => {
      console.log("[IPC task:update]", {
        workspacePath,
        filePath,
        changes,
        bodyLen: body?.length,
      });
      try {
        const task = await updateTask(workspacePath, filePath, changes, body);
        return { ok: true, data: task };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    "task:move",
    async (
      _event,
      workspacePath: string,
      filePath: string,
      toStatus: TaskStatus,
    ): Promise<IpcResult<TaskInfo>> => {
      try {
        const task = await moveTask(workspacePath, filePath, toStatus);
        return { ok: true, data: task };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    "task:archive",
    async (
      _event,
      workspacePath: string,
      filePath: string,
    ): Promise<IpcResult<void>> => {
      try {
        await archiveTask(workspacePath, filePath);
        return { ok: true, data: undefined };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    "task:readBody",
    async (
      _event,
      workspacePath: string,
      filePath: string,
    ): Promise<IpcResult<string>> => {
      try {
        const body = await readTaskBody(workspacePath, filePath);
        return { ok: true, data: body };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // ── Raw file read/write (for overlay editor) ──────────────────

  ipcMain.handle(
    "task:readRaw",
    async (
      _event,
      workspacePath: string,
      filePath: string,
    ): Promise<IpcResult<string>> => {
      try {
        const raw = await readTaskRaw(workspacePath, filePath);
        return { ok: true, data: raw };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    "task:writeRaw",
    async (
      _event,
      workspacePath: string,
      filePath: string,
      rawContent: string,
    ): Promise<IpcResult<TaskInfo>> => {
      try {
        const task = await writeTaskRaw(workspacePath, filePath, rawContent);
        return { ok: true, data: task };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );
}
