---
id: T-001
title: Keyboard shortcuts — Cmd+N (new workspace) and Cmd+1/2/3 (switch workspace)
status: done
priority: high
created: 2026-04-03T00:00:00.000Z
tags:
  - workspace
agent: opencode
---

## Description

Add renderer-side keyboard shortcuts so users can manage workspaces without touching the mouse.

**Note:** Workspace deletion is already implemented — right-click any workspace in the sidebar to get the context menu → "Remove workspace" → `window.confirm()` confirmation. No work needed there.

## Definition of Done

- [x] `Cmd+N` (Mac) / `Ctrl+N` (Win/Linux) opens the native folder-picker dialog
- [x] `Cmd+1`–`Cmd+9` activates the corresponding workspace by sidebar position
- [x] Pressing `Cmd+3` with only 2 workspaces is a silent no-op
- [x] Shortcut does not fire when cursor is inside a text input
- [x] `npm run typecheck && npm run build` passes

## Shortcuts to implement

| Shortcut | Action |
|---|---|
| `Cmd+N` (Mac) / `Ctrl+N` (Win/Linux) | Opens native folder picker to add a new workspace (same as clicking "Add workspace") |
| `Cmd+1`–`Cmd+9` / `Ctrl+1`–`Ctrl+9` | Activates the Nth workspace by its position in the sidebar |

## Implementation

### New file: `src/renderer/src/hooks/useKeyboardShortcuts.ts`

A custom React hook that registers a `document` `keydown` listener via `useEffect`.

```ts
import { useEffect } from 'react'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'

export function useKeyboardShortcuts(): void {
  const addWorkspace = useWorkspaceStore((s) => s.addWorkspace)
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      const mod = e.metaKey || e.ctrlKey

      // Skip when focus is inside an input, textarea, select, or contenteditable
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return
      }

      if (!mod) return

      // Cmd+N — add workspace
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        addWorkspace()
        return
      }

      // Cmd+1–9 — switch to Nth workspace
      const digit = parseInt(e.key, 10)
      if (digit >= 1 && digit <= 9) {
        e.preventDefault()
        const workspaces = useWorkspaceStore.getState().workspaces
        const ws = workspaces[digit - 1]
        if (ws) {
          setActiveWorkspace(ws.path)
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [addWorkspace, setActiveWorkspace])
}
```

**Why read `workspaces` from `getState()` inside the handler?**
Using `useWorkspaceStore.getState()` in the keydown callback always gets the current snapshot without stale closure issues, and avoids re-registering the listener every time the workspace list changes.

### Edit: `src/renderer/src/App.tsx`

Call the hook inside `AppContent`:

```tsx
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'

function AppContent(): React.JSX.Element {
  useKeyboardShortcuts()
  // ... rest unchanged
}
```

## Edge cases

- `Cmd+1` when workspace is already active: `setActiveWorkspace` is a no-op in the store (sets the same path again — harmless)
- `Cmd+5` with fewer than 5 workspaces: `workspaces[4]` is `undefined`, guarded by `if (ws)` check
- Input focus guard: prevents `Cmd+N` from firing when typing in a rename input (future) or any other field
- `Cmd+N` while dialog already open: the store's `addWorkspace` call is safe to call twice — Electron's dialog system handles this

## Context for agent

