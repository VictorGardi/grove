---
phase: structure
status: draft
version: 1
created: 2026-10-08
updated: 2026-10-08
based_on:
  - 01-questions.md@1
feature: 2026-10-08-global-notes-scratchpad
---

# Global notes scratchpad — structure

## Slices

### Slice 1 — Core IPC & file I/O (tracer bullet)
**Outcome:** Core exposes `notes:read` and `notes:write` IPC handlers that read/write `~/Library/Application Support/grove/notes.md` atomically. Renderer can invoke them and see round-trip data.

**Files to add/change:**
- `src/main/ipc.ts` — add `notes:read` and `notes:write` to `InvokeMap`, register handlers
- `src/shared/ipc.ts` — extend `InvokeMap` with the two channels
- `src/core/store/jsonFile.ts` — reuse `atomicWrite` for the notes file (already supports plain text)

**Key signatures:**
```ts
// shared/ipc.ts
'notes:read': [void, string]
'notes:write': [{ content: string }, { ok: true } | { ok: false; error: string }]
```

**Verification:** `npm run dev` → open DevTools console → `await window.api.invoke('notes:read')` returns empty string (file missing) → `await window.api.invoke('notes:write', { content: '# test' })` returns `{ ok: true }` → second read returns `'# test'` → file exists at `~/Library/Application Support/grove/notes.md` with that content.

**Dependencies:** none

---

### Slice 2 — CodeMirror 6 editor component
**Outcome:** A reusable `ScratchpadEditor` React component using CodeMirror 6 in source mode with live styling (headings, bold, checkboxes) and clickable `- [ ]` / `- [x]` checkboxes.

**Files to add/change:**
- `package.json` — add `@codemirror/view`, `@codemirror/state`, `@codemirror/lang-markdown`, `@lezer/highlight`, `style-mod` (or similar minimal deps)
- `src/renderer/src/components/ScratchpadEditor.tsx` — new component
- `src/renderer/src/components/ScratchpadEditor.module.css` — minimal styles

**Key signatures:**
```tsx
interface ScratchpadEditorProps {
  value: string
  onChange: (v: string) => void
  onSave: () => void // called on Cmd+S, blur, or explicit flush
}
```

**Verification:** `npm run dev` → render `<ScratchpadEditor value="# hi" onChange={console.log} onSave={console.log} />` in a test route or Storybook → typing updates `onChange` → headings bold, checkboxes clickable toggle `[ ]` ↔ `[x]`.

**Dependencies:** Slice 1 (for integration testing, but component can be built in isolation)

---

### Slice 3 — Scratchpad overlay & toggle
**Outcome:** A `ScratchpadOverlay` component that wraps the editor in a modal, toggled by `ui:set { scratchpadOpen: true }`. Pressing Escape closes it and returns focus to previous element. Cmd+N (global) and a Command Palette entry open it.

**Files to add/change:**
- `src/shared/ipc.ts` — add `scratchpadOpen` to `UiState`
- `src/main/menu.ts` — add Cmd+N menu item (check no clash) sending `menu:action { type: 'scratchpad' }`
- `src/shared/ipc.ts` — add `scratchpad` to `MenuAction`
- `src/renderer/src/stores/slices.ts` — add `toggleScratchpad()` action
- `src/renderer/src/App.tsx` — render `<ScratchpadOverlay />` when `ui.scratchpadOpen`
- `src/renderer/src/components/ScratchpadOverlay.tsx` — new component wrapping `ScratchpadEditor`
- `src/renderer/src/paletteItems.ts` — add `scratchpad` command to `PALETTE_COMMANDS`

**Key signatures:**
```ts
// UiState addition
scratchpadOpen: boolean

// MenuAction addition
{ type: 'scratchpad' }
```

**Verification:** `npm run dev` → press Cmd+N → overlay opens with editor → type text → press Escape → overlay closes, focus returns → Cmd+N reopens with same text → Command Palette → "Scratchpad" entry works.

**Dependencies:** Slice 1, Slice 2

---

### Slice 4 — Debounced save & lifecycle flush
**Outcome:** Editor content is saved to disk via IPC: debounced ~500ms after last keystroke, plus flush on overlay close and on app quit (main process `before-quit`).

**Files to add/change:**
- `src/renderer/src/components/ScratchpadOverlay.tsx` — add debounced save logic, call `notes:write` on change/close
- `src/main/index.ts` — on `before-quit`, flush any pending write (or rely on renderer flush-on-close; ensure main doesn't quit before renderer saves)
- `src/renderer/src/App.tsx` — ensure `closeViewer` equivalent for scratchpad calls flush

**Verification:** `npm run dev` → open scratchpad → type "hello" → wait 600ms → read file at `~/Library/Application Support/grove/notes.md` contains "hello" → close overlay → reopen → content persists → quit app → reopen app → content persists.

**Dependencies:** Slice 1, Slice 3

---

### Slice 5 — Error handling & missing file
**Outcome:** Missing `notes.md` opens as empty (no error). Failed write shows a visible, dismissible error banner in the overlay (not a toast — must be seen before next open).

**Files to add/change:**
- `src/main/ipc.ts` — `notes:write` returns `{ ok: false, error: string }` on failure (already shaped by `handle` wrapper)
- `src/renderer/src/components/ScratchpadOverlay.tsx` — catch write errors, show inline banner with "Retry" button
- `src/renderer/src/components/ui/Banner.tsx` — reuse existing banner component

**Verification:** `npm run dev` → make `notes.md` unwritable (chmod 000) → open scratchpad → type → save fails → banner appears with error → fix permissions → click Retry → save succeeds → banner disappears.

**Dependencies:** Slice 4

---

## Deferred

- Search/filter within the scratchpad (v1: just the editor, Cmd+F works)
- Rich text preview pane (v1: source mode with live styling only)
- Multiple scratchpads / per-project notes
- Version history / undo beyond session
- CLI access to the scratchpad

## Rollout / migration

None. New file at `~/Library/Application Support/grove/notes.md` created on first write.

## Open questions

(none — all decisions made in grill session + follow-up)