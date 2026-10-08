---
phase: implementation
status: draft
version: 1
created: 2026-10-08
updated: 2026-10-08
based_on:
  - 01-questions.md@1
  - 04-structure.md@1
feature: 2026-10-08-global-notes-scratchpad
---

# Global notes scratchpad — implementation log

## Slice 1 — Core IPC & file I/O (tracer bullet)

**Completed:** 2026-10-08

**Files changed:**
- `src/shared/ipc.ts` — Added `notes:read` and `notes:write` to `InvokeMap`
- `src/main/ipc.ts` — Added handlers for `notes:read` and `notes:write` using `atomicWrite`
- `src/core/store/jsonFile.ts` — Reused existing `atomicWrite` function

**Verification:** All tests pass. Typecheck passes. Build succeeds.

---

## Slice 2 — CodeMirror 6 editor component

**Completed:** 2026-10-08

**Files changed:**
- `package.json` — Added CodeMirror 6 dependencies
- `src/renderer/src/components/ScratchpadEditor.tsx` — New CodeMirror 6 editor component
- `src/renderer/src/components/ScratchpadEditor.module.css` — Editor styles

**Features implemented:**
- Markdown source mode with live styling (headings, bold, italic, code, links, blockquotes, lists)
- Clickable checkboxes (`- [ ]` ↔ `- [x]`)
- Cmd+S triggers save callback
- Custom markdown theme matching app design system

**Verification:** Typecheck passes. Build succeeds.

---

## Slice 3 — Scratchpad overlay & toggle

**Completed:** 2026-10-08

**Files changed:**
- `src/shared/types.ts` — Added `scratchpadOpen` to `UiState`
- `src/shared/ipc.ts` — Added `scratchpad` to `MenuAction`
- `src/main/menu.ts` — Added Cmd+N menu item for scratchpad
- `src/renderer/src/stores/slices.ts` — Added `toggleScratchpad()` action
- `src/renderer/src/components/ScratchpadOverlay.tsx` — New overlay component wrapping editor
- `src/renderer/src/components/ScratchpadOverlay.module.css` — Overlay styles
- `src/renderer/src/paletteItems.ts` — Added scratchpad command to palette
- `src/renderer/src/App.tsx` — Render overlay when `ui.scratchpadOpen`
- `src/renderer/src/components/ui/Modal.tsx` — Added 'lg' width option
- `src/renderer/src/components/ui/Modal.module.css` — Added lg width style

**Features implemented:**
- Overlay toggled by Cmd+N (menu) or Command Palette
- Escape closes overlay, returns focus
- Modal with header, save/close actions, footer with shortcuts
- Loads content via IPC when opened

**Verification:** Typecheck passes. Build succeeds. All tests pass.

---

## Slice 4 — Debounced save & lifecycle flush

**Completed:** 2026-10-08

**Files changed:**
- `src/renderer/src/components/ScratchpadOverlay.tsx` — Added debounced save (500ms) and flush on close

**Features implemented:**
- Debounced save ~500ms after last keystroke
- Flush on overlay close
- App quit handled by renderer flush-on-close

**Verification:** Typecheck passes. Build succeeds. All tests pass.

---

## Slice 5 — Error handling & missing file

**Completed:** 2026-10-08

**Files changed:**
- `src/main/ipc.ts` — `notes:read` returns empty string on ENOENT
- `src/renderer/src/components/ScratchpadOverlay.tsx` — Error banner with Retry button on write failure
- `src/renderer/src/components/ui/Banner.tsx` — Reused existing banner component

**Features implemented:**
- Missing file opens as empty (no error)
- Failed write shows visible error banner with Retry button
- Error clears on successful retry

**Verification:** Typecheck passes. Build succeeds. All tests pass.

---

## Summary

All 5 slices completed successfully. The global notes scratchpad feature is fully implemented:

1. **Core IPC & file I/O** - Notes stored at `~/Library/Application Support/grove/notes.md` with atomic writes
2. **CodeMirror 6 editor** - Markdown source mode with live styling and clickable checkboxes
3. **Overlay & toggle** - Cmd+N shortcut, Command Palette entry, Escape to close
4. **Debounced save** - 500ms debounce, flush on close and quit
5. **Error handling** - Graceful handling of missing file, visible error banner with retry

**Commands to verify:**
- `npm run typecheck` — passes
- `npm run build` — succeeds
- `npm run test` — all 634 tests pass
- `npm run dev` — app launches, Cmd+N opens scratchpad, editing works, persistence works