---
id: T-033
title: theme not persisted across restart
status: done
created: "2026-04-05"
useWorktree: false
planSessionId: ses_2a350ec53ffeojQ1rEnjh8RF0x
planSessionAgent: opencode
planTmuxSession: grove-plan-c0e897-T-033
planModel: opencode/big-pickle
execSessionId: ses_2a33698d3ffeEHNt63306dhvqB
execSessionAgent: opencode
execModel: opencode/big-pickle
execTmuxSession: grove-exec-c0e897-T-033
---

## Description

The theme preference is currently stored in renderer `localStorage`, but appears to not persist across restarts (likely due to how Electron dev mode handles renderer state). This task moves theme persistence to the main-process `config.json` file, which is the authoritative store for user preferences.

**Root cause:** Renderer `localStorage` is not reliable across app restarts in Electron dev mode.

**Solution:** Move theme to `config.json` (main process), keep `localStorage` as a read-only flash-prevention cache. Default theme changes from "default" (dark) to "catppuccin-mocha".

## Definition of Done

- [x] Add `theme: ThemeName` field to `AppConfig` in `src/shared/types.ts`
- [x] Add `theme: "catppuccin-mocha"` to `DEFAULT_CONFIG` in `src/main/config.ts`
- [x] Add schema validation for `theme` in `ConfigManager.loadFromDisk()` — validate theme is one of the valid ThemeName values, fallback to "catppuccin-mocha"
- [x] Add IPC handler `app:getTheme` in `src/main/ipc/index.ts` — returns theme from configManager, wrapped in `IpcResult<ThemeName>`
- [x] Add IPC handler `app:setTheme` in `src/main/ipc/index.ts` — accepts theme string, validates it, updates configManager, returns result wrapped in `IpcResult<ThemeName>`
- [x] Expose `app.getTheme()` and `app.setTheme(theme)` in `src/preload/index.ts`
- [x] Update `src/renderer/src/styles/loadTheme.ts`:
  - Keep `getStoredTheme()` reading from localStorage (as fallback for flash prevention)
  - Keep `applyTheme()` writing to localStorage (to maintain the flash-prevention cache)
  - Add `loadThemeFromConfig(): Promise<ThemeName>` — IPC call to get theme from config.json
- [x] Update `src/renderer/src/main.tsx` — make theme loading async, call IPC to get theme, then sync to localStorage cache
- [x] Update `src/renderer/src/stores/useThemeStore.ts` — `setTheme()` calls IPC to write to config.json AND writes to localStorage (dual-write to keep cache in sync)
- [ ] Verify theme persists after `Cmd+Q` quit + relaunch in dev mode
- [ ] Verify no flash-of-wrong-theme on app startup (localStorage cache still works)

## Context for agent

The existing IPC/config system works as follows:

- `ConfigManager` (src/main/config.ts) manages `config.json` in userData with debounced saves (300ms)
- IPC handlers are registered in `src/main/ipc/index.ts` and receive `configManager` instance
- Preload exposes `window.api` via contextBridge
- Use `IpcResult<T>` wrapper for consistent IPC response format
- Theme names are defined in `src/renderer/src/styles/loadTheme.ts` as `THEMES` tuple
