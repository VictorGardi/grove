import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { AppConfig } from "@shared/types";

const DEFAULT_CONFIG: AppConfig = {
  workspaces: [],
  lastActiveWorkspace: null,
  theme: "catppuccin-mocha",
  windowOpacity: 1.0,
};

const VALID_THEMES = [
  "catppuccin-mocha",
  "catppuccin-latte",
  "tokyo-night",
  "evergreen",
] as const;

export type ValidTheme = (typeof VALID_THEMES)[number];

export function isValidTheme(theme: string): theme is ValidTheme {
  return (VALID_THEMES as readonly string[]).includes(theme);
}

export class ConfigManager {
  private config: AppConfig;
  private configPath: string;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.configPath = path.join(os.homedir(), ".grove", "config.json");
    console.log("[ConfigManager] Loading from:", this.configPath);
    this.config = this.loadFromDisk();
    console.log(
      "[ConfigManager] Loaded workspaces:",
      this.config.workspaces.length,
    );
  }

  get(): AppConfig {
    return this.config;
  }

  update(fn: (config: AppConfig) => void): void {
    fn(this.config);
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.writeToDisk(), 300);
  }

  flushSync(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.writeToDiskSync();
  }

  private loadFromDisk(): AppConfig {
    try {
      if (!fs.existsSync(this.configPath)) {
        return { ...DEFAULT_CONFIG, workspaces: [] };
      }
      const raw = fs.readFileSync(this.configPath, "utf-8");
      console.log("[ConfigManager] Raw config:", raw.substring(0, 500));
      const parsed = JSON.parse(raw) as Partial<AppConfig>;
      const theme =
        typeof parsed.theme === "string" && isValidTheme(parsed.theme)
          ? parsed.theme
          : "catppuccin-mocha";
      const windowOpacity =
        typeof parsed.windowOpacity === "number" &&
        parsed.windowOpacity >= 0.1 &&
        parsed.windowOpacity <= 1.0
          ? parsed.windowOpacity
          : 1.0;
      return {
        workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces : [],
        lastActiveWorkspace:
          typeof parsed.lastActiveWorkspace === "string" ||
          parsed.lastActiveWorkspace === null
            ? (parsed.lastActiveWorkspace ?? null)
            : null,
        theme,
        windowOpacity,
      };
    } catch (err) {
      console.warn(
        "[ConfigManager] Failed to load config, using defaults:",
        err,
      );
      return { ...DEFAULT_CONFIG, workspaces: [], theme: "catppuccin-mocha" };
    }
  }

  private writeToDisk(): void {
    const tmpPath = this.configPath + ".tmp";
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      console.log(
        "[ConfigManager] Writing config, workspaces:",
        this.config.workspaces.length,
      );
      console.log(
        "[ConfigManager] First workspace:",
        JSON.stringify(this.config.workspaces[0], null, 2),
      );
      fs.writeFileSync(tmpPath, JSON.stringify(this.config, null, 2), "utf-8");
      fs.renameSync(tmpPath, this.configPath);
    } catch (err) {
      console.error("[ConfigManager] Failed to write config:", err);
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // ignore cleanup error
      }
    }
  }

  private writeToDiskSync(): void {
    this.writeToDisk();
  }
}
