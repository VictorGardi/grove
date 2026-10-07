---
feature: 2026-10-05-07-command-palette-grid
phase: plan
status: approved
version: 1
created: 2026-10-07
updated: 2026-10-07
approved_at: 2026-10-07
based_on:
  - 03-design.md@1
  - 04-structure.md@1
forced: []
---

# Command palette and grid view — plan

Self-approved per slice by grove-implement: mechanical checks passed, not human-reviewed.

## Slice 1 — Palette tracer: Cmd+K jumps to sessions, features, projects

Notes for a cold reader: renderer code lives in `src/renderer/src`, shared types in `src/shared`. Tests are vitest (`npx vitest run <file>`). `Modal` (`components/ui/Modal.tsx`) already handles capture-phase Esc (`onClose`) and Enter (`onConfirm`). Styles are CSS modules using tokens from `styles/tokens.css`; no inline styles (`noInlineStyles.test.ts`). Fuzzy matcher is our own (design D4); the `menu:action` listener body becomes `runAction(a)` (design D3).

- [x] Write failing test `src/renderer/src/fuzzy.test.ts`: null on no subsequence; case-insensitive; `indices` are the matched positions; empty query matches with score 0 and no indices; prefix beats mid-word; word-boundary beats mid-word; consecutive run beats scattered
- [x] Create `src/renderer/src/fuzzy.ts`: `fuzzy(query, text): { score: number; indices: number[] } | null` (greedy subsequence scan with bonuses for prefix, word boundary (after space `/-_.:`), consecutive runs; small penalty for gaps)
- [x] Write failing test `src/renderer/src/paletteItems.test.ts`: `paletteItems` yields one item per session, feature (non-group or group alike), project, with kind/label/detail; empty-query `rank` order is sessions (waiting first, then list order), features, projects; a query filters and ranks by score, ties by kind order; `run()` of a session/feature/project item calls the matching action with the right argument
- [x] Create `src/renderer/src/paletteItems.ts`: `PaletteItem`, `PaletteActions { focusSession(id); focusFeature(ref); openProject(id) }`, `paletteItems(data: { projects; sessions; features }, actions)`, `rank(items, query)` (matches `label`, falling back to `detail` with indices `[]` and a score penalty)
- [x] `src/shared/ipc.ts`: add `| { type: 'palette' }` to `MenuAction`
- [x] `src/main/menu.ts`: Command Palette item `click: () => send({ type: 'palette' })`
- [x] Create `src/renderer/src/components/CommandPalette.tsx` + `CommandPalette.module.css`: `Modal` (width md, `onClose`, `onConfirm` runs highlighted row then closes), autofocused input, ArrowUp/ArrowDown in input `onKeyDown` move the highlight (wrap), click on a row runs it, matched characters wrapped in `<mark>`, kind tag and detail per row, "No matches" when empty; highlight resets to 0 when the query changes
- [x] `src/renderer/src/App.tsx`: extract the `menu:action` listener body into `runAction(a: MenuAction)` (a `useCallback`; reads latest state via `useSlices.getState()`), add `paletteOpen` state, `a.type === 'palette'` sets it true, render `<CommandPalette>` when open with items from `paletteItems` (actions `setFocused`, `focusFeature`, `openProject`)
- [x] Run `npx vitest run src/renderer/src/fuzzy.test.ts src/renderer/src/paletteItems.test.ts`
- [x] Run `npm run typecheck`
- [x] Run `npm test`
