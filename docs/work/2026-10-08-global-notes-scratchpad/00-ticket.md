Add a global notes scratchpad to grove: casual personal reminders / informal todo list, not tied to features. Decisions already made in a grill session (treat as settled, don't re-ask):

- Scope: ONE global scratchpad, a single markdown document. Not per-project, no list of notes.
- Persistence: plain markdown file `<userData>/notes.md` (~/Library/Application Support/grove/notes.md), written atomically by core (single writer), never in a repo (keeps ADR 0009). Real markdown, not versioned JSON, so needs a short new ADR noting the departure from ADR 0009's "versioned JSON".
- Editor: CodeMirror 6, source mode with live styling (headings/bold/checkboxes styled inline). First editor dependency. `- [ ]` checkboxes need a small extension to be clickable.
- UI: an overlay toggled by a shortcut and a command-palette command. Does NOT change Focus (session/feature/project). Esc returns to where you were.
- Data flow: renderer loads notes.md via IPC when the overlay opens; debounced save (~500ms idle) via IPC to core; flush on close and on app quit (must go through main's quit path). NOT a pushed slice (ADR 0011 echo/cursor-jump problem). Missing file opens as empty; failed write shows a visible error.
- CLI: none in v1.
- Open: pick a shortcut that doesn't clash with Cmd+K / Cmd+B (check src/main/menu.ts and existing keybindings).
