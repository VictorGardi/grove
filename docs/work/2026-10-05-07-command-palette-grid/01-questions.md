---
feature: 2026-10-05-07-command-palette-grid
phase: questions
status: approved
version: 1
created: 2026-10-07
updated: 2026-10-07
approved_at: 2026-10-07
based_on:
  - parent:03-design.md@6
  - parent:04-structure.md@6
forced: []
---

# Questions: command palette and grid view

Child mode (epic `2026-10-05-opencode-feature-workspace`). Delta questions only:
the epic's research (v5) predates the code and covers xterm.js, node-pty and
tmux attach in general, not this app's current implementation.

## Goal

Keyboard-first navigation, and several live terminals at once. Cmd+K opens a
palette that jumps to a feature or focuses a session. A grid shows several live
sessions side by side. (Palette actions were dropped on 2026-10-07; child 5 is
on hold.)

## Out of scope

- Running next actions from the palette (E-D2, child 5; on hold)
- Anything in the on-hold workflow work (ADR 0020)
- Cross-project or cross-feature search of artifact contents

## Research questions

Facts about the code today, with file references.

1. How are keyboard accelerators registered today (the app menu, any
   renderer key handlers), what do Cmd+K and Cmd+1..9 currently do, and which
   key combinations reach a focused terminal versus being handled by the app?
2. How does a terminal attach work end to end today (renderer, preload, IPC,
   main, the PTY, the tmux attach client)? Is more than one attach per session,
   or more than one concurrent attach in total, handled today, and how does a
   tmux session behave in the shipped tmux config when attach clients of
   different sizes exist?
3. How does `TerminalView` mount, size, fit, resize, render (WebGL or DOM),
   take focus, and tear down, and which of that state is per instance and which
   is shared?
4. What does `UiState` hold and how is it persisted, migrated, pushed to the
   renderer and changed (including `schemaVersion`), and how are the three
   focus fields (`focusedSessionId`, `focusedFeature`, `focusedProject`) set
   and kept exclusive?
5. How does the content area choose what to show (session, feature page,
   project page, viewer panel), and how do the sidebar, the project page's
   Sessions board and the viewer panel share the window's space and width
   state?
6. What data and helpers already produce the session list, session status,
   linked-feature labels and the feature list (the sidebar tree, the Sessions
   board, session status helpers, feature labels), and which of them are
   reusable outside those views?
7. What modal, dialog, list-row and keyboard-navigation patterns exist in the
   renderer (the new-session modal, the link picker, the confirm dialog, base
   components), including focus handling, filtering or matching of any kind,
   and Escape and arrow-key behaviour?
8. How is a session's seen mark (`seenAt`) and the "waiting" status decided
   today, in terms of window focus and which session is on screen, and what
   does that logic assume about how many terminals are visible?
9. What happens to an attach when its session ends, is gone, or is resumed, and
   how are attach lifecycles cleaned up in main?
10. What test setup exists for the renderer and core (runner, environment,
    existing tests of terminal, UI-state and navigation code), and what do the
    verification commands in `grove.config.json` run?

## Product questions for the human

Answered by the human on 2026-10-07, one at a time.

1. **What does Cmd+K search?** Features, sessions, projects and app commands
   (new session, new terminal, toggle viewer and similar menu items). This
   widens the original outcome (features and sessions only); project entries
   land on the project's Sessions board (ADR 0020).
2. **How do sessions get into the grid?** Manual pick: the human adds and
   removes sessions explicitly, and the grid remembers the picks.
3. **Can a grid mix projects?** Yes: one global grid, any project.
4. **What do Cmd+1..9 do while the grid shows?** They focus grid pane N, in
   grid order. Outside the grid they keep meaning sidebar session N.
5. **How are panes laid out?** Auto tiles that reflow to the pane count. Only
   the member list and order persist, not split sizes.
6. **Which grid panes count as seen?** Only the focused pane. Being visible
   is not enough to clear a finished turn's waiting status.

## Size verdict

Not applicable in child mode: the epic's structure bounds the size. Original
estimate 3–4 days, about 5 slices, with palette actions included; with them
dropped, the palette is smaller. Palette first, grid second, so the grid can be
cut on its own.

## Open questions
