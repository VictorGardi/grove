---
id: T-026
title: keyboard bindings
status: done
created: "2026-04-05"
useWorktree: false
planSessionId: ses_2a3ecf8e8ffez5SlSciCM0pbxX
planSessionAgent: opencode
planModel: opencode/big-pickle
execSessionId: ses_2a3deca94ffeySfvPZj1dGphzi
execSessionAgent: opencode
---

## Description

Add keyboard navigation, fuzzy search, and new task creation to the Kanban board:

1. **Cmd+K to navigate to Board** — From any view, pressing Cmd+K navigates to the Kanban board and focuses the search input. If already on board, refocuses search.

2. **? to activate search** — Pressing `?` on the board view activates search mode and focuses the search input. This works regardless of keyboard layout (handles Swedish keyboard where ? requires Shift).

3. **Fuzzy search on board** — A search input appears in the board toolbar when activated. Typing characters filters tasks using fuzzy matching (Fuse.js). Shows match count (e.g., "3 matches").

4. **Visual highlighting** — Matching tasks are highlighted with a distinct style (e.g., yellow/amber background). Existing selected task (blue border) remains visible separately.

5. **Enter to open task** — When exactly 1 task matches, pressing Enter opens that task. When 2+ match, Enter opens the top-ranked match. When 0 match, Enter does nothing.

6. **Escape** — Clears search query, blurs the search input, and exits search mode.

7. **Cmd+T to create new task** — Replaces the existing `N` shortcut. Creates a new task with default title "New task".

8. **Search state management** — Search query clears when:
   - User presses Escape
   - User leaves the board view
   - User opens a task with Enter

9. **Fix B/D/R/F shortcuts** — Modify the existing shortcuts to NOT fire when the search input is focused (to avoid conflicts with typing letters).

---

## Definition of Done

- [x] Pressing Cmd+K from any view navigates to the Kanban board and focuses search input
- [x] Pressing Cmd+K while on board refocuses the search input
- [x] Pressing ? (question mark) on board activates search mode and focuses search input
- [x] Search input displays in board toolbar with placeholder text
- [x] Typing characters on board filters tasks using fuzzy matching (Fuse.js)
- [x] Match count is displayed (e.g., "3 matches")
- [x] Matching tasks are visually highlighted (distinct from selected task)
- [x] When exactly 1 task matches, pressing Enter opens that task
- [x] When 2+ tasks match, pressing Enter opens the top-ranked match
- [x] When 0 tasks match, pressing Enter does nothing
- [x] Pressing Escape clears search query, blurs input, and exits search mode
- [x] Search query clears when leaving board view
- [x] Pressing Cmd+T creates a new task with default title
- [x] B/D/R/F shortcuts do NOT fire when search input is focused
- [x] Search works only when no input/textarea is focused (except the board search input)
- [x] Search does not interfere with existing keyboard shortcuts

## Context for agent

Key files to modify:

- `src/renderer/src/hooks/useKeyboardShortcuts.ts` — Add Cmd+K, ? shortcuts; update Cmd+T; fix B/D/R/F
- `src/renderer/src/stores/useDataStore.ts` or create new store — Add board search state
- `src/renderer/src/components/Board/BoardToolbar.tsx` — Add search input overlay
- `src/renderer/src/components/Board/Board.tsx` — Integrate Fuse.js, compute results
- `src/renderer/src/components/Board/TaskCard.tsx` — Add search match highlighting
