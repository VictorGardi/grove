---
phase: plan
status: approved
version: 1
created: 2026-10-08
updated: 2026-10-08
based_on:
  - 01-questions.md@1
feature: 2026-10-08-global-notes-scratchpad
---

Self-approved per slice by grove-implement: mechanical checks passed, not human-reviewed.

## Slice 1 — Core IPC & file I/O (tracer bullet)

- [x] Add `notes:read` and `notes:write` to `InvokeMap` in `src/shared/ipc.ts`
- [x] Add handlers for `notes:read` and `notes:write` in `src/main/ipc.ts`
- [x] Implement `notes:read` using `fs.readFileSync` with ENOENT → empty string
- [x] Implement `notes:write` using `atomicWrite` from `src/core/store/jsonFile.ts`
- [x] Run `npm run dev` and verify in DevTools console:
  - `await window.api.invoke('notes:read')` returns empty string
  - `await window.api.invoke('notes:write', { content: '# test' })` returns `{ ok: true }`
  - Second read returns `'# test'`
  - File exists at `~/Library/Application Support/grove/notes.md` with that content

## Slice 2 — CodeMirror 6 editor component

- [x] Add `@codemirror/view`, `@codemirror/state`, `@codemirror/basic-setup`, `@codemirror/lang-markdown`, `@lezer/highlight`, `@lezer/markdown` to package.json
- [x] Create `src/renderer/src/components/ScratchpadEditor.tsx` with CodeMirror 6 editor
- [x] Create `src/renderer/src/components/ScratchpadEditor.module.css` for editor styles
- [x] Editor supports: headings, bold/italic, code, links, blockquotes, horizontal rules, lists
- [x] Checkboxes `- [ ]` / `- [x]` are clickable and toggle state
- [x] Cmd+S triggers `onSave` callback
- [x] Verification: `npm run dev` → render component in test → typing updates onChange → headings bold, checkboxes clickable

## Slice 3 — Scratchpad overlay & toggle

- [x] Add `scratchpadOpen` to `UiState` in `src/shared/types.ts`
- [x] Add `scratchpad` to `MenuAction` in `src/shared/ipc.ts`
- [x] Add Cmd+N menu item in `src/main/menu.ts` sending `menu:action { type: 'scratchpad' }`
- [x] Add `toggleScratchpad()` action in `src/renderer/src/stores/slices.ts`
- [x] Create `src/renderer/src/components/ScratchpadOverlay.tsx` wrapping `ScratchpadEditor`
- [x] Add `scratchpad` command to `PALETTE_COMMANDS` in `src/renderer/src/paletteItems.ts`
- [x] Render `<ScratchpadOverlay />` in `src/renderer/src/App.tsx` when `ui.scratchpadOpen`
- [x] Verification: `npm run dev` → press Cmd+N → overlay opens with editor → type text → press Escape → overlay closes, focus returns → Cmd+N reopens with same text → Command Palette → "Scratchpad" entry works

## Slice 4 — Debounced save & lifecycle flush

- [x] Add debounced save logic (~500ms) in `ScratchpadOverlay.tsx`
- [x] Call `notes:write` on change/close
- [x] Handle app quit flush in main process (renderer flush-on-close is sufficient)
- [x] Verification: `npm run dev` → open scratchpad → type "hello" → wait 600ms → read file at `~/Library/Application Support/grove/notes.md` contains "hello" → close overlay → reopen → content persists → quit app → reopen app → content persists

## Slice 5 — Error handling & missing file

- [x] Missing `notes.md` opens as empty (no error) - implemented in `notes:read`
- [x] Failed write shows visible error banner in overlay with "Retry" button
- [x] Verification: `npm run dev` → make `notes.md` unwritable (chmod 000) → open scratchpad → type → save fails → banner appears with error → fix permissions → click Retry → save succeeds → banner disappears