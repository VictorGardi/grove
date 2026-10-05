---
feature: 2026-10-05-09-visual-foundation
phase: structure
status: approved
version: 1
created: 2026-10-05
updated: 2026-10-05
approved_at: 2026-10-05
based_on:
  - 03-design.md@1
  - parent:04-structure.md@4
forced: []
---

# Structure: visual foundation

Four vertical slices inside the epic's scope for child 9 (renderer look,
window chrome, terminal colours; no IPC, state shape or core logic). Each
slice leaves the app runnable and looking more like Xirp.

## Slices

### Slice 1 — Tracer: the Xirp shell around the existing UI

- **Outcome:** hidden title bar with traffic lights inside a dark, draggable
  51px top bar (wordmark, inert search pill, ＋ opening the existing modal);
  sidebar and content in rounded `#121212` panels on `#0a0a0b`; content
  header shows "project / label"; new sessions use the Mocha terminal theme;
  no colour flash at launch.
- **Files:** NEW `src/renderer/src/styles/{tokens.css,base.css,tokens.test.ts}`,
  `src/renderer/src/components/ui/cx.ts`,
  `src/renderer/src/components/shell/{AppShell,TopBar,ContentHeader}.tsx` +
  `.module.css`, `TerminalView.module.css`, `App.module.css`. MODIFIED
  `src/shared/theme.ts`, `src/main/index.ts`, `src/renderer/index.html`,
  `src/renderer/src/main.tsx`, `App.tsx`, `TerminalView.tsx`,
  `src/core/sessions.test.ts`.
- **Signatures:** `chromeBackground: string`; `terminalTheme` (Mocha, ANSI 16);
  `cx(...)`; `AppShell({ topBar, banners?, sidebar, content, sidebarWidth })`;
  `TopBar({ onNew })`; `ContentHeader({ crumbs, right? })`.
- **Verify:** `npm test` (`tokens.test.ts` parity passes; `sessions.test.ts`
  expects `terminalTheme` values) and `npm run typecheck`. Manual in
  `npm run dev`: drag the window by the top bar; ＋ opens the modal; a new
  Terminal session shows a `#1e1e2e` background; the window never shows a
  light or `#1e1e1e` frame on launch.
- **Depends on:** —

### Slice 2 — Modals, buttons, banner and panes

- **Outcome:** Spotlight-style ＋ modal on `Modal` (project select,
  OpenCode/Terminal as a two-button toggle, primary Create, Enter creates,
  Escape closes); confirm dialog on `Modal`; error banner on `Banner`;
  styled empty and "Session ended" panes.
- **Files:** NEW `src/renderer/src/components/ui/{Button,Modal,Badge,Banner}.tsx`
  + `.module.css`, `ui/Icon.tsx`. MODIFIED `NewSessionModal.tsx` (+ `.module.css`),
  `ConfirmDialog.tsx`, `App.tsx`, `TopBar.tsx` (＋ as `Button round`).
- **Signatures:** `Button({ variant?, size?, icon?, round?, ...button })`;
  `Modal({ onClose, onConfirm?, width?, children })`; `Badge({ tone?, children })`;
  `Banner({ tone?, children })`; `Icon({ name, size?, className? })`;
  `NewSessionModal({ onClose, initialProjectId? })`.
- **Verify:** `npm run typecheck`, `npm run build`. Manual: Cmd+T → Enter
  creates, Escape closes; Cmd+W on a running session → confirm, Enter kills,
  Escape cancels, keys don't reach the terminal; `exit` in a terminal shows
  "Session ended" and Remove works.
- **Depends on:** 1.

### Slice 3 — Sidebar cards and folders

- **Outcome:** "Sessions" header with count Badge; collapsible project
  folders with ＋ (opens the modal preselected) and a hover remove icon
  (refusal text kept); session cards with kind icon, title, mono status line;
  focused card orange; per-card compact toggle; rename by double-click; "Add
  project" in the footer; default sidebar width 230.
- **Files:** NEW `src/renderer/src/components/ui/{ListRow,StatusDot}.tsx` +
  `.module.css`. MODIFIED `Sidebar.tsx` (+ `Sidebar.module.css`), `App.tsx`
  (`openNew(projectId?)`), `src/shared/types.ts` (`DEFAULT_UI.sidebarWidth: 230`).
- **Signatures:** `ListRow({ title, icon?, meta?, status?, tone?, compact?,
  actions?, onClick?, onTitleDoubleClick?, editor? })`; `StatusDot({ tone })`;
  `Sidebar({ onNew(projectId?) })`.
- **Verify:** `npm run typecheck`, `npm test`. Manual: two projects, three
  sessions; collapse a folder; compact a card; focused card is orange;
  project ＋ preselects its project; removing a project with running
  sessions shows the refusal; Cmd+1..3 still focuses in sidebar order.
- **Depends on:** 2.

### Slice 4 — No inline styles, enforced

- **Outcome:** no `style=` remains in `src/renderer` except CSS-variable-only
  object literals, and a test keeps it that way.
- **Files:** NEW `src/renderer/src/noInlineStyles.test.ts`. MODIFIED any
  renderer file still carrying a visual inline style.
- **Verify:** `npm test` (scan passes; adding `style={{ color: 'red' }}` to a
  component temporarily makes it fail), `npm run build`.
- **Depends on:** 3.

## Appetite check

Epic budget for this child: 2–3 days, about 4 slices, at most 2 own one-way
decisions. This plan: 4 slices, 2 one-way decisions (D1, D2). Slice 1 and 3
are the largest (~1 day each); 2 and 4 are smaller. Fits.

## Deferred

- Persisting compact/collapsed state (child 2, in `ui`).
- Search behaviour (child 7).
- Waiting/finished card tones and `working`/`idle` statuses in use (child 3);
  tokens exist now.
- Hover states beyond basics (not visible in the reference).

## Rollout / migration

Existing tmux sessions keep their old pane style (`#1e1e1e`) until recreated;
new sessions get Mocha. A saved `ui.sidebarWidth` of 260 is kept.

## Open questions
