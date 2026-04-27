import { ipcMain } from "electron";
import {
  ensureServer,
  killServer,
  getServerStatus,
} from "../opencodeServerManager";

export function registerOpencodeServerHandlers(): void {
  ipcMain.handle("opencodeServer:ensure", async () => {
    const result = await ensureServer();
    if ("url" in result) {
      return { url: result.url };
    }
    return { error: result.error };
  });

  ipcMain.handle("opencodeServer:kill", () => {
    killServer();
  });

  ipcMain.handle("opencodeServer:status", () => {
    return getServerStatus();
  });
}
