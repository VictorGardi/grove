---
feature: 2026-10-05-09-visual-foundation
phase: plan
status: approved
version: 1
created: 2026-10-05
updated: 2026-10-05
approved_at:
based_on:
  - 03-design.md@1
  - 04-structure.md@1
forced: []
---

# Plan: visual foundation

Self-approved per slice by grove-implement: mechanical checks passed, not human-reviewed.

## Slice 1 — Tracer: the Xirp shell around the existing UI

Context (code at `26147c5`): no stylesheet exists; `index.html` has one inline
`<style>` painting `#1e1e1e`/`#d4d4d4`; `src/shared/theme.ts` exports a 4-key
`terminalTheme` read by `TerminalView.tsx` (xterm) and `src/core/core.ts:103`
(`backend.setColors(fg, bg)` → tmux); `src/main/index.ts` creates the window
with default chrome and `backgroundColor:'#1e1e1e'`; `App.tsx` lays everything
out with inline styles. `tsconfig.web.json` has no `types` field, so
`@types/node` is available to `src/renderer/src/**/*.test.ts`; Vitest runs in
`node` and includes `src/**/*.test.ts`.

- [x] Write failing test `src/renderer/src/styles/tokens.test.ts` (D2 parity):
  read `./tokens.css` with `readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')`,
  parse `--name: value;` pairs with a regex, and assert (lower-cased)
  `--chrome-bg` === `chromeBackground`, `--terminal-bg` === `terminalTheme.background`,
  `--terminal-fg` === `terminalTheme.foreground` (imports from `@shared/theme`).
  Also assert `terminalTheme` has all 16 ANSI keys (`black … brightWhite`).
- [x] Change `src/core/sessions.test.ts` "sets the terminal colours on create"
  to expect `[s.tmuxName, terminalTheme.foreground, terminalTheme.background]`
  (import `terminalTheme` from `@shared/theme`). `src/core/backend/tmux.test.ts`
  passes literal colours as test input and stays unchanged.
- [x] Rewrite `src/shared/theme.ts`:
  `export const chromeBackground = '#0a0a0b'` and `export const terminalTheme`
  = Catppuccin Mocha: `foreground #cdd6f4`, `background #1e1e2e`,
  `cursor #f5e0dc`, `cursorAccent #1e1e2e`, `selectionBackground #585b70`,
  `black #45475a`, `red #f38ba8`, `green #a6e3a1`, `yellow #f9e2af`,
  `blue #89b4fa`, `magenta #f5c2e7`, `cyan #94e2d5`, `white #bac2de`,
  `brightBlack #585b70`, `brightRed #f38ba8`, `brightGreen #a6e3a1`,
  `brightYellow #f9e2af`, `brightBlue #89b4fa`, `brightMagenta #f5c2e7`,
  `brightCyan #94e2d5`, `brightWhite #a6adc8`.
- [x] Create `src/renderer/src/styles/tokens.css`: `:root { … }` with every
  token in `03-design.md` "Tokens" table, named as there (surfaces, borders,
  text, accent, status, card tones as `--card-selected-bg/-border`,
  `--card-waiting-bg/-border`, `--card-finished-bg/-border`, danger, type,
  space `--sp-1 4px` … `--sp-6 24px`, `--gutter 8px`, radius, sizes
  `--topbar-h 51px`, `--header-h 47px`, `--traffic-inset 80px`,
  `--sidebar-w 230px` default), plus `--scrollbar-thumb #38383c` (research Q7).
- [x] Create `src/renderer/src/styles/base.css`: `*, *::before, *::after
  { box-sizing: border-box }`; `html, body, #root { margin:0; height:100%;
  background: var(--chrome-bg); color: var(--text); font: var(--fs-md)/1.4
  var(--font-ui); color-scheme: dark; -webkit-font-smoothing: antialiased;
  overflow: hidden }`; 6px webkit scrollbars with `var(--scrollbar-thumb)`
  thumb and transparent track; global helpers `.app-drag { app-region: drag;
  -webkit-app-region: drag; user-select: none }` and `.app-no-drag
  { app-region: no-drag; -webkit-app-region: no-drag }`.
- [x] `src/renderer/src/main.tsx`: import `./styles/tokens.css` then
  `./styles/base.css` after the `xterm.css` import.
- [x] `src/renderer/index.html`: delete the `<style>` block; add
  `<meta name="color-scheme" content="dark" />`. CSP unchanged.
- [x] `src/main/index.ts`: import `chromeBackground` from `@shared/theme`;
  window options `titleBarStyle: 'hidden'`, `trafficLightPosition: { x: 18, y: 18 }`,
  `backgroundColor: chromeBackground`, `show: false`; after creation
  `win.once('ready-to-show', () => win?.show())`.
- [x] Create `src/renderer/src/components/ui/cx.ts`:
  `export function cx(...c: (string | false | null | undefined)[]): string`
  returning the truthy entries joined by a space.
- [x] Create `src/renderer/src/components/shell/AppShell.tsx` + `AppShell.module.css`:
  `AppShell({ topBar, banners?, sidebar, content, sidebarWidth })`. Root is a
  flex column, `height:100%`, `background: var(--chrome-bg)`, inline
  `style={{ '--sidebar-w': `${sidebarWidth}px` } as CSSProperties}` (the only
  inline style form allowed). Order: topBar, banners, then a body row
  (`flex:1; min-height:0; display:flex; gap: var(--gutter);
  padding: 0 var(--gutter) var(--gutter)`) holding `<aside class=sidebar>`
  (`width: var(--sidebar-w); flex-shrink:0`) and `<main class=content>`
  (`flex:1; min-width:0; display:flex; flex-direction:column`), both panels
  `background: var(--panel-bg); border-radius: var(--r-panel); overflow:hidden`.
- [x] Create `src/renderer/src/components/shell/TopBar.tsx` + `TopBar.module.css`:
  `TopBar({ onNew })`. Bar: `height: var(--topbar-h)`, class `app-drag`, grid
  `1fr auto 1fr`, align center, `padding-left: var(--traffic-inset)`,
  `padding-right: var(--sp-4)`. Left: wordmark "grove" (`--fs-xl`, weight 700,
  `--text`). Centre: search pill `<div role="search" aria-disabled="true">`
  with text "Search grove" (width 345px, height 32px, `--r-pill`,
  `--raised-bg`, `--text-2`, `--fs-lg`, padding `0 var(--sp-4)`, class
  `app-no-drag`, `cursor: default`) followed by a 30px round button "+"
  (`aria-label="New session"`, `--raised-bg`, `--text`, no border, class
  `app-no-drag`, `onClick={onNew}`), the two in a flex row with `--sp-2` gap.
  Right column empty.
- [x] Create `src/renderer/src/components/shell/ContentHeader.tsx` +
  `ContentHeader.module.css`: `ContentHeader({ crumbs, right? })`. Header
  `height: var(--header-h)`, `flex-shrink:0`, flex row, align center,
  `padding: 0 var(--sp-4)`, `border-bottom: 1px solid var(--header-divider)`.
  Crumbs: every crumb but the last in `--text-2` followed by " / "; the last in
  `--text`, weight 700, `--fs-lg`; single line, ellipsis. `right` sits at the
  far right (`margin-left:auto`).
- [x] `src/renderer/src/components/TerminalView.tsx` + new `TerminalView.module.css`:
  return `<div className={s.frame}><div ref={ref} className={s.term} /></div>`;
  `.frame { flex:1; min-width:0; min-height:0; display:flex; padding: var(--sp-3);
  background: var(--terminal-bg); isolation: isolate }` (keep the existing
  isolation comment); `.term { flex:1; min-width:0; min-height:0 }`. Terminal
  options add `lineHeight: 1.35` (fontFamily `'Menlo, monospace'`, fontSize 13
  unchanged).
- [x] `src/renderer/src/App.tsx` + new `App.module.css`: render
  `<AppShell topBar={<TopBar onNew={() => setModalOpen(true)} />} banners={…}
  sidebar={<Sidebar />} content={…} sidebarWidth={ui.sidebarWidth} />`, modals
  after it inside a fragment. `banners` = the existing error `div`s unchanged
  (Banner arrives in slice 2). `content` = `<ContentHeader crumbs={…} />` then
  the existing three-way body; crumbs = `[project name, focused.label]` when a
  session is focused (project from `projects.find(p => p.id === focused.projectId)`,
  name omitted if not found), else `[]`. Move the ended/empty pane inline
  styles to `App.module.css` classes `.ended` (flex 1, column, centred,
  `gap: var(--sp-3)`) and `.empty` (flex 1). `Sidebar.tsx` is not touched
  (slice 3).
- [x] Run `npm test`
- [x] Run `npm run typecheck`
- [x] Run `npm run build`
- [ ] Manual (human, `npm run dev`): drag the window by the top bar; ＋ opens
  the modal; a new Terminal session shows a `#1e1e2e` background; the window
  never shows a light or `#1e1e1e` frame on launch.

## Open questions
