import { screen } from "electron";
import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import type { BrowserWindow } from "electron";
import type { WindowState } from "@shared/types";

const DEFAULT_STATE: WindowState = {
  x: 0,
  y: 0,
  width: 1200,
  height: 800,
  isMaximized: false,
};

interface WindowStateKeeper {
  state: WindowState;
  manage(window: BrowserWindow): void;
  unmanage(): void;
}

export function createWindowStateKeeper(): WindowStateKeeper {
  const stateFilePath = path.join(app.getPath("userData"), "window-state.json");

  function loadState(): WindowState {
    try {
      if (!fs.existsSync(stateFilePath)) {
        return getDefaultCentered();
      }
      const raw = fs.readFileSync(stateFilePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<WindowState>;

      const state: WindowState = {
        x: typeof parsed.x === "number" ? parsed.x : 0,
        y: typeof parsed.y === "number" ? parsed.y : 0,
        width:
          typeof parsed.width === "number" && parsed.width >= 900
            ? parsed.width
            : DEFAULT_STATE.width,
        height:
          typeof parsed.height === "number" && parsed.height >= 600
            ? parsed.height
            : DEFAULT_STATE.height,
        isMaximized: parsed.isMaximized === true,
      };

      // Validate the window is on a visible display
      const displays = screen.getAllDisplays();
      const isVisible = displays.some((display) => {
        const { x, y, width, height } = display.bounds;
        return (
          state.x >= x &&
          state.y >= y &&
          state.x + state.width <= x + width &&
          state.y + state.height <= y + height
        );
      });

      if (!isVisible) {
        return getDefaultCentered();
      }

      return state;
    } catch (err) {
      console.warn("[WindowState] Failed to load state, using defaults:", err);
      return getDefaultCentered();
    }
  }

  function getDefaultCentered(): WindowState {
    const primary = screen.getPrimaryDisplay();
    const { width: sw, height: sh } = primary.workAreaSize;
    const w = DEFAULT_STATE.width;
    const h = DEFAULT_STATE.height;
    return {
      x: Math.round((sw - w) / 2),
      y: Math.round((sh - h) / 2),
      width: w,
      height: h,
      isMaximized: false,
    };
  }

  function saveState(state: WindowState): void {
    try {
      const dir = path.dirname(stateFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2), "utf-8");
    } catch (err) {
      console.error("[WindowState] Failed to save state:", err);
    }
  }

  const state = loadState();
  let saveTimer: NodeJS.Timeout | null = null;
  let window: BrowserWindow | null = null;
  let isManaging = false;

  function scheduleSave(): void {
    if (!window || !isManaging) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!window || window.isDestroyed()) return;
      if (!window.isMinimized()) {
        const bounds = window.getBounds();
        state.x = bounds.x;
        state.y = bounds.y;
        state.width = bounds.width;
        state.height = bounds.height;
        state.isMaximized = window.isMaximized();
        saveState(state);
      }
    }, 500);
  }

  return {
    state,
    manage(win: BrowserWindow): void {
      window = win;
      isManaging = true;

      win.on("resize", scheduleSave);
      win.on("move", scheduleSave);
      win.on("maximize", () => {
        state.isMaximized = true;
        if (saveTimer) clearTimeout(saveTimer);
        saveState(state);
      });
      win.on("unmaximize", () => {
        state.isMaximized = false;
        if (saveTimer) clearTimeout(saveTimer);
        saveState(state);
      });
      win.on("close", () => {
        if (saveTimer) clearTimeout(saveTimer);
        if (!win.isMinimized()) {
          const bounds = win.getBounds();
          state.x = bounds.x;
          state.y = bounds.y;
          state.width = bounds.width;
          state.height = bounds.height;
          state.isMaximized = win.isMaximized();
        }
        saveState(state);
      });
    },
    unmanage(): void {
      isManaging = false;
      if (saveTimer) clearTimeout(saveTimer);
      window = null;
    },
  };
}
