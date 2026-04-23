---
id: T-013
title: themes
status: done
created: "2026-04-04"
planSessionId: ses_2a77ecc1bffeAPdAq6iY9oGKvl
planSessionAgent: opencode
planModel: opencode/big-pickle
---

## Description

Add theme support to Grove, allowing users to choose from pre-built themes like Catppuccin Mocha and Catppuccin Latte. Theme applies app-wide (same for all workspaces).

### Architecture

- **Theme storage**: localStorage (`grove:theme`) since it's app-wide
- **Theme files**: CSS files in `src/renderer/src/styles/themes/` that redefine `:root` CSS variables
- **Themes included**:
  - `default.css` — current dark theme (bg: `#0b0b0d`, accent: `#7b68ee`)
  - `catppuccin-mocha.css` — Catppuccin Mocha dark variant
  - `catppuccin-latte.css` — Catppuccin Latte light variant

### Implementation Phases

1. **CSS Theme System**: Create theme CSS files and a theme loader module
2. **Settings UI**: Create Settings view with theme selector, accessible via `⌘,` / `Ctrl+,`
3. **Theme Syncing**: Update shiki code highlighting and xterm.js terminal colors per theme
4. **Persistence**: Load theme on app start, prevent flash with blocking script

### Files to Modify

| File                                                       | Change                      |
| ---------------------------------------------------------- | --------------------------- |
| `src/renderer/src/styles/themes/default.css`               | Create (current theme)      |
| `src/renderer/src/styles/themes/catppuccin-mocha.css`      | Create                      |
| `src/renderer/src/styles/themes/catppuccin-latte.css`      | Create                      |
| `src/renderer/src/styles/variables.css`                    | Refactor to base only       |
| `src/renderer/src/styles/loadTheme.ts`                     | Create                      |
| `src/renderer/src/main.tsx`                                | Add theme loading           |
| `src/renderer/src/stores/useNavStore.ts`                   | Add 'settings' view         |
| `src/renderer/src/components/MainArea/MainArea.tsx`        | Render Settings view        |
| `src/renderer/src/components/Sidebar/BottomNav.tsx`        | Add settings nav item       |
| `src/renderer/src/components/Settings/Settings.tsx`        | Create                      |
| `src/renderer/src/components/Settings/Settings.module.css` | Create                      |
| `src/renderer/src/hooks/useKeyboardShortcuts.ts`           | Add ⌘, shortcut             |
| `src/renderer/src/components/Files/shikiTheme.ts`          | Support theme switching     |
| `src/renderer/src/components/Terminal/TerminalTab.tsx`     | Support theme switching     |
| `src/main/index.ts`                                        | Sync window frame color     |
| `index.html`                                               | Add flash prevention script |

### Edge Cases

- Terminal sessions: update `terminal.options.theme` dynamically
- Open file tabs: re-render to apply new syntax highlighting
- Corrupted localStorage: validate against valid themes, fall back to 'default'
- Initial load flash: use blocking script to apply theme before React renders

## Definition of Done

- [x] User can open Settings via ⌘, / Ctrl+,
- [x] User can select from 3 themes: Default (dark), Catppuccin Mocha, Catppuccin Latte
- [x] Theme selection persists across app restarts (localStorage)
- [x] All UI components render correctly in all themes (board, sidebar, terminal, file viewer)
- [x] Code syntax highlighting adapts to selected theme
- [x] Terminal colors adapt to selected theme
- [x] Window frame color syncs with theme accent where supported
- [x] No flash of wrong theme on app startup (blocking script verified)
- [x] No hardcoded hex colors remain in components (grep verification)
