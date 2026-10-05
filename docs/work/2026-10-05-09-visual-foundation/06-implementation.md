---
feature: 2026-10-05-09-visual-foundation
phase: implementation
status: approved
version: 1
created: 2026-10-05
updated: 2026-10-05
approved_at: 2026-10-05
based_on:
  - 03-design.md@2
  - 04-structure.md@2
  - 05-plan.md@1
forced: []
---

# Implementation: visual foundation

## Progress

- [x] Slice 1 — Tracer: the Xirp shell around the existing UI 
- [x] Slice 2 — Modals, buttons, banner and panes
- [x] Slice 3 — Sidebar cards and folders
- [x] Slice 4 — No inline styles, enforced

## Slice 1 — Tracer: the Xirp shell around the existing UI

Verification: `npm test` 49/49 passed (run outside the Claude Code sandbox:
inside it the four real-tmux tests in `src/core/backend/tmux.test.ts` fail
with `posix_spawnp failed`, unrelated to this change); `npm run typecheck`
clean; `npm run build` clean. Manual `npm run dev` steps are for the human.

Deviations (all small, two-way):

- Added `--scrollbar-thumb #38383c` (research Q7) to `tokens.css`: the design
  puts scrollbars in `base.css` and allows no colour literal outside
  `tokens.css`/`theme.ts`, but its token table has no scrollbar entry.
- Also added `--fw-regular/semibold/bold` (the design's 400/600/700 weights)
  and `--card-glow: 5px` (the design's "5px glow"), and named the card tones
  `--card-{selected,waiting,finished}-{bg,border}`.
- `terminalTheme` also sets `cursorAccent #1e1e2e` (Mocha base) so the
  block cursor's text stays readable.
- With nothing focused, the content header renders with no crumbs (an empty
  47px bar) rather than being hidden.
- `Sidebar.tsx` is untouched until slice 3, so its old inline
  `border-right: 1px solid #333` and `#37373d` focus fill still show inside
  the new sidebar panel. The error banners keep their inline style until
  `Banner` lands in slice 2.
- The terminal frame is an outer `.frame` div (12px padding, terminal
  background) around the xterm host div, so `FitAddon` measures the inner
  box and the padding doesn't cause overflow.

Re-planning note: after the human's review of slice 1 (a screenshot of the
running app), the design went to v2 (wordmark spacing, add-project ＋ in the
sidebar header, full-bleed terminal) and was re-approved with the structure.
`05-plan.md` was stale; no section was written ahead, so slice 2 was planned
fresh against v2. Slice 1's manual check is ticked from that review.

## Slice 2 — Modals, buttons, banner and panes

Verification: `npm run typecheck` clean; `npm run build` clean; `npm test`
49/49 passed outside the sandbox (inside it the four real-tmux tests fail with
"error connecting to /private/tmp/tmux-501/…", as in slice 1). Manual
`npm run dev` steps are for the human.

Deviations (small, two-way):

- `Button` sets round widths per size (`.sm.round` 24px, `.md.round` 32px)
  instead of one "width = height" rule; same result.
- `Modal` maps the key to its action (Escape → `onClose`, Enter →
  `onConfirm`) in one handler; behaviour as planned.

## Slice 3 — Sidebar cards and folders

Verification: `npm run typecheck` clean; `npm test` 49/49 passed outside the
sandbox; `npm run build` clean. Manual `npm run dev` steps are for the human.

Deviations (small, two-way):

- `src/core/sessions.test.ts` "persists ui changes" hard-coded
  `sidebarWidth: 260`; it now expects `DEFAULT_UI.sidebarWidth`, so the
  default can change without touching the test.
- Tone classes on `ListRow` also pin their colours on `:hover`, so the
  generic hover border doesn't override the selected/waiting/finished border.
- The only `style=` left in `src/renderer` is `AppShell`'s `--sidebar-w`
  variable (slice 4 enforces this).

## Slice 4 — No inline styles, enforced

Verification: `npm test` 55/55 passed outside the sandbox; with
`style={{ color: 'red' }}` added to `Badge.tsx` the `src/renderer` case failed
naming `src/components/ui/Badge.tsx`, and passed again after the revert;
`npm run build` clean.

Deviations (small, two-way):

- The checker also tracks `(`/`[` depth when finding top-level keys, so a
  value such as `calc(...)` or an array can't be mistaken for a key.
- `style={{}}` (no keys) counts as a violation, as there is nothing to allow.

## Final checks

`npm test` 55/55 (outside the sandbox), `npm run typecheck` clean,
`npm run build` clean. No `lint` command is configured.
Manual `npm run dev` checks for slices 2–4: confirmed by the human
(2026-10-05, "everything looks good").

## PR description

### Visual foundation (child 9 of the OpenCode feature workspace epic)

Gives grove a deliberate, Xirp-like dark look and a small set of shared parts
that later children build on, instead of inline styles.

**Design** (`03-design.md` v2, ADR 0012)
- D1: components are styled with CSS Modules reading custom properties from
  one `styles/tokens.css`; no visual inline styles (CSS variables only).
- D2: `tokens.css` owns UI tokens; `src/shared/theme.ts` owns the window
  background and the Catppuccin Mocha terminal theme for xterm, main and tmux;
  `tokens.test.ts` keeps the values both define equal.
- Hidden title bar with the traffic lights inside a 51px draggable top bar
  (logo, wordmark, inert search pill, round ＋), rounded `#121212` panels on
  `#0a0a0b`, full-bleed terminal clipped by the panel's corners.

**Slices**
1. The Xirp shell around the existing UI: tokens, base CSS, window chrome,
   AppShell / TopBar / ContentHeader, Mocha terminal, no launch flash.
2. Button, Modal, Badge, Banner, Icon; the ＋ modal and confirm dialog on
   Modal; error banners; styled ended and empty panes; slice 1 review fixes.
3. Sidebar: "Sessions" header with count badge and add-project ＋;
   collapsible project folders with ＋ and hover remove; session cards on
   ListRow with kind icon, status line, orange selection, compact toggle.
4. `noInlineStyles.test.ts` fails on any visual `style=` in `src/renderer`.

**How to verify**
- `npm test`, `npm run typecheck`, `npm run build`.
- `npm run dev`: drag the window by the top bar; ⌘T / ＋ open the modal
  (Enter creates, Escape closes); ⌘W confirm (Enter kills, Escape cancels,
  keys don't reach the terminal); collapse a folder, compact a card, project
  ＋ preselects its project, header ＋ adds a project; ⌘1..9 focus in sidebar
  order; a new session shows the Mocha background reaching the panel edges.

**Known limits**
- tmux sessions created before this change keep their old pane colours.
- Collapsed folders and compact cards reset on restart (child 2 persists them).
- The search pill is inert until child 7.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

## Open questions
