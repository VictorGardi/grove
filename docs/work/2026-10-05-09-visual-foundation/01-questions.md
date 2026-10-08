---
feature: 2026-10-05-09-visual-foundation
phase: questions
status: approved
version: 1
created: 2026-10-05
updated: 2026-10-05
approved_at: 2026-10-05
based_on:
  - parent:02-research.md@5
  - parent:03-design.md@1
  - parent:04-structure.md@4
forced: []
---

# Questions: visual foundation

Child 9 of epic `2026-10-05-opencode-feature-workspace`, built second. The
epic's research and design are inherited, and none of their `E-D` decisions
are re-asked here. The epic decides no styling, theme or component library
questions, so those are this child's to settle. The questions below are the
delta.

## Goal

Make the app look deliberate and consistent, similar to how Xirp by Spotify
looks (`../2026-10-05-opencode-feature-workspace/refs/xirp-reference.png`),
with shared tokens and base components that later children build on.

## Out of scope

- Behaviour owned by other children: the feature tree and Projects view
  (child 2), session status and the waiting count (child 3), the command
  palette and search (child 7), the grid view (child 7).
- Changes to IPC, core, state files or the tmux backend.
- Packaging, app icon and signing (child 8).

## Research questions

1. How is styling done in `src/renderer` today? List every place a colour,
   font, size or spacing value is set, and how values are shared, if at all.
2. Which stylesheets reach the renderer, how are they loaded (imports,
   `index.html`), and which CSS features does the electron-vite 5 / Vite 7
   build handle with no extra configuration (CSS modules, PostCSS, `@import`,
   CSS custom properties)?
3. What does the renderer's Content-Security-Policy allow for styles, fonts
   and images? Can it load font files bundled in the repo, or fonts from a
   remote host?
4. How is the main `BrowserWindow` set up for window chrome today (title bar
   style, traffic-light position, background colour, vibrancy), and which
   options does Electron 44 offer on macOS for a custom top bar with the
   traffic lights inside app content?
5. How does the terminal's colour theme flow today, from `src/shared/theme.ts`
   through xterm.js options to tmux `select-pane -P` and OSC 10/11? Which of
   these read the colours at runtime, and which only at session creation?
6. Which fonts are available on a stock macOS install for UI text and for
   monospace text, and which fonts does xterm.js's WebGL renderer handle well
   (glyph metrics, ligatures, fallback)?
7. What does the reference screenshot show, measured: the colours (background
   layers, text, accent, status colours), type sizes and weights, spacing,
   corner radii, border treatments, and the layout regions with their sizes?
8. Which UI surfaces do the epic's desired-state items and the later
   children's outcomes describe (sidebar tree, feature page, Board, stage
   timeline, banners, buttons, palette, grid, artifact viewer chrome)? List
   them so the component set can be checked against them.
9. How does the renderer handle macOS appearance today (light/dark,
   `prefers-color-scheme`, `nativeTheme`), and what does the window show
   before the renderer paints?

## Product questions for the human

1. How close to Xirp: a near-copy of its look, or its style applied to
   grove's own layout?
   **Answer:** a near-copy of its look: the same palette, density, card style
   and top-bar layout, as close as practical.
2. Dark only, like the screenshot, or follow the macOS light/dark setting?
   **Answer:** dark only, matching Xirp's dark look. There is one theme, and the
   terminal colours are fixed.
3. Sidebar: cards like Xirp's sessions, or denser rows, given that the
   sidebar becomes a project → epic → feature tree in child 2?
   **Answer:** cards like Xirp. As in Xirp, each card can be compacted on its
   own into a one-line form, and each project folder can be collapsed to a
   single line when it isn't needed. Note for design: the epic gives "collapsed
   nodes" in per-viewer UI state to child 2 (two-way row Per-viewer UI state).
   This child supplies the compact-card and collapsible-folder visuals.
   Design decides where their state is stored and which child persists it.
4. Accent colour: Xirp's amber/orange, or your own?
   **Answer:** Xirp's amber/orange, as in the screenshot (the selected card's
   border, the count badge, the status icons).
5. Window chrome: a custom top bar with the traffic lights inside it (as in
   Xirp), or the standard macOS title bar?
   **Answer:** a custom top bar like Xirp: a hidden title bar, the traffic
   lights inset in an app top bar that can be dragged, and a search field and
   ＋ in the bar. The search is wired up in child 7. Until then the field is
   inert or hidden, which design decides. Scope note: this changes the
   `BrowserWindow` options in `src/main/index.ts`. That is outside "renderer
   only" in the epic entry, but it touches no IPC, state or core, so it stays
   in this child.

## Size verdict

Child of an epic: the size is bounded by the epic's structure (2–3 days,
about 4 slices, at most 2 own one-way decisions).

## Open questions
