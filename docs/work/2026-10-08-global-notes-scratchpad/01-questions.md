---
phase: questions
status: draft
version: 1
based_on: feature.md
---

# Global notes scratchpad

## Goal

Add a lightweight, always-accessible personal notes overlay to grove for capturing casual reminders and informal todo lists without tying them to features or sessions.

## Out of scope

- Per-project notes
- Collaborative notes or sharing
- Historical versions or undo beyond the current session
- Rich formatting beyond standard markdown (no embedded media, custom styling, etc.)
- Integration with features or workflow tracking

## Research questions

1. How does the current app handle file I/O and persistence for user-created content (e.g., hook spool, artifact writes)?
2. What is the atomic write mechanism used in core for userData files, and can it safely handle concurrent reads and writes?
3. How does the renderer currently communicate with core via IPC for non-session data (e.g., settings, config)?
4. What is the current keybinding architecture, and how are modals/overlays rendered without changing focus?
5. How does the app handle file-not-found scenarios (e.g., missing config) — does it create defaults or fail gracefully?
6. What is the current approach to debouncing and batching in the renderer when frequent state updates occur?
7. How do overlays currently manage escape/close behavior, and do they persist state before dismissing?
8. What is the app's shutdown sequence, and where would "flush pending writes" need to be added?

## Product questions for the human

1. **Shortcut choice** — answered: **Cmd+N** (no clash in `src/main/menu.ts`: Cmd+T/J/W/1-9/B/Shift+B/Alt+B/G/Shift+G/K are taken).
2. **Save behavior on unsaved changes** — answered: **autosave**. Debounced save plus flush on close and quit, no warning dialog.
3. **Search/filter in v1**: should the notes overlay have a search bar, or just the editor?
4. ~~Markdown preview / clickable checkboxes~~ — settled in the grill session: source mode with live styling, `- [ ]` clickable in the editor, no preview pane.

## Size verdict

**S** — clear result, a single UI overlay + IPC plumbing + file I/O. No unknown patterns (debouncing, atomic writes, and CodeMirror 6 are all established). No one-way decisions left post-grill.

**Flow: small** — no research or design phases needed.

## Open questions

(none — all decisions made in grill session)

## Flow log

- 2026-10-08: small (all decisions made in grill session, confirmed)
