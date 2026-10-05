# 0012. CSS Modules with token custom properties; terminal colours in theme.ts

Date: 2026-10-05

## Status

Accepted

## Context

The walking skeleton styled the renderer with inline `style={{}}` literals,
duplicated across files, and repeated `#1e1e1e` in `index.html`,
`BrowserWindow.backgroundColor` and `src/shared/theme.ts`. Later children
(sidebar tree, feature page, palette, grid, artifact viewer) need shared
tokens and base components. Colours are needed in three runtimes: renderer
CSS, xterm.js options (JS), and main/core (window background, tmux
`select-pane -P`), where no CSS exists.

## Decision

Components are styled with CSS Modules (`Name.module.css` next to
`Name.tsx`), reading custom properties from one global
`src/renderer/src/styles/tokens.css`. No visual inline styles; runtime values
pass only as CSS variables, enforced by a text-scan test.
`src/shared/theme.ts` owns the colours JS needs (`chromeBackground`,
`terminalTheme`). The few values both files need are repeated in
`tokens.css` and kept equal by `styles/tokens.test.ts`.

## Consequences

- No new dependency; Vite handles CSS Modules as is. Class names are scoped,
  so children can add screens without global collisions.
- Two token files: editing the chrome or terminal colours means editing both,
  and the parity test fails until they match.
- Rejected: one global stylesheet with naming conventions (global namespace,
  merge conflicts across children); Tailwind v4 (new dependency and
  vocabulary for ~10 components); a single TS token source injected onto
  `:root` at startup (tokens invisible in CSS, a runtime step before first
  paint); a Vite plugin generating CSS from TS (custom build code to avoid
  three duplicated values).
