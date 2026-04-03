import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import type { AppConfig } from '@shared/types'

const DEFAULT_CONFIG: AppConfig = {
  workspaces: [],
  lastActiveWorkspace: null
}

export class ConfigManager {
  private config: AppConfig
  private configPath: string
  private saveTimer: NodeJS.Timeout | null = null

  constructor() {
    this.configPath = path.join(app.getPath('userData'), 'config.json')
    this.config = this.loadFromDisk()
  }

  get(): AppConfig {
    return this.config
  }

  update(fn: (config: AppConfig) => void): void {
    fn(this.config)
    this.scheduleSave()
  }

  /** Debounced save — coalesces rapid updates */
  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.writeToDisk(), 300)
  }

  /** Synchronous flush — called on app quit */
  flushSync(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    this.writeToDiskSync()
  }

  private loadFromDisk(): AppConfig {
    try {
      if (!fs.existsSync(this.configPath)) {
        return { ...DEFAULT_CONFIG, workspaces: [] }
      }
      const raw = fs.readFileSync(this.configPath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<AppConfig>
      return {
        workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces : [],
        lastActiveWorkspace:
          typeof parsed.lastActiveWorkspace === 'string' ||
          parsed.lastActiveWorkspace === null
            ? parsed.lastActiveWorkspace ?? null
            : null
      }
    } catch (err) {
      console.warn('[ConfigManager] Failed to load config, using defaults:', err)
      return { ...DEFAULT_CONFIG, workspaces: [] }
    }
  }

  private writeToDisk(): void {
    const tmpPath = this.configPath + '.tmp'
    try {
      const dir = path.dirname(this.configPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(tmpPath, JSON.stringify(this.config, null, 2), 'utf-8')
      fs.renameSync(tmpPath, this.configPath)
    } catch (err) {
      console.error('[ConfigManager] Failed to write config:', err)
      try {
        fs.unlinkSync(tmpPath)
      } catch {
        // ignore cleanup error
      }
    }
  }

  private writeToDiskSync(): void {
    this.writeToDisk()
  }
}
