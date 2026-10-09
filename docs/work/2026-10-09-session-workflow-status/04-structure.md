---
feature: 2026-10-09-session-workflow-status
phase: structure
status: draft
version: 1
created: 2026-10-09
updated: 2026-10-09
approved_at:
based_on:
  - 03-design.md@1
forced: []
---

# Structure: session workflow statuses

## Slices

### Slice 1 — Persist and edit workflow status

- **Outcome:** Every session defaults to In Progress; a person can select any of the seven Xirp statuses from the card marker; the choice persists and is visible in every session-card view without changing live status or grid membership.
- **Files:** `src/shared/types.ts`, `src/shared/ipc.ts`, `src/core/store/stateStore.ts`, `src/core/core.ts`, `src/core/sessions.ts`, `src/main/ipc.ts`, `src/renderer/src/components/Sidebar.tsx`, `SessionsBoard.tsx`, `SidebarRail.tsx`, shared UI status marker/picker and its styles/tests.
- **Verification:** State-store migration test (legacy records become `in-progress`); core command test (known session updates, unknown id rejects, status persists); renderer tests (all seven choices and glyph/tone mapping); `npm run typecheck`; `npm test`.
- **Manual:** Set a session to Pinned, restart Grove, and confirm Pinned remains visible in the sidebar and board while the grid plus/check and live-status indicator still work independently.
