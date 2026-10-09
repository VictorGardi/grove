---
feature: 2026-10-09-session-workflow-status
phase: structure
status: draft
version: 2
created: 2026-10-09
updated: 2026-10-09
approved_at:
based_on:
  - 03-design.md@2
forced: []
---

# Structure: session workflow statuses

## Slices

### Slice 1 — Persist and edit workflow status

- **Outcome:** Every session defaults to In Progress; the card's top-left icon is a button on every session kind that selects any of the seven Xirp statuses; the choice persists and shows in the sidebar cards, Sessions Board cards and collapsed sidebar tiles, without changing live status or grid membership.
- **Files:** `src/shared/types.ts`, `src/shared/ipc.ts`, `src/core/store/stateStore.ts`, `src/core/core.ts`, `src/core/sessions.ts`, `src/main/ipc.ts`, `src/renderer/src/workflowStatus.ts`, `src/renderer/src/components/ui/WorkflowStatusPicker.tsx` and `.module.css`, `src/renderer/src/components/ui/ListRow.tsx`, `src/renderer/src/components/Sidebar.tsx`, `SessionsBoard.tsx`, `SidebarRail.tsx` and `.module.css`, and the tests for each.
- **Verification:** state-store migration test (a v7 session loads as v8 with `workflowStatus: 'in-progress'`); core command test (known session updates to each of the seven values, unknown id returns `not-found`, the choice survives a restart, live status and grid membership untouched); renderer test (labels, glyphs and tones for all seven values); `npm run typecheck`; `npm test`.
- **Manual:** Set a sidebar session and a terminal session to Pinned, and a board card to Blocked. Restart Grove and confirm all three still show their status. Confirm the grid `plus`/`check` still toggles membership, that the bottom status line still reports running/waiting/gone, that the alert badge still appears, and that the rail tile keeps its kind glyph and its bottom-right live dot.
