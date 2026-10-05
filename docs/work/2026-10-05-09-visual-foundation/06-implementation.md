---
feature: 2026-10-05-09-visual-foundation
phase: implementation
status: draft
version: 1
created: 2026-10-05
updated: 2026-10-05
approved_at:
based_on:
  - 03-design.md@1
  - 04-structure.md@1
  - 05-plan.md@1
forced: []
---

# Implementation: visual foundation

## Progress

- [x] Slice 1 — Tracer: the Xirp shell around the existing UI (manual check pending human)
- [ ] Slice 2 — Modals, buttons, banner and panes
- [ ] Slice 3 — Sidebar cards and folders
- [ ] Slice 4 — No inline styles, enforced

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

## Open questions
