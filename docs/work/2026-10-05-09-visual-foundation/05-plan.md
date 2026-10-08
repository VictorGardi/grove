---
feature: 2026-10-05-09-visual-foundation
phase: plan
status: approved
version: 1
created: 2026-10-05
updated: 2026-10-05
approved_at:
based_on:
  - 03-design.md@2
  - 04-structure.md@2
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
- [x] Manual (human, `npm run dev`): drag the window by the top bar; ＋ opens
  the modal; a new Terminal session shows a `#1e1e2e` background; the window
  never shows a light or `#1e1e1e` frame on launch. (Human reviewed the
  running app; feedback became design v2, built in slice 2.)

## Slice 2 — Modals, buttons, banner and panes

Context (code at `14c8d1f`, design v2): tokens/base CSS, `cx`, `AppShell`,
`TopBar` (wordmark at `--traffic-inset` 80px, plain `<button>` ＋),
`ContentHeader` exist. `TerminalView` wraps xterm in `.frame` with
`padding: var(--sp-3)`. `NewSessionModal` and `ConfirmDialog` still use
duplicated inline backdrop/panel styles; App's error banners are inline-styled
`div`s; the "Session ended" pane uses a native `<button>`. No colour literal
may appear outside `tokens.css`/`theme.ts` (design D2).

- [x] `src/renderer/src/styles/tokens.css`: set `--traffic-inset: 100px`; add
  under surfaces `--backdrop: rgba(0, 0, 0, 0.5)` and
  `--shadow-modal: 0 16px 48px rgba(0, 0, 0, 0.5)`.
- [x] Create `src/renderer/src/components/ui/Icon.tsx`: `export type IconName =
  'plus' | 'folder' | 'folder-plus' | 'chevron-down' | 'chevron-right' |
  'terminal' | 'opencode' | 'branch' | 'search' | 'info' | 'trash' |
  'minimize' | 'x' | 'logo'`; `Icon({ name, size = 16, className })` renders
  `<svg width/height={size} viewBox="0 0 24 24" fill="none"
  stroke="currentColor" strokeWidth={1.5} strokeLinecap="round"
  strokeLinejoin="round" aria-hidden="true">` with a `Record<IconName,
  ReactNode>` of Lucide (ISC) shapes, comment `// shapes after Lucide (ISC)`:
  plus = `M5 12h14`,`M12 5v14`; folder = `M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z`;
  folder-plus = folder + `M12 10v6`,`M9 13h6`; chevron-down = `m6 9 6 6 6-6`;
  chevron-right = `m9 18 6-6-6-6`; terminal = `m4 17 6-6-6-6`,`M12 19h8`;
  branch = `M6 3v12`, circles (18,6,r3) and (6,18,r3), `M18 9a9 9 0 0 1-9 9`;
  search = circle (11,11,r8), `m21 21-4.3-4.3`; info = circle (12,12,r10),
  `M12 16v-4`,`M12 8h.01`; trash = `M3 6h18`,`M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6`,`M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2`;
  minimize = `M4 14h6v6`,`M20 10h-6V4`,`m14 10 7-7`,`m3 21 7-7`;
  x = `M18 6 6 18`,`m6 6 12 12`; opencode = circle (12,12,r9), `M10 9v6`,`M14 9v6`;
  logo (Lucide "trees") = `M10 10v.2A3 3 0 0 1 8.9 16H5a3 3 0 0 1-1-5.8V10a3 3 0 0 1 6 0Z`,
  `M7 16v6`,`M13 19v3`,`M12 19h8.3a1 1 0 0 0 .7-1.7L18 14h.3a1 1 0 0 0 .7-1.7L16 9h.2a1 1 0 0 0 .8-1.7L13 3l-1.4 1.5`.
- [x] Create `src/renderer/src/components/ui/Button.tsx` + `Button.module.css`:
  `Button({ variant = 'secondary', size = 'md', icon, round, className,
  children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?:
  'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md'; icon?:
  IconName; round?: boolean })` → `<button type="button" {...rest}
  className={cx(s.button, s[variant], s[size], round && s.round, className)}>`
  with `<Icon name={icon} size={size === 'sm' ? 14 : 16} />` before children.
  CSS: `.button` inline-flex, centred, `gap: var(--sp-1)`, no border
  (`border: 1px solid transparent`), `border-radius: var(--r-md)`,
  `font: inherit`, weight `--fw-semibold`, `cursor: pointer`,
  `white-space: nowrap`; `:hover { filter: brightness(1.15) }`;
  `:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 2px }`;
  `:disabled { opacity: .5; cursor: default; filter: none }`.
  `.sm` height 24px, padding `0 var(--sp-2)`, `--fs-sm`; `.md` height 32px,
  padding `0 var(--sp-3)`, `--fs-md`. `.round` `width` = height, `padding: 0`,
  `border-radius: var(--r-pill)`. `.primary` bg `--accent`, color `--chrome-bg`;
  `.secondary` bg `--raised-bg`, color `--text`, border-color `--card-border`;
  `.ghost` transparent, color `--text-2`, `:hover` color `--text`;
  `.danger` bg `--danger-bg`, color `--danger`, border-color `--danger-border`.
- [x] Create `src/renderer/src/components/ui/Modal.tsx` + `Modal.module.css`:
  `Modal({ onClose, onConfirm, width = 'md', children })`. Effect adds a
  capture-phase `keydown` listener on `window` (comment: capture, so the keys
  don't also reach a focused terminal): Escape → `preventDefault`,
  `stopPropagation`, `onClose()`; Enter when `onConfirm` is set → same, then
  `onConfirm()`; other keys untouched. Markup: `<div className={s.backdrop}
  onClick={onClose}><div role="dialog" aria-modal="true"
  className={cx(s.panel, s[width])} onClick={e => e.stopPropagation()}>{children}</div></div>`.
  CSS: `.backdrop` fixed, `inset:0`, `z-index:1000`, bg `--backdrop`, flex,
  `align-items:flex-start`, `justify-content:center`, `padding-top:120px`;
  `.panel` bg `--panel-bg`, `border: 1px solid var(--card-border)`,
  `border-radius: var(--r-panel)`, `box-shadow: var(--shadow-modal)`,
  `padding: var(--sp-4)`, flex column, `gap: var(--sp-3)`; `.sm` width 360px;
  `.md` width 520px.
- [x] Create `src/renderer/src/components/ui/Badge.tsx` + `Badge.module.css`:
  `Badge({ tone = 'accent', children })` → `<span className={cx(s.badge, s[tone])}>`.
  `.badge` inline-flex centred, `min-width:20px`, `height:16px`,
  `padding: 0 var(--sp-1)`, `border-radius: var(--r-card)`, `--fs-sm`,
  `--fw-bold`; `.accent` bg `--accent-badge`, color `--chrome-bg`; `.muted`
  bg `--muted-badge-bg`, color `--text-2`.
- [x] Create `src/renderer/src/components/ui/Banner.tsx` + `Banner.module.css`:
  `Banner({ tone = 'error', children })` → `<div role="alert"
  className={cx(s.banner, s[tone])}><Icon name="info" size={14} /><span>{children}</span></div>`.
  `.banner` flex, align center, `gap: var(--sp-2)`,
  `margin: 0 var(--gutter) var(--gutter)`, `padding: var(--sp-2) var(--sp-3)`,
  `border: 1px solid`, `border-radius: var(--r-md)`, `--fs-md`; `.error` bg
  `--danger-bg`, color `--danger`, border-color `--danger-border`; `.info` bg
  `--raised-bg`, color `--text-2`, border-color `--card-border`.
- [x] `src/renderer/src/components/shell/TopBar.tsx` + `.module.css`: left
  cell becomes `<div className={s.brand}><span className={s.logo}><Icon
  name="logo" size={15} /></span><span className={s.wordmark}>grove</span></div>`;
  `.brand` flex, align center, `gap: var(--sp-2)`; `.logo` 22×22px grid
  centred, `border-radius: var(--r-card)`, bg `--text`, color `--chrome-bg`.
  Search pill gains `<Icon name="search" />` before its text (pill `gap:
  var(--sp-2)`). Replace the ＋ `<button>` with `<Button round icon="plus"
  aria-label="New session" className="app-no-drag" onClick={onNew} />` and
  delete the `.new` rule.
- [x] `src/renderer/src/components/TerminalView.module.css`: `.frame` padding
  `var(--sp-1)` (terminal fills the panel under the header; the panel's
  `overflow:hidden` + `--r-panel` rounds its bottom corners).
- [x] Rewrite `src/renderer/src/components/ConfirmDialog.tsx` (props unchanged)
  on `<Modal width="sm" onClose={onCancel} onConfirm={onConfirm}>`: title
  `<div className={s.title}>` (`--fs-lg`, `--fw-bold`), body `<div
  className={s.body}>` (`--text-2`), actions row `<div className={s.actions}>`
  (flex, `justify-content:flex-end`, `gap: var(--sp-2)`) with `<Button
  onClick={onCancel}>Cancel</Button>` and `<Button variant="primary" autoFocus
  onClick={onConfirm}>{confirmLabel}</Button>`; new `ConfirmDialog.module.css`.
  Remove its own key effect (Modal owns keys).
- [x] Rewrite `src/renderer/src/components/NewSessionModal.tsx` +
  new `NewSessionModal.module.css`: props `{ onClose; initialProjectId?:
  string }`; `projectId` initial state `initialProjectId ?? projects[0]?.id ?? ''`.
  Remove its own key effect. Render `<Modal onClose={onClose}
  onConfirm={projects.length ? () => void create() : undefined}>`. No
  projects: `<div className={s.hint}>Add a project first</div>` (`--text-2`).
  Otherwise: heading `<div className={s.title}>New session</div>` (`--fs-lg`,
  `--fw-bold`); a `<label className={s.field}>` with caption `Project`
  (`--fs-sm`, `--text-2`) and the `<select autoFocus className={s.select}>`
  (height 32px, width 100%, bg `--raised-bg`, `border: 1px solid
  var(--card-border)`, `border-radius: var(--r-md)`, color `--text`,
  `font: inherit`, `padding: 0 var(--sp-2)`); a kind row `<div
  className={s.kinds} role="radiogroup">` (grid, 2 equal columns, `gap:
  var(--sp-2)`) with two `<Button size="md" icon="opencode"|"terminal"
  role="radio" aria-checked={kind === k} className={cx(s.kind, kind === k &&
  s.kindOn)} onClick={() => setKind(k)}>` labelled `OpenCode` / `Terminal`
  (`.kind` height 40px; `.kindOn` bg `--card-selected-bg`, border-color
  `--card-selected-border`); `{error && <div className={s.error}>{error}</div>}`
  (`--danger`, `--fs-sm`); footer `<div className={s.footer}>` (flex,
  `justify-content:flex-end`) with `<Button variant="primary"
  onClick={() => void create()}>Create ↵</Button>`.
- [x] `src/renderer/src/App.tsx`: banners → `errors.map((e, i) => <Banner
  key={i}>{e}</Banner>)`; ended pane → `<div className={s.ended}><div
  className={s.endedTitle}>Session ended</div><Button icon="trash" onClick={…
  session:remove …}>Remove</Button></div>`; empty pane → `<div
  className={s.empty}>Start a session with ＋ or ⌘T</div>`. `App.module.css`:
  `.endedTitle` `--fs-lg`, `--text-2`; `.empty` becomes flex 1, centred,
  color `--text-3`.
- [x] Run `npm run typecheck`
- [x] Run `npm run build`
- [x] Run `npm test`
- [x] Manual (human, `npm run dev`): Cmd+T → Enter creates, Escape closes;
  Cmd+W on a running session → confirm, Enter kills, Escape cancels, keys
  don't reach the terminal; `exit` in a terminal shows "Session ended" and
  Remove works; the wordmark has a clear gap after the green light; an
  OpenCode session's background reaches the panel edges and its bottom
  corners are rounded. (Human reviewed and said continue.)

## Slice 3 — Sidebar cards and folders

Context (code at `302f9b2`): `Sidebar.tsx` is the last inline-styled
component (`linkButton` object, row/panel literals, old `width`/`border-right`
that `AppShell` now owns). `Button`, `Badge`, `Icon` (incl. `folder-plus`,
`minimize`, `trash`, `opencode`, `terminal`, chevrons) exist. `App` opens the
modal through a boolean `modalOpen`; `NewSessionModal` already takes
`initialProjectId`. `sidebarOrder.ts` (Cmd+1..9 order) is unchanged.

- [x] `src/shared/types.ts`: `DEFAULT_UI.sidebarWidth` 260 → 230.
- [x] Create `src/renderer/src/components/ui/StatusDot.tsx` + `.module.css`:
  `export type StatusTone = 'running' | 'working' | 'waiting' | 'idle' |
  'finished' | 'gone'`; `StatusDot({ tone })` → `<span className={cx(s.dot,
  s[tone])} />`; `.dot` 6×6px, `border-radius: var(--r-pill)`, flex-shrink 0;
  one class per tone with `background: var(--status-<tone>)`.
- [x] Create `src/renderer/src/components/ui/ListRow.tsx` + `.module.css` with
  the design signature. Markup: `<div className={cx(s.row, s[tone], compact &&
  s.compact)} onClick={onClick}>` → line 1 `.head` (flex, align center,
  `gap: var(--sp-2)`): `icon`, then `editor` if given else `<span
  className={s.title} onDoubleClick={onTitleDoubleClick}>{title}</span>`
  (flex 1, min-width 0, `--fw-bold`, `--fs-md`, `--text`, nowrap, ellipsis),
  then when `compact && status` a `<StatusDot tone={status.tone} />`, then
  `actions` inside `<div className={s.actions} onClick={e =>
  e.stopPropagation()}>` (flex, `gap: 2px`, opacity 0; shown at opacity 1 on
  `.row:hover` and `.row:focus-within`). When not compact: `meta` in `.meta`
  (`--font-mono`, `--fs-sm`, `--text-2`) and `status` in `<div
  className={cx(s.status, s[`s-${status.tone}`])}>{status.label}</div>`
  (`--font-mono`, `--fs-xs`, colour `var(--status-<tone>)` per tone class).
  `.row`: `padding: var(--sp-2) 10px`, `background: var(--card-bg)`,
  `border: 1px solid var(--card-border)`, `border-radius: var(--r-card)`,
  `cursor: pointer`, flex column, `gap: var(--sp-1)`; `.row:hover`
  border-color `--text-3`; `.compact` padding `6px 10px`; `.selected` bg
  `--card-selected-bg`, border `--card-selected-border`; `.waiting` bg/border
  `--card-waiting-*`, `box-shadow: 0 0 var(--card-glow) var(--card-waiting-border)`;
  `.finished` same with `--card-finished-*`.
- [x] Rewrite `src/renderer/src/components/Sidebar.tsx` + new
  `Sidebar.module.css`; signature `Sidebar({ onNew }: { onNew: (projectId?:
  string) => void })`. Local state: `refused: string | null` (as today),
  `collapsed: Set<string>` (project ids), `compact: Set<string>` (session ids),
  toggled through a `toggle(set, id)` helper returning a new Set.
  - Root `.sidebar` flex column, `height: 100%`.
  - Header `.header` (flex, align center, `gap: var(--sp-2)`, `padding:
    var(--sp-3) var(--sp-3) 0`): `.tab` "Sessions" (`--fs-xl`, `--fw-bold`,
    `padding-bottom: 6px`, `border-bottom: 2px solid var(--accent-strong)`,
    flex with `gap: var(--sp-2)`) containing `<Badge>{sessions.length}</Badge>`;
    then `<Button variant="ghost" size="sm" round icon="folder-plus"
    aria-label="Add project" title="Add project" className={s.add}
    onClick={() => void window.api.invoke('project:add')} />` (`margin-left:auto`).
  - List `.list` (flex 1, `overflow-y: auto`, `padding: var(--sp-2)`, flex
    column, `gap: var(--sp-2)`). No projects: `<div className={s.hint}>Add a
    project with the folder ＋ above</div>` (`--text-3`, `--fs-sm`, `padding:
    var(--sp-2)`).
  - Per project: `.folder` row (flex, align center, `gap: var(--sp-1)`,
    height 28px, `padding: 0 var(--sp-1)`, `color: var(--text-2)`, cursor
    pointer, `title={p.path}`, `onClick` toggles `collapsed`): `<Icon
    name={collapsed ? 'chevron-right' : 'chevron-down'} size={12} />`,
    `<Icon name="folder" size={14} />`, name `.folderName` (flex 1, ellipsis),
    then `.folderActions` (stops click propagation): remove `<Button
    variant="ghost" size="sm" round icon="trash" aria-label="Remove project"
    title="Remove project" className={s.hoverOnly} …removeProject(p.id) />`
    and `<Button variant="ghost" size="sm" round icon="plus" aria-label="New
    session in project" title="New session" onClick={() => onNew(p.id)} />`.
    `.hoverOnly` opacity 0, 1 on `.folder:hover` / `:focus-visible`.
  - `refused === p.id` → `<div className={s.refused}>Can't remove: project has
    running sessions</div>` (`--danger`, `--fs-sm`, `padding: 0 var(--sp-1)`).
  - Unless collapsed: `.cards` (flex column, `gap: var(--sp-2)`) of
    `SessionCard` for `sessionsOf(p.id, sessions)`.
- [x] In `Sidebar.tsx`, `SessionCard({ s, focused, compact, onFocus,
  onToggleCompact })` keeps the rename logic (double-click → `editing`; input
  Enter renames via `session:rename` when non-empty, Escape/blur cancels) and
  renders `<ListRow title={s.label} icon={<Icon name={s.kind === 'opencode' ?
  'opencode' : 'terminal'} size={14} className={s.kind === 'opencode' ?
  css.iconOpencode : css.iconTerminal} />} status={{ label: s.lastStatus,
  tone: s.lastStatus }} tone={focused ? 'selected' : 'default'}
  compact={compact} onClick={onFocus} onTitleDoubleClick={() =>
  setEditing(true)} editor={editing ? <input className={css.rename} …/> :
  undefined} actions={<>{gone && <Button variant="ghost" size="sm" round
  icon="trash" aria-label="Remove session" title="Remove" …session:remove />}
  <Button variant="ghost" size="sm" round icon="minimize" aria-label={compact
  ? 'Expand' : 'Compact'} title={…} onClick={onToggleCompact} /></>} />`
  (import the module as `css`, since `s` is the session). `.iconOpencode`
  colour `--status-waiting`, `.iconTerminal` colour `--accent`, both
  flex-shrink 0; `.rename` flex 1, min-width 0, height 20px, bg `--raised-bg`,
  `border: 1px solid var(--card-border)`, radius `--r-card`, colour `--text`,
  `font: inherit`, `padding: 0 var(--sp-1)`. The input stops click
  propagation as today.
- [x] `src/renderer/src/App.tsx`: replace `modalOpen` with `const [newFor,
  setNewFor] = useState<{ projectId?: string } | null>(null)`; `openNew =
  (projectId?: string) => setNewFor({ projectId })`; menu `newSession` →
  `setNewFor({})`; `<TopBar onNew={() => openNew()} />`; `<Sidebar
  onNew={openNew} />`; `{newFor && <NewSessionModal
  initialProjectId={newFor.projectId} onClose={() => setNewFor(null)} />}`.
- [x] Run `npm run typecheck`
- [x] Run `npm test`
- [x] Manual (human, `npm run dev`): two projects, three sessions; collapse a
  folder; compact a card; focused card is orange; project ＋ preselects its
  project; header ＋ opens the folder picker and adds a project; removing a
  project with running sessions shows the refusal; Cmd+1..3 still focuses in
  sidebar order. (Human reviewed and said continue.)

## Slice 4 — No inline styles, enforced

Context (code at `6617d34`): the only `style=` in `src/renderer` is
`AppShell.tsx`'s `style={{ '--sidebar-w': `${sidebarWidth}px` } as
CSSProperties}`, whose value holds a `}` inside a template literal. Vitest
runs in `node` and collects `src/**/*.test.ts`; Node 26 supports
`readdirSync(dir, { recursive: true })`.

- [x] Create `src/renderer/src/noInlineStyles.test.ts`:
  - `export function inlineStyleViolations(source: string): string[]` —
    for each `style=` occurrence: if the next chars are not `{{`, record the
    line (`style={obj}` is never allowed). Otherwise walk from the inner `{`
    counting `{`/`}` depth (skip characters inside `'…'`, `"…"` and
    `` `…` `` strings, treating `${…}` inside template strings as nested
    code) to the matching `}`; within that object text, collect the keys at
    depth 0 (an identifier or quoted name directly followed by `:` at the
    start or after a `,`). Record the line if any key does not start with
    `--`. Each violation string is `line <n>: <trimmed line text>`.
  - `describe('inlineStyleViolations')` unit cases: `style={{ '--w':
    `${n}px` } as CSSProperties}` → `[]`; `style={{ color: 'red' }}` → 1
    violation; `style={{ '--a': 1, padding: 4 }}` → 1; `style={obj}` → 1;
    a file without `style=` → `[]`.
  - `describe('src/renderer')`: walk `src/renderer` (resolved from
    `new URL('..', import.meta.url)`, i.e. `src/renderer`) with
    `readdirSync(dir, { recursive: true })`, keep `.tsx` files, and expect
    the map `{ file: violations }` filtered to non-empty entries to equal `{}`.
- [x] Run `npm test`
- [x] Temporarily add `style={{ color: 'red' }}` to the `<span>` in
  `src/renderer/src/components/ui/Badge.tsx`, run `npm test` and confirm the
  `src/renderer` case fails naming `Badge.tsx`; revert the line.
- [x] Run `npm run build`

## Open questions
