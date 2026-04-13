import { ipcMain, BrowserWindow } from "electron";
import type { PtyManager } from "../pty";
import type { IpcResult } from "@shared/types";

export function registerPtyHandlers(
  ptyManager: PtyManager,
  mainWindow: BrowserWindow,
): void {
  // Wire up data forwarding from PTY → renderer
  ptyManager.setOnData((id: string, data: string) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send("pty:data", id, data);
    }
  });

  // Wire up exit forwarding from PTY → renderer
  ptyManager.setOnExit((id: string, exitCode: number, signal?: number) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send("pty:exit", id, { exitCode, signal });
    }
  });

  // pty:create — request/response (ipcMain.handle)
  ipcMain.handle(
    "pty:create",
    async (_event, id: string, cwd: string): Promise<IpcResult<void>> => {
      try {
        ptyManager.create(id, cwd);
        return { ok: true, data: undefined };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // pty:write — fire-and-forget (ipcMain.on)
  ipcMain.on("pty:write", (_event, id: string, data: string) => {
    ptyManager.write(id, data);
  });

  // pty:resize — fire-and-forget (ipcMain.on)
  ipcMain.on("pty:resize", (_event, id: string, cols: number, rows: number) => {
    ptyManager.resize(id, cols, rows);
  });

  // pty:kill — request/response (ipcMain.handle)
  ipcMain.handle(
    "pty:kill",
    async (_event, id: string): Promise<IpcResult<void>> => {
      try {
        ptyManager.kill(id);
        return { ok: true, data: undefined };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // pty:isIdle — request/response (ipcMain.handle)
  ipcMain.handle(
    "pty:isIdle",
    async (_event, id: string): Promise<IpcResult<boolean>> => {
      try {
        const idle = ptyManager.isIdle(id);
        return { ok: true, data: idle };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // pty:getOutput — get accumulated output
  ipcMain.handle(
    "pty:getOutput",
    async (_event, id: string): Promise<IpcResult<string>> => {
      try {
        const output = ptyManager.getOutput(id);
        return { ok: true, data: output };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // pty:clearOutput — clear accumulated output
  ipcMain.handle(
    "pty:clearOutput",
    async (_event, id: string): Promise<IpcResult<void>> => {
      try {
        ptyManager.clearOutput(id);
        return { ok: true, data: undefined };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );
}
